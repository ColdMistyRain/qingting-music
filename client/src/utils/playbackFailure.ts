import type { TrackSource } from "@qingting/shared";

/**
 * 播放失败的分类与自动跳过（PL-09 修订，v6.26）。
 *
 * **为什么要有它**：原来 `error` 一到就 `next()` —— 服务器一崩，每一首都会立刻失败，
 * 于是页面把"后端挂了"演成"整个列表都坏了"，一首首飞快往下跳（列表循环下**永远停不下来**），
 * 用户连点一首的机会都没有，看到的还是一条条"已自动跳到下一首"。
 *
 * 现在的两条判据：
 * 1. **这一首坏了**（服务器还在）→ 照旧自动跳下一首，但要**等 3 秒**再跳，把选择权交回用户
 *    （需求方定：这段时间里点列表里别的曲目就把这次待跳取消掉）；
 * 2. **服务器断了**（本地曲目不涉及服务器）→ **不跳**：那是整台机器不在，跳一百次也放不出来。
 */

/** 自动跳过前的等待：留给用户"换一首"的时间（需求方定 3 秒） */
export const AUTO_SKIP_DELAY_MS = 3000;

/**
 * 判断服务器是否还在的探测地址。
 * 用 `GET /api/config`：它是最便宜的一个接口（只读内存里的开关、不碰磁盘、不要求登录），
 * 而且**任何 HTTP 响应都算"活着"**——401 / 404 / 500 都说明进程还在听，只有网络层抛错才算断。
 */
export const SERVER_PROBE_URL = "/api/config";

/**
 * 探测超时。后端进程真的挂了时是**连接被拒**（立刻返回），
 * 这个上限是给"卡住但没死"的情形兜底 —— 别让用户等太久才看到那句话。
 */
export const SERVER_PROBE_TIMEOUT_MS = 2500;

/** 只有云端曲目才需要问服务器在不在：本地是 Blob、在线是第三方地址 */
export function isServerTrack(source: TrackSource): boolean {
  return source === "server";
}

export interface ServerProbeOptions {
  /** 注入点：单测传桩函数，默认用全局 `fetch`（传 `null` 表示“这个环境没有 fetch”） */
  fetchImpl?: typeof fetch | null;
  url?: string;
  timeoutMs?: number;
}

/**
 * 服务器还在吗？（不抛错，只回答是/否）
 *
 * **不要用 `navigator.onLine`**：它反映的是"这台设备有没有网"，而这里要判的是
 * "后端进程还活着吗" —— 我们自己把后端 Ctrl+C 掉时，设备的网当然还是通的。
 */
export async function serverReachable(options: ServerProbeOptions = {}): Promise<boolean> {
  const {
    fetchImpl = globalThis.fetch,
    url = SERVER_PROBE_URL,
    timeoutMs = SERVER_PROBE_TIMEOUT_MS,
  } = options;
  // 环境里没有 fetch（降级 / 老浏览器）：别拿"探不了"当成"断了"，照常走跳歌那条路
  if (typeof fetchImpl !== "function") return true;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetchImpl(url, {
      credentials: "same-origin",
      // 断线时最怕读到缓存里的那份响应 —— 那就永远探不到"断了"
      cache: "no-store",
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** 可取消的延时跳过 */
export interface SkipScheduler {
  /** 排一次"到点跳下一首"；重复调用只保留最后一次（不会叠出两次跳） */
  schedule(): void;
  /** 取消待跳（用户自己换了歌 / 发现是服务器断链） */
  cancel(): void;
  /** 此刻是不是有一个待跳 */
  pending(): boolean;
}

/**
 * 延时跳过：到点才调 `onSkip`，期间可以 `cancel()`。
 * 用闭包而不是 `this` —— 调用点会把它拆开传（`const { cancel } = scheduler`）也照样好用。
 */
export function createSkipScheduler(delayMs: number, onSkip: () => void): SkipScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancel(): void {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  return {
    schedule(): void {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        onSkip();
      }, delayMs);
    },
    cancel,
    pending(): boolean {
      return timer !== null;
    },
  };
}
