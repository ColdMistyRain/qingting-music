/**
 * HTTP Range 解析（LB-06 / PRD 11.2：起点 / 终点 / 越界 / 非法值都要有用例）。
 * 纯函数：给一段 `Range` 头与文件大小，告诉你该回 200 还是 206，还是 416。
 */

/** 闭区间（含 start 与 end），符合 Content-Range 的语义 */
export interface ByteRange {
  start: number;
  end: number;
}

export type RangeParseResult =
  /** 没有 Range，或语法不合法——按 RFC 7233 应当**忽略**这个头，回整文件 200 */
  | { kind: "full" }
  | { kind: "partial"; range: ByteRange }
  /** 语法对但索要的区间越界——回 416 */
  | { kind: "unsatisfiable" };

export function parseRangeHeader(header: string | undefined, size: number): RangeParseResult {
  if (!header) return { kind: "full" };
  if (!Number.isFinite(size) || size <= 0) return { kind: "unsatisfiable" };

  const matched = /^bytes=(.+)$/i.exec(header.trim());
  if (!matched) return { kind: "full" };

  const spec = matched[1]!.trim();
  // 多区间（"0-1, 5-9"）要回 multipart/byteranges，本项目用不上：按忽略处理
  if (spec.includes(",")) return { kind: "full" };

  const parts = /^(\d*)-(\d*)$/.exec(spec);
  if (!parts) return { kind: "full" };

  const [, rawStart, rawEnd] = parts;
  const hasStart = rawStart !== "";
  const hasEnd = rawEnd !== "";
  // "bytes=-" 两边都空：不是合法 range spec
  if (!hasStart && !hasEnd) return { kind: "full" };

  // 后缀形式 "bytes=-500"：要最后 500 字节
  if (!hasStart) {
    const suffix = Number(rawEnd);
    if (!Number.isInteger(suffix)) return { kind: "full" };
    if (suffix === 0) return { kind: "unsatisfiable" };
    if (suffix >= size) return { kind: "partial", range: { start: 0, end: size - 1 } };
    return { kind: "partial", range: { start: size - suffix, end: size - 1 } };
  }

  const start = Number(rawStart);
  if (!Number.isInteger(start)) return { kind: "full" };
  if (start >= size) return { kind: "unsatisfiable" };

  if (!hasEnd) return { kind: "partial", range: { start, end: size - 1 } };

  const end = Number(rawEnd);
  if (!Number.isInteger(end)) return { kind: "full" };
  // end < start 是非法 range spec → 忽略整个头（其余情况都回 206）
  if (end < start) return { kind: "full" };

  return { kind: "partial", range: { start, end: Math.min(end, size - 1) } };
}
