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
