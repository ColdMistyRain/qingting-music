import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";

/**
 * 单文件 JSON 存储 —— 曲库索引 / 歌单 / 收藏与最近播放**共用这一份实现**（v6.8）。
 *
 * 为什么抽出来：这三份数据原先各写了一遍「读文件 → JSON.parse → 原子写」，
 * 于是同一个坑也被抄了三遍（见下）。单进程自用场景没必要上数据库（PRD 5.1），
 * 但「一个文件」不等于「可以不当事」。
 *
 * 这一份实现负责四件事：
 * ① **原子写**：先写 `<目标>.<随机>.tmp` 再 rename（同文件系统内 rename 是原子的）。
 *    随机后缀是必需的：固定 `.tmp` 名时，两个并发写会往**同一个**临时文件里写，
 *    各自的 rename 就可能把交错的内容变成正式文件（v6.8 修）。
 * ② **读-改-写串行化**（`update`）：路由里的「读一份、改一份、写回」是典型的 lost update ——
 *    两个并发上传各自读到同一份旧列表，后写的那个把先写的整条覆盖掉。
 *    同一份文件的所有 `update` 在进程内排成一条链，逐个执行（单进程部署，这就够了）。
 * ③ **坏文件留证**：解析失败时先把原文件改名成 `<文件名>.bad-<时间戳>` 再当空，
 *    而不是直接返回空 —— 否则下一次写入就把现场盖掉，**整份数据永久丢失**。
 * ④ 解析与清洗交给调用方（`parse`）：脏条目在那里被剔除，形状完全不对就抛错（按坏文件处理）。
 */

export interface JsonStore<T> {
  /** 这份数据在某个数据目录下的完整路径 */
  filePath(dataDir: string): string;
  load(dataDir: string): Promise<T>;
  save(dataDir: string, value: T): Promise<void>;
  /** 读-改-写（串行）；mutator **返回同一个引用**表示“没什么要改的”，这时不落盘 */
  update(dataDir: string, change: (current: T) => T | Promise<T>): Promise<T>;
}

export interface JsonStoreOptions<T> {
  /** 数据目录下的文件名，如 `songs.json` */
  fileName: string;
  /** 文件不存在 / 读坏时的兜底值（每次现造，避免调用方改到同一个共享对象） */
  fallback: () => T;
  /** 解析 + 清洗；形状完全不对时抛错（会被当成坏文件留证） */
  parse: (value: unknown) => T;
}

/** 同一份文件一条队列：前一个任务结算完（无论成败）再跑下一个 */
const queues = new Map<string, Promise<unknown>>();

function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  // 前一个失败不该挡住后面那个：两个分支都接同一个 task
  const next = previous.then(task, task);
  // 存进 Map 的这份**永远不 reject**，否则没人接的 rejection 会冒成未处理异常
  queues.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

export function createJsonStore<T>(options: JsonStoreOptions<T>): JsonStore<T> {
  const { fileName, fallback, parse } = options;
  const filePath = (dataDir: string): string => path.join(dataDir, fileName);

  /** 解析失败：把坏文件挪到一边留证（挪不动也不报错，至少要保住“不当场覆盖”） */
  async function quarantine(target: string, error: unknown): Promise<void> {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const aside = `${target}.bad-${stamp}`;
    console.error(`[server] ${fileName} 解析失败，已留证为 ${path.basename(aside)}：`, error);
    await rename(target, aside).catch(() => undefined);
  }

  async function load(dataDir: string): Promise<T> {
    const target = filePath(dataDir);
    let raw: string;
    try {
      raw = await readFile(target, "utf8");
    } catch {
      // 不存在（或读不到）：当空，不当坏文件 —— 首次启动就是这条路径
      return fallback();
    }
    try {
      return parse(JSON.parse(raw));
    } catch (error) {
      await quarantine(target, error);
      return fallback();
    }
  }

  /** 原子写。**不排队**，只给内部（save / update）用 —— 自己再排队就是死锁 */
  async function writeNow(dataDir: string, value: T): Promise<void> {
    const target = filePath(dataDir);
    await mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.${nanoid()}.tmp`;
    await writeFile(temp, JSON.stringify(value, null, 2), "utf8");
    await rename(temp, target);
  }

  return {
    filePath,
    load,

    /** 写入：也走那把队列 —— Windows 上两个并发 rename 到同一个目标是 EPERM（v6.8 实测） */
    save(dataDir: string, value: T): Promise<void> {
      return enqueue(filePath(dataDir), () => writeNow(dataDir, value));
    },

    update(dataDir: string, change: (current: T) => T | Promise<T>): Promise<T> {
      return enqueue(filePath(dataDir), async () => {
        const current = await load(dataDir);
        const next = await change(current);
        if (next !== current) await writeNow(dataDir, next);
        return next;
      });
    },
  };
}
