import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AppConfig } from "../src/config.js";

/** 每个用例一套独立临时目录：曲库索引与上传文件都落在里面，互不干扰 */
export async function tempDirs(): Promise<{ dataDir: string; uploadDir: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "qingting-"));
  return { dataDir: path.join(root, "data"), uploadDir: path.join(root, "uploads") };
}

/** 测试用配置：默认门禁关闭（AC-05 的最小运行形态） */
export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0,
    dataDir: "./data",
    uploadDir: "./uploads",
    maxUploadSize: 1024 * 1024,
    userPassword: null,
    adminPassword: null,
    authSecret: "test-secret",
    authTtlMs: 60 * 60 * 1000,
    authEnabled: false,
    neteaseApiBase: null,
    onlineEnabled: false,
    ...overrides,
  };
}

/**
 * 合成一段静音 WAV 当上传样本：不用往仓库里塞二进制测试文件，
 * 又能真的走一遍 music-metadata（LB-03 的元数据解析）。
 * 8000Hz / 单声道 / 16bit，数据区全 0，时长即参数秒数。
 */
export function wavBuffer(seconds: number): Buffer {
  const sampleRate = 8000;
  const channels = 1;
  const bytesPerSample = 2;
  const dataLength = Math.round(sampleRate * seconds) * channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataLength);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(8 * bytesPerSample, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataLength, 40);

  return buffer;
}

/**
 * 合成一个**带内嵌歌词的 MP3**（ID3v2.3 的 USLT 帧 + 若干合法 MPEG 帧）。
 *
 * 为什么要手工拼：内嵌歌词（LR-02）是"上传时就解析"的能力，必须有能真跑的样本，
 * 而仓库里不放二进制素材。ID3v2.3 的 USLT 结构是
 * `编码(1) + 语言(3) + 描述(以 0 结尾) + 正文`；正文用 latin1（v2.3 不支持 UTF-8，
 * 测试只关心"能不能抽出来"，正文用 ASCII 就够）。
 * 后面接 4 个 128kbps / 44.1kHz 的静音帧，让 music-metadata 认得出这是 MP3、算得出时长。
 */
export function mp3WithLyrics(lyrics: string): Buffer {
  const body = Buffer.concat([
    Buffer.from([0x00]), // 编码：latin1
    Buffer.from("XXX", "ascii"), // 语言
    Buffer.from([0x00]), // 描述（空，直接以 0 结束）
    Buffer.from(lyrics, "latin1"),
  ]);

  const frame = Buffer.alloc(10 + body.length);
  frame.write("USLT", 0, "ascii");
  frame.writeUInt32BE(body.length, 4); // v2.3：帧长度不是 synchsafe
  frame.writeUInt16BE(0, 8); // 帧标志
  body.copy(frame, 10);

  const tag = Buffer.alloc(10 + frame.length);
  tag.write("ID3", 0, "ascii");
  tag.writeUInt8(3, 3); // 主版本
  tag.writeUInt8(0, 4); // 次版本
  tag.writeUInt8(0, 5); // 标志
  tag.writeUInt32BE(frame.length, 6); // 标签长度（这里足够小，不必按 synchsafe 编码）
  frame.copy(tag, 10);

  // 128kbps / 44.1kHz / 单声道 的 MPEG-1 Layer III 帧：4 字节头 + 413 字节数据
  const audioFrame = Buffer.alloc(417);
  audioFrame.writeUInt32BE(0xfffb9000, 0);
  const audio = Buffer.concat([audioFrame, audioFrame, audioFrame, audioFrame]);

  return Buffer.concat([tag, audio]);
}
