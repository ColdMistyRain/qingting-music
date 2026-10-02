import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { finished } from "node:stream/promises";
import { describe, expect, it } from "vitest";
import type { Response } from "express";
import { pipeFile } from "../src/services/fileStream.js";

/** 造一个够用的假响应：既是可写流（pipe 的终点），又带 status/json 记账 */
function fakeRes(options: { failAfterFirstChunk?: boolean } = {}) {
  const chunks: Buffer[] = [];
  const record = { statusCode: 0, body: null as unknown };
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      if (options.failAfterFirstChunk) {
        // 模拟“传输中途断掉”：下游自己炸掉，源流必须被销毁
        callback(new Error("下游断了"));
        return;
      }
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  const res = Object.assign(stream, {
    status(code: number) {
      record.statusCode = code;
      return res;
    },
    json(body: unknown) {
      record.body = body;
      return res;
    },
  });
  return { res: res as unknown as Response, chunks, record };
}

/** 等一件异步发生的事情成立（流事件都在下一个 tick 之后才到） */
async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("等待超时");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function tempFile(content: Buffer): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "qingting-stream-"));
  const file = path.join(dir, "audio.bin");
  await writeFile(file, content);
  return file;
}

describe("pipeFile", () => {
  it("整文件：字节原样接到响应上", async () => {
    const payload = Buffer.from("0123456789");
    const file = await tempFile(payload);
    const { res, chunks, record } = fakeRes();

    pipeFile(res, file);
    await finished(res);

    expect(Buffer.concat(chunks)).toEqual(payload);
    expect(record.statusCode).toBe(0); // 正常路径不该写任何错误响应
  });

  it("带区间：只发那一段", async () => {
    const payload = Buffer.from("0123456789");
    const file = await tempFile(payload);
    const { res, chunks } = fakeRes();

    pipeFile(res, file, { start: 2, end: 5 });
    await finished(res);

    expect(Buffer.concat(chunks).toString()).toBe("2345");
  });

  it("文件打不开：不把异常抛给上层（以前这里能让进程退出），回 500 JSON", async () => {
    const { res, record } = fakeRes();

    pipeFile(res, path.join(tmpdir(), "qingting-不存在.mp3"));
    await waitFor(() => record.statusCode === 500);

    expect(record.body).toEqual({ code: 500, message: "读取文件失败" });
  });

  it("传输中途断开：不去写已经发不出去的响应，也不抛异常", async () => {
    const file = await tempFile(Buffer.alloc(64 * 1024, 1));
    const { res, record } = fakeRes({ failAfterFirstChunk: true });

    pipeFile(res, file);
    await waitFor(() => res.destroyed);

    expect(record.statusCode).toBe(0);
    expect(record.body).toBeNull();
  });
});
