import { describe, expect, it } from "vitest";
import { coverUrlFrom, pickTags } from "./metadata";

describe("pickTags", () => {
  it("取出标题、歌手、专辑与时长", () => {
    const tags = pickTags({
      common: { title: "夜行", artist: "林晚", album: "城市霓虹" },
      format: { duration: 225.4 },
    });
    expect(tags).toMatchObject({ title: "夜行", artist: "林晚", album: "城市霓虹", duration: 225.4 });
  });

  it("空白字符串与缺失字段一律为 null（不猜值）", () => {
    const tags = pickTags({ common: { title: "   ", artist: undefined } });
    expect(tags.title).toBeNull();
    expect(tags.artist).toBeNull();
    expect(tags.album).toBeNull();
    expect(tags.duration).toBeNull();
    expect(tags.picture).toBeNull();
  });

  it("时长非法（NaN / 0 / 负数）视为读不出", () => {
    expect(pickTags({ format: { duration: Number.NaN } }).duration).toBeNull();
    expect(pickTags({ format: { duration: 0 } }).duration).toBeNull();
    expect(pickTags({ format: { duration: -3 } }).duration).toBeNull();
  });

  it("取第一张内嵌封面并补上默认 MIME", () => {
    const tags = pickTags({
      common: { picture: [{ data: [1, 2, 3] }, { data: [9], format: "image/png" }] },
    });
    expect(tags.picture?.format).toBe("image/jpeg");
    expect([...(tags.picture?.data ?? [])]).toEqual([1, 2, 3]);
  });

  it("封面数据是数字数组时也转成 Uint8Array", () => {
    const tags = pickTags({ common: { picture: [{ data: [255, 216, 255], format: "image/png" }] } });
    expect(tags.picture?.data).toBeInstanceOf(Uint8Array);
    expect(tags.picture?.format).toBe("image/png");
  });

  it("解析结果为空对象时不崩", () => {
    expect(pickTags({})).toEqual({
      title: null,
      artist: null,
      album: null,
      duration: null,
      picture: null,
    });
  });
});

describe("coverUrlFrom", () => {
  it("无封面返回 null", () => {
    expect(coverUrlFrom(null)).toBeNull();
  });

  it("有封面时返回可直接绑到 img 的 Blob URL", () => {
    const url = coverUrlFrom({ data: new Uint8Array([1, 2, 3]), format: "image/jpeg" });
    expect(url?.startsWith("blob:")).toBe(true);
    if (url) URL.revokeObjectURL(url);
  });
});
