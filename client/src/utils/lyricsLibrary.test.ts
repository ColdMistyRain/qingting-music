import { describe, expect, it } from "vitest";
import {
  MAX_IMPORTED_CHARS,
  decodeLyricsBytes,
  lyricsKey,
  pickLyricsSource,
  sanitizeImportedLyrics,
  withImportedLyric,
  withoutImportedLyric,
} from "./lyricsLibrary";

const LRC = "[00:01.00]第一句\n[00:03.00]第二句";

describe("lyricsKey（手动歌词按曲目存，键要稳）", () => {
  it("服务器 / 在线曲目用 id（本来就稳定）", () => {
    expect(lyricsKey({ id: "abc123", source: "server", title: "歌", artist: "人" })).toBe("abc123");
    expect(lyricsKey({ id: "netease:1", source: "online", title: "歌", artist: "人" })).toBe(
      "netease:1",
    );
  });

  it("本地曲目用“歌手|曲名”——每次拖进来 id 都会变，只有这个留得住", () => {
    expect(lyricsKey({ id: "tmp1", source: "local", title: " 夜曲 ", artist: " 周杰伦 " })).toBe(
      "local:周杰伦|夜曲",
    );
  });
});

describe("sanitizeImportedLyrics（读回来的存档不可信）", () => {
  it("非对象一律当空", () => {
    expect(sanitizeImportedLyrics(null)).toEqual({});
    expect(sanitizeImportedLyrics("not an object")).toEqual({});
    expect(sanitizeImportedLyrics(42)).toEqual({});
  });

  it("丢掉解析不出歌词的条目与非法值（存了进去但已经坏掉的情况）", () => {
    const clean = sanitizeImportedLyrics({
      good: LRC,
      garbage: "这里没有任何时间标签",
      empty: "",
      wrong: 123,
      "": LRC,
    });

    expect(Object.keys(clean)).toEqual(["good"]);
  });

  it("超长内容被截断，不会把整份存档撑爆", () => {
    const long = LRC + "\n" + "[00:05.00]" + "字".repeat(MAX_IMPORTED_CHARS);
    const clean = sanitizeImportedLyrics({ big: long });

    expect(clean.big?.length).toBeLessThanOrEqual(MAX_IMPORTED_CHARS);
  });
});

describe("withImportedLyric / withoutImportedLyric（不改入参，靠换引用触发更新）", () => {
  it("写入返回新对象，原对象不动", () => {
    const before = {};
    const after = withImportedLyric(before, "k", LRC);

    expect(after).toEqual({ k: LRC });
    expect(before).toEqual({});
    expect(after).not.toBe(before);
  });

  it("解析不出歌词就原样返回（调用方据此提示“这份文件里没有歌词”）", () => {
    const before = { k: LRC };

    expect(withImportedLyric(before, "k2", "随便一段文字")).toBe(before);
    expect(withImportedLyric(before, "", LRC)).toBe(before);
  });

  it("移除：有就换新对象，没有就返回原引用", () => {
    const before = { k: LRC };
    const after = withoutImportedLyric(before, "k");

    expect(after).toEqual({});
    expect(before).toEqual({ k: LRC });
    expect(withoutImportedLyric(before, "nope")).toBe(before);
  });
});

describe("pickLyricsSource（LR-02 的来源优先级）", () => {
  it("手动导入 > 内嵌 > 在线", () => {
    expect(pickLyricsSource({ imported: "A", embedded: "B", online: "C" })).toBe("A");
    expect(pickLyricsSource({ embedded: "B", online: "C" })).toBe("B");
    expect(pickLyricsSource({ online: "C" })).toBe("C");
  });

  it("空串 / 纯空白 / null 都算“没有”", () => {
    expect(pickLyricsSource({ imported: "  ", embedded: null, online: "" })).toBe("");
    expect(pickLyricsSource({})).toBe("");
  });
});

describe("decodeLyricsBytes（UTF-8 / UTF-16 / GBK 都要读得出来）", () => {
  it("UTF-8（含 BOM）", () => {
    const encoder = new TextEncoder();

    expect(decodeLyricsBytes(encoder.encode(LRC))).toBe(LRC);
    expect(decodeLyricsBytes(encoder.encode("\uFEFF" + LRC))).toBe(LRC);
  });

  it("UTF-16 LE / BE 靠 BOM 认出来（BOM 会被解码器吞掉，不留在文本里）", () => {
    // "你好" 的 UTF-16 编码：U+4F60 → 0x60 0x4F（LE）/ 0x4F 0x60（BE）
    expect(decodeLyricsBytes(new Uint8Array([0xff, 0xfe, 0x60, 0x4f, 0x7d, 0x59]))).toBe("你好");
    expect(decodeLyricsBytes(new Uint8Array([0xfe, 0xff, 0x4f, 0x60, 0x59, 0x7d]))).toBe("你好");
  });

  it("GBK：UTF-8 读不通时回退一次（老播放器导出的歌词基本都是 GBK）", () => {
    // "你好" 的 GBK 字节
    const gbk = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]);

    expect(decodeLyricsBytes(gbk)).toBe("你好");
  });
});
