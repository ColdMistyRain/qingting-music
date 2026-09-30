import { parseFile } from "music-metadata";
import { UNKNOWN_ALBUM, UNKNOWN_ARTIST, parseTrackFileName } from "@qingting/shared";

/** 内嵌封面：交给调用方落盘（uploads/ 里与音频同目录，PRD 12） */
export interface ParsedCover {
  data: Buffer;
  /** 扩展名，跟着图片 MIME 走（jpg / png） */
  extension: string;
}

export interface ParsedAudio {
  title: string;
  artist: string;
  album: string;
  /** 秒；解析不出为 0（绝不返回 NaN/负值——前端直接显示它） */
  duration: number;
  cover: ParsedCover | null;
}

/**
 * 解析音频标签（LB-03：标题 / 歌手 / 专辑 / 时长 / 内嵌封面）。
 *
 * 解析失败不算上传失败：文件损坏、格式不支持都很正常，此时退回**文件名解析**
 * （LC-03 与本 PRD LB-03 用的是 shared 里同一套规则），用户至少能在列表里
 * 看到一首以文件名命名的歌，而不是一条「上传成功但什么都不显示」的幽灵记录。
 */
export async function parseAudioFile(filePath: string, originalName: string): Promise<ParsedAudio> {
  const fromName = parseTrackFileName(originalName);

  try {
    const meta = await parseFile(filePath, { duration: true });
    const { title, artist, album, picture } = meta.common;
    const seconds = meta.format.duration ?? 0;

    return {
      title: clean(title) || fromName.title || originalName,
      artist: clean(artist) || fromName.artist || UNKNOWN_ARTIST,
      album: clean(album) || UNKNOWN_ALBUM,
      duration: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0,
      cover: toCover(picture?.[0]),
    };
  } catch {
    return {
      title: fromName.title || originalName,
      artist: fromName.artist,
      album: UNKNOWN_ALBUM,
      duration: 0,
      cover: null,
    };
  }
}

/** 标签里常有一堆空白，统一 trim 后再决定用不用 */
function clean(value: string | undefined): string {
  return (value ?? "").trim();
}

/**
 * 修正 multipart 上传的中文文件名乱码。
 *
 * busboy（multer 底层）按 latin1 解码 multipart 头里的 filename，而浏览器发的是 UTF-8 原始字节：
 * “海阔天空” 会变成 “æµ·éå¤©ç©º”。把它按 latin1 取回字节再按 UTF-8 解一遍就正常了。
 * 纯 ASCII 不做处理，避免把本来就正常的名字转坏。
 */
export function decodeUploadFileName(name: string): string {
  if (!/[\u0080-\u00ff]/.test(name)) return name;
  return Buffer.from(name, "latin1").toString("utf8");
}

function toCover(picture: { data: Uint8Array; format?: string } | undefined): ParsedCover | null {
  if (!picture || picture.data.length === 0) return null;
  return {
    data: Buffer.from(picture.data),
    extension: picture.format === "image/png" ? "png" : "jpg",
  };
}
