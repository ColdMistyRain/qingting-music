import { describe, expect, it } from "vitest";
import {
  localTrackId,
  parseLocalFileName,
  pickAudioFiles,
  probeDuration,
  toLocalTrack,
} from "./localFiles";

/**
 * 文件名回退解析（LC-03）已提到 shared：规则用例统一放在 server/test/shared.test.ts
 * （服务端 LB-03 的回退用的是同一份实现），这里不再重复一份。
 */
describe("parseLocalFileName（shared 的别名）", () => {
  it("客户端调用点拿到的就是 shared 的实现", () => {
    expect(parseLocalFileName("A-Lin-给我一个理由忘记.mp3")).toEqual({
      title: "给我一个理由忘记",
      artist: "A-Lin",
    });
  });
});

describe("pickAudioFiles", () => {
  it("只留下白名单内的音频文件（LC-02）", () => {
    const files = [{ name: "a.mp3" }, { name: "cover.jpg" }, { name: "b.FLAC" }, { name: "note.txt" }];
    expect(pickAudioFiles(files).map((file) => file.name)).toEqual(["a.mp3", "b.FLAC"]);
  });

  it("全部非音频时返回空数组", () => {
    expect(pickAudioFiles([{ name: "a.exe" }])).toEqual([]);
  });
});

describe("toLocalTrack", () => {
  it("组装统一曲目对象：来源 local、专辑固定、时长待探测", () => {
    const track = toLocalTrack(
      { name: "林晚 - 夜行.mp3", size: 1024, lastModified: 1 },
      "blob:http://localhost/abc",
    );
    expect(track).toMatchObject({
      source: "local",
      url: "blob:http://localhost/abc",
      title: "夜行",
      artist: "林晚",
      album: "本地文件",
      cover: null,
      duration: null,
    });
  });

  it("同名同大小同修改时间的文件得到相同 ID（可去重）", () => {
    const a = localTrackId({ name: "a.mp3", size: 1, lastModified: 2 });
    const b = localTrackId({ name: "a.mp3", size: 1, lastModified: 2 });
    const c = localTrackId({ name: "a.mp3", size: 2, lastModified: 2 });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

/** 可控的假 audio 元素：只实现 probeDuration 用到的那几个成员 */
function fakeAudio(duration: number) {
  const listeners = new Map<string, () => void>();
  return {
    preload: "",
    src: "",
    duration,
    addEventListener(type: string, callback: () => void) {
      listeners.set(type, callback);
    },
    emit(type: string) {
      listeners.get(type)?.();
    },
  } as unknown as HTMLAudioElement & { emit(type: string): void };
}

describe("probeDuration", () => {
  it("读到元数据后返回时长", async () => {
    const element = fakeAudio(225);
    const pending = probeDuration("blob:test", () => element);
    element.emit("loadedmetadata");
    await expect(pending).resolves.toBe(225);
  });

  it("时长非法（NaN / 0）视为读不出来", async () => {
    const element = fakeAudio(Number.NaN);
    const pending = probeDuration("blob:test", () => element);
    element.emit("loadedmetadata");
    await expect(pending).resolves.toBeNull();
  });

  it("加载失败返回 null（LC-09 由调用方提示）", async () => {
    const element = fakeAudio(0);
    const pending = probeDuration("blob:broken", () => element);
    element.emit("error");
    await expect(pending).resolves.toBeNull();
  });

  it("重复触发只结算一次", async () => {
    const element = fakeAudio(100);
    const pending = probeDuration("blob:test", () => element);
    element.emit("error");
    element.emit("loadedmetadata");
    await expect(pending).resolves.toBeNull();
  });
});
