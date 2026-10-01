import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { UNKNOWN_ALBUM, UNKNOWN_ARTIST } from "@qingting/shared";
import { parseAudioFile, decodeUploadFileName } from "../src/services/metadata.js";
import { wavBuffer } from "./helpers.js";

async function tempFile(name: string, content: Buffer): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "qingting-meta-"));
  const file = path.join(dir, name);
  await writeFile(file, content);
  return file;
}

/** busboy 按 latin1 读 multipart 里的 filename，中文名上传后会变乱码（实测踩到） */
describe("decodeUploadFileName", () => {
  it("把 latin1 误读的 UTF-8 文件名转回来", () => {
    const mojibake = Buffer.from("BEYOND-海阔天空.wav", "utf8").toString("latin1");
    expect(decodeUploadFileName(mojibake)).toBe("BEYOND-海阔天空.wav");
  });

  it("纯 ASCII 名字原样返回（不要反把正常名字转坏）", () => {
    expect(decodeUploadFileName("AURORA-Cure For Me.flac")).toBe("AURORA-Cure For Me.flac");
  });
});

/** LB-03：服务端解析元数据 + 解析失败回退文件名 */
describe("parseAudioFile", () => {
  it("读得出时长（合成的 1 秒静音 WAV）", async () => {
    const file = await tempFile("sample.wav", wavBuffer(1));
    const parsed = await parseAudioFile(file, "sample.wav");

    expect(parsed.duration).toBe(1);
    expect(parsed.cover).toBeNull();
  });

  it("没有标签时，标题与歌手退到文件名解析（LB-03 / LC-03 同一套规则）", async () => {
    const file = await tempFile("BEYOND-海阔天空.wav", wavBuffer(0.5));
    const parsed = await parseAudioFile(file, "BEYOND-海阔天空.wav");

    expect(parsed.title).toBe("海阔天空");
    expect(parsed.artist).toBe("BEYOND");
    expect(parsed.album).toBe(UNKNOWN_ALBUM);
  });

  it("文件名也解析不出歌手时，歌手记为未知（不编造）", async () => {
    const file = await tempFile("夜行.wav", wavBuffer(0.5));
    const parsed = await parseAudioFile(file, "夜行.wav");

    expect(parsed.title).toBe("夜行");
    expect(parsed.artist).toBe(UNKNOWN_ARTIST);
  });

  it("文件根本不是音频：不抛错，整体退到文件名", async () => {
    const file = await tempFile(
      "A-Lin-给我一个理由忘记.mp3",
      Buffer.from("这不是音频，是一段文本"),
    );
    const parsed = await parseAudioFile(file, "A-Lin-给我一个理由忘记.mp3");

    expect(parsed).toEqual({
      title: "给我一个理由忘记",
      artist: "A-Lin",
      album: UNKNOWN_ALBUM,
      duration: 0,
      cover: null,
    });
  });

  it("文件不存在也不抛错（上传目录被手工动过时仍能收场）", async () => {
    const parsed = await parseAudioFile("/definitely/not/here.wav", "周杰伦-晴天.wav");

    expect(parsed.title).toBe("晴天");
    expect(parsed.artist).toBe("周杰伦");
    expect(parsed.duration).toBe(0);
  });

  it("时长永远是可用的数字（不是 NaN / 负数），前端直接显示", async () => {
    const file = await tempFile("empty.wav", wavBuffer(0));
    const parsed = await parseAudioFile(file, "empty.wav");

    expect(Number.isFinite(parsed.duration)).toBe(true);
    expect(parsed.duration).toBeGreaterThanOrEqual(0);
  });
});
