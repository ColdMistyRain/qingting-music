/**
 * 带并发上限的批量映射（v6.9）。
 *
 * 为什么需要它：拖入一个文件夹就是几百个文件，而每个文件都要走一遍**整文件解析**
 * （读标签 / 探测时长）。无上限地 `forEach + void promise` 会让几百个解析同时开工 ——
 * 内存峰值与主线程调度一起炸（`D:\Music` 实测规模就是 369 MP3 + 4 FLAC）。
 *
 * 语义（都有单测）：
 * - 返回的数组与入参**一一对应**（顺序不因完成先后而变）；
 * - 同时进行的任务数不超过 `limit`（`limit < 1` 按 1 处理）；
 * - 某个任务失败**不影响**其它任务，只把那一项留作 `null`（调用方自己决定怎么兜底）；
 * - 空数组直接返回，不排任何微任务。
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null);
  if (items.length === 0) return results;

  const workers = Math.min(Math.max(1, Math.floor(limit)), items.length);
  let next = 0;

  async function run(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      const item = items[index]!;
      try {
        results[index] = await worker(item, index);
      } catch {
        // 单件失败不连坐：留 null，调用方按“这一件没能读到”处理
        results[index] = null;
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, run));
  return results;
}
