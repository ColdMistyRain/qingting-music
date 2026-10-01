import { describe, expect, it } from "vitest";
import { parseRangeHeader } from "../src/services/range.js";

/** LB-06 / PRD 11.2：起点、终点、越界、非法值都要有用例 */
describe("parseRangeHeader", () => {
  it("没有 Range 头：走整文件 200", () => {
    expect(parseRangeHeader(undefined, 1000)).toEqual({ kind: "full" });
    expect(parseRangeHeader("", 1000)).toEqual({ kind: "full" });
  });

  it("bytes=0-：从起点到末尾", () => {
    expect(parseRangeHeader("bytes=0-", 1000)).toEqual({
      kind: "partial",
      range: { start: 0, end: 999 },
    });
  });

  it("bytes=100-199：闭区间原样返回", () => {
    expect(parseRangeHeader("bytes=100-199", 1000)).toEqual({
      kind: "partial",
      range: { start: 100, end: 199 },
    });
  });

  it("终点超出文件末尾：夹到 size-1（浏览器常这么要）", () => {
    expect(parseRangeHeader("bytes=900-99999", 1000)).toEqual({
      kind: "partial",
      range: { start: 900, end: 999 },
    });
    expect(parseRangeHeader("bytes=0-99999", 1000)).toEqual({
      kind: "partial",
      range: { start: 0, end: 999 },
    });
  });

  it("后缀形式 bytes=-200：要最后 200 字节（拖到末尾续播时用）", () => {
    expect(parseRangeHeader("bytes=-200", 1000)).toEqual({
      kind: "partial",
      range: { start: 800, end: 999 },
    });
  });

  it("后缀比文件还大：等同于要整个文件", () => {
    expect(parseRangeHeader("bytes=-5000", 1000)).toEqual({
      kind: "partial",
      range: { start: 0, end: 999 },
    });
  });

  it("起点越界：416（前提是语法本身合法）", () => {
    expect(parseRangeHeader("bytes=1000-", 1000)).toEqual({ kind: "unsatisfiable" });
    expect(parseRangeHeader("bytes=1500-1600", 1000)).toEqual({ kind: "unsatisfiable" });
  });

  it("要 0 个字节的后缀：416", () => {
    expect(parseRangeHeader("bytes=-0", 1000)).toEqual({ kind: "unsatisfiable" });
  });

  it("空文件无法满足任何区间", () => {
    expect(parseRangeHeader("bytes=0-", 0)).toEqual({ kind: "unsatisfiable" });
  });

  it("非法语法按 RFC 要求**忽略**该头（回整文件，而不是报错）", () => {
    for (const header of ["items=0-10", "bytes=abc", "bytes=-", "bytes=", "bytes=50-10"]) {
      expect(parseRangeHeader(header, 1000)).toEqual({ kind: "full" });
    }
  });

  it("多区间（bytes=0-1, 5-9）本项目不做 multipart，按忽略处理", () => {
    expect(parseRangeHeader("bytes=0-1, 5-9", 1000)).toEqual({ kind: "full" });
  });

  it("大小非法（NaN / 负数）时不崩", () => {
    expect(parseRangeHeader("bytes=0-", Number.NaN)).toEqual({ kind: "unsatisfiable" });
    expect(parseRangeHeader("bytes=0-", -5)).toEqual({ kind: "unsatisfiable" });
  });
});
