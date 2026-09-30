import { describe, expect, it } from "vitest";
import {
  localTrackId,
  parseLocalFileName,
  pickAudioFiles,
  probeDuration,
  toLocalTrack,
} from "./localFiles";

describe("parseLocalFileName", () => {
  it("按「歌手 - 歌名」拆分（LC-03）", () => {
    expect(parseLocalFileName("周杰伦 - 晴天.mp3")).toEqual({ title: "晴天", artist: "周杰伦" });
    expect(parseLocalFileName("林晚 - 夜行.flac")).toEqual({ title: "夜行", artist: "林晚" });
  });

  it("破折号与长破折号同样识别", () => {
    expect(parseLocalFileName("陈屿 – 夏日终结.mp3").artist).toBe("陈屿");
    expect(parseLocalFileName("星野 — 焰火.mp3").artist).toBe("星野");
  });

  it("剥掉曲序前缀再取歌手与歌名", () => {
    expect(parseLocalFileName("01. 周杰伦 - 晴天.mp3")).toEqual({ title: "晴天", artist: "周杰伦" });
    expect(parseLocalFileName("12_ 蓝溪 - 深海信笺.wav")).toEqual({ title: "深海信笺", artist: "蓝溪" });
  });

  it("识别不出歌手时整段作歌名、歌手记为未知", () => {
    expect(parseLocalFileName("夜行.mp3")).toEqual({ title: "夜行", artist: "未知歌手" });
    expect(parseLocalFileName("track01")).toEqual({ title: "track01", artist: "未知歌手" });
  });

  it("不吃掉名字里的连字符（A-Lin 这类）", () => {
    expect(parseLocalFileName("A-Lin.mp3")).toEqual({ title: "A-Lin", artist: "未知歌手" });
  });

  it("支持无空格连字符命名（真实曲库习惯：歌手-歌名.mp3）", () => {
    expect(parseLocalFileName("BEYOND-海阔天空.mp3")).toEqual({ title: "海阔天空", artist: "BEYOND" });
    expect(parseLocalFileName("A-Lin-给我一个理由忘记.mp3")).toEqual({
      title: "给我一个理由忘记",
      artist: "A-Lin",
    });
    expect(parseLocalFileName("G.E.M. 邓紫棋-光年之外.mp3")).toEqual({
      title: "光年之外",
      artist: "G.E.M. 邓紫棋",
    });
    expect(parseLocalFileName("AURORA-Cure For Me.flac")).toEqual({
      title: "Cure For Me",
      artist: "AURORA",
    });
  });

  it("按最后一个连字符拆，保留歌手名里的连字符", () => {
    expect(parseLocalFileName("Jake Miller&HOYO-MiX-WHITE NIGHT.mp3")).toEqual({
      title: "WHITE NIGHT",
      artist: "Jake Miller&HOYO-MiX",
    });
    expect(parseLocalFileName("伍佰 & China Blue-挪威的森林.mp3")).toEqual({
      title: "挪威的森林",
      artist: "伍佰 & China Blue",
    });
  });

  it("空文件名不崩", () => {
    expect(parseLocalFileName("")).toEqual({ title: "", artist: "未知歌手" });
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
