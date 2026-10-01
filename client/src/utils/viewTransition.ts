/**
 * 封面共享元素过渡（View Transition API）。
 *
 * 用于「播放条小封面 ⇆ 沉浸页大封面」的飞入/飞出（VS-03）：
 *   播放条与沉浸页各自给封面元素挂 `.vt-cover`（同一个 `view-transition-name`），
 *   两个页面**不会同时存在**（/now 是顶层路由，不套主布局），所以浏览器能把它们配成
 *   同一元素的“旧状态 / 新状态”，自己做位移与尺寸的形变。
 *
 * 三个落地要点（都是踩过/调研过的）：
 *  1. **回调里要等 DOM 落地**：`startViewTransition(cb)` 会在 `cb` 返回的 promise 落地后
 *     才拍“新状态”快照，所以导航要 `await`，并补一个 `nextTick()`。
 *  2. **看门狗**：个别环境（过渡进行中缩放窗口、显示缩放非整数）过渡不会结束，旧页面快照
 *     会永久残留在最上层形成"重影"——超时强制 `skipTransition()` 拆除。
 *     参考实现：`music-player1` 的 `stores/ui.ts`（同一思路，阈值是我们自己的）。
 *  3. **过渡期间给新页面自己的入场动画让位**：快照是在动画第一帧（opacity 0）拍的，
 *     不停掉的话交叉淡化过去就是“一片空”，所以过渡期间在 `<html>` 上挂 `data-vt="on"`。
 */
import { nextTick } from "vue";

/** 看门狗时长（ms）：超过这个时间还没结束就强制拆除快照层 */
export const VT_WATCHDOG_MS = 1500;

/** 过渡期间挂在 `<html>` 上的标记（CSS 用它让新页面自己的入场动画让位） */
export const VT_ATTR = "data-vt";

export interface ViewTransitionEnv {
  /** 浏览器是否支持 View Transition API */
  hasApi: boolean;
  /** 用户是否要求减少动效（prefers-reduced-motion） */
  reducedMotion: boolean;
}

/** 能否使用共享元素过渡：API 可用且用户没要求减少动效（降级行为 = 普通切换，功能不受影响） */
export function shouldUseViewTransition(env: ViewTransitionEnv): boolean {
  return env.hasApi && !env.reducedMotion;
}

/** 读当前环境（无 document / window 的环境——单测、SSR——一律降级） */
function currentEnv(): ViewTransitionEnv {
  if (typeof document === "undefined") return { hasApi: false, reducedMotion: false };
  const reducedMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return { hasApi: "startViewTransition" in document, reducedMotion };
}

interface StartedTransition {
  finished: Promise<void>;
  skipTransition?: () => void;
}

/**
 * 用一次 View Transition 包住 DOM 更新（拿不到 API 或用户要求减少动效时直接执行）。
 * 返回**是否真的跑了过渡**，方便调用方按需额外处理。
 * 回调的返回值一律 `await` 掉（`router.push()` 返回的是导航结果、不是 void，直接写 `Promise<void>` 会被 ts 挡下）。
 */
export async function withViewTransition(
  update: () => unknown | Promise<unknown>,
): Promise<boolean> {
  if (!shouldUseViewTransition(currentEnv())) {
    await update();
    return false;
  }

  const root = document.documentElement;
  root.setAttribute(VT_ATTR, "on");

  let transition: StartedTransition;
  try {
    const doc = document as Document & {
      startViewTransition(cb: () => void | Promise<void>): StartedTransition;
    };
    transition = doc.startViewTransition(async () => {
      await update();
      // 让 Vue 把 DOM 落地再拍快照：导航 await 完只代表路由变了，渲染还在微任务里
      await nextTick();
    });
  } catch {
    // 起不来就当没这回事：属性清掉、更新照旧
    root.removeAttribute(VT_ATTR);
    await update();
    return false;
  }

  const watchdog = setTimeout(() => {
    try {
      transition.skipTransition?.();
    } catch {
      /* 已经结束，不用管 */
    }
  }, VT_WATCHDOG_MS);

  void Promise.resolve(transition.finished)
    .catch(() => undefined)
    .finally(() => {
      clearTimeout(watchdog);
      root.removeAttribute(VT_ATTR);
    });

  return true;
}
