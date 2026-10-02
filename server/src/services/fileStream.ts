import { createReadStream } from "node:fs";
import type { Response } from "express";
import { sendFail } from "../http.js";

/** 字节区间（两端都含），与 Range 解析出来的区间同一口径 */
export interface ByteRange {
  start: number;
  end: number;
}

/**
 * 把一个文件（可带字节区间）接到响应上 —— 音频流与封面共用这一条。
 *
 * **为什么不写成 `createReadStream(...).pipe(res)`**（v6.8 修，两处硬伤）：
 * ① `pipe` 只负责搬运，**不把源流的 `'error'` 转给任何人**。文件在 `stat` 之后、
 *    流真正打开之前被删掉（一边放歌一边删歌 / 重建索引，这是真会发生的），
 *    就是一个没有监听者的 `'error'` —— Node 抛未捕获异常，**整个进程退出**；
 * ② 客户端 seek 时频繁 abort，`pipe` 只会 unpipe，**不销毁源流**，fd 要挂到 GC。
 * 所以这里自己接三件事：源流出错 → 回错误或掐断；响应侧结束/出错 → 销毁源流。
 *
 * 失败时怎么回：还没发头（文件根本打不开）就给一个正常的 500 JSON；
 * 已经开始传（`headersSent`）就只能 `destroy()` 掐断 —— 这时改不了状态码了。
 * 客户端自己 abort 也走 `close` 那条，不当成服务端故障。
 *
 * 注：这里**没有**用 `stream/promises` 的 `pipeline()`：它在出错时会**连响应一起销毁**，
 * 「文件打不开」就永远回不出那个 500（实测：`res.destroyed` 已被置真，链子只能提前 return）。
 *
 * `range` 不传即整文件。
 */
export function pipeFile(res: Response, filePath: string, range?: ByteRange): void {
  const file = range
    ? createReadStream(filePath, { start: range.start, end: range.end })
    : createReadStream(filePath);

  file.on("error", () => {
    if (res.destroyed || res.writableEnded) return;
    if (res.headersSent) res.destroy();
    else sendFail(res, 500, "读取文件失败");
  });

  // 响应侧结束（正常传完）或出错（客户端 abort、下游炸掉）都销毁源流：
  // 正常结束时源流本来就已到末尾，这一下是空操作；异常时它是唯一能及时放掉 fd 的地方。
  res.on("close", () => file.destroy());
  res.on("error", () => file.destroy());

  file.pipe(res);
}
