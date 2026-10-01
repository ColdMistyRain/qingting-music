import { isAudioFileName, parseTrackFileName, type Track } from "@qingting/shared";

/**
 * 本地文件相关纯逻辑（PRD 3.3 LC-02/03）。
 * 只做字符串与对象变换，不碰 DOM，便于单测。
 */

export interface LocalNameParts {
  title: string;
  artist: string;
}

/** 文件名回退解析已提到 shared：服务端 LB-03 的回退用的是同一条规则，不能各写一份。
    这里保留旧名，调用点与旧测试不用改。 */
export const parseLocalFileName = parseTrackFileName;

/** 过滤出音频文件（LC-02），非音频交给调用方提示 */
export function pickAudioFiles<T extends { name: string }>(files: readonly T[]): T[] {
  return files.filter((file) => isAudioFileName(file.name));
}

/** 文件名 + 大小 + 修改时间构成稳定 ID，重复拖入同一文件时可直接去重 */
export function localTrackId(file: { name: string; size: number; lastModified: number }): string {
  return `local:${file.name}:${file.size}:${file.lastModified}`;
}

/** 由本地文件信息与 Blob URL 组装统一曲目对象（LC-06：URL 仅在浏览器本地有效） */
export function toLocalTrack(
  file: { name: string; size: number; lastModified: number },
  url: string,
): Track {
  const { title, artist } = parseLocalFileName(file.name);
  return {
    id: localTrackId(file),
    source: "local",
    url,
    title,
    artist,
    album: "本地文件",
    cover: null,
    duration: null,
  };
}

/**
 * 读出音频时长（本地文件没有标签可读时的唯一来源）；读不出返回 null。
 * createElement 可注入，便于单测用假元素驱动 loadedmetadata / error。
 */
export function probeDuration(
  url: string,
  createElement: () => HTMLAudioElement = () => new Audio(),
): Promise<number | null> {
  return new Promise((resolve) => {
    const element = createElement();
    let settled = false;

    const finish = (value: number | null): void => {
      if (settled) return;
      settled = true;
      element.src = "";
      resolve(value);
    };

    element.addEventListener("loadedmetadata", () => {
      const seconds = element.duration;
      finish(Number.isFinite(seconds) && seconds > 0 ? seconds : null);
    });
    element.addEventListener("error", () => finish(null));

    element.preload = "metadata";
    element.src = url;
  });
}

/* ---------- 原始 File 登记处（LC-07 转存到音乐库） ----------
   `Track.url` 只是 Blob URL，转存必须拿到原始 File 才能上传，而 File 只在
   用户拖入/选择文件的那一刻存在。登记处放**模块作用域**：LocalView 离开再回来
   （切页面）时队列还在，File 不会跟着丢。
   清理时机与 Blob URL 完全一致——player store 的 releaseTrack() 里一起忘掉。 */
const sources = new Map<string, File>();

export function rememberLocalSource(id: string, file: File): void {
  sources.set(id, file);
}

export function localSourceFor(id: string): File | undefined {
  return sources.get(id);
}

export function forgetLocalSource(id: string): void {
  sources.delete(id);
}
