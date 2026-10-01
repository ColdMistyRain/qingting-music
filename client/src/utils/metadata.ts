/**
 * 本地音频标签读取（PRD LC-04）。
 * 用 music-metadata 的浏览器入口（`parseBlob`）直接读 Blob，不经过服务器（LC-06）；
 * 解析失败不报错，交给调用方回退到文件名解析（LC-03）。
 */

export interface AudioTags {
  title: string | null;
  artist: string | null;
  album: string | null;
  duration: number | null;
  picture: { data: Uint8Array; format: string } | null;
  /** 内嵌歌词原文（LR-02 第一优先级）；没有就是 null，不去猜 */
  lyrics: string | null;
}

/** music-metadata 解析结果里我们真正用到的那一小部分（便于单测用假对象构造） */
export interface RawMetadataLike {
  common?: {
    title?: string;
    artist?: string;
    album?: string;
    picture?: readonly { data: Uint8Array | number[]; format?: string }[];
    lyrics?: readonly { text?: string }[];
  };
  format?: { duration?: number };
}

function readText(value: string | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

/** 从解析结果里挑出需要的字段；缺失的一律为 null，不猜值 */
export function pickTags(metadata: RawMetadataLike): AudioTags {
  const duration = metadata.format?.duration;
  const picture = metadata.common?.picture?.[0];
  // 内嵌歌词：取第一段有正文的（同一声明里偶尔会有多段，空白的忽略）
  const lyrics = metadata.common?.lyrics?.find((entry) => entry.text?.trim())?.text?.trim() ?? null;

  return {
    title: readText(metadata.common?.title),
    artist: readText(metadata.common?.artist),
    album: readText(metadata.common?.album),
    duration:
      typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? duration : null,
    picture: picture
      ? { data: Uint8Array.from(picture.data), format: picture.format || "image/jpeg" }
      : null,
    lyrics,
  };
}

/** 内嵌封面 → 可直接给 <img> 用的 Blob URL；无封面或环境不支持时返回 null */
export function coverUrlFrom(picture: AudioTags["picture"]): string | null {
  if (!picture) return null;
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
  try {
    // 复制一份到新的 Uint8Array：其底层一定是 ArrayBuffer，满足 BlobPart 的类型要求
    const bytes = new Uint8Array(picture.data.byteLength);
    bytes.set(picture.data);
    return URL.createObjectURL(new Blob([bytes], { type: picture.format }));
  } catch {
    return null;
  }
}

/** 读取本地文件的标签；读不出（无标签 / 格式不支持 / 文件损坏）返回 null */
export async function readAudioTags(blob: Blob): Promise<AudioTags | null> {
  try {
    // 动态引入：解析库体积不小，只有真正拖入文件时才加载，不影响首屏（PRD 4.1）
    const { parseBlob } = await import("music-metadata");
    return pickTags(await parseBlob(blob));
  } catch {
    return null;
  }
}
