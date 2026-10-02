import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createJsonStore } from "../src/services/jsonStore.js";
import { loadSongs } from "../src/services/storage.js";
import { tempDirs, testConfig, wavBuffer } from "./helpers.js";

/** 测试用的最小 store：一个数字数组 */
const numbersStore = createJsonStore<number[]>({
  fileName: "numbers.json",
  fallback: () => [],
  parse: (value) => {
    if (!Array.isArray(value)) throw new Error("不是数组");
    return value as number[];
  },
});

async function dataDir(): Promise<string> {
  return (await tempDirs()).dataDir;
}

describe("createJsonStore：读写与原子写", () => {
  it("save → load 往返；数据目录不存在时自动建出来", async () => {
    const dir = await dataDir();
    await numbersStore.save(dir, [1, 2, 3]);

    expect(await numbersStore.load(dir)).toEqual([1, 2, 3]);
    expect(await stat(path.join(dir, "numbers.json"))).toBeTruthy();
  });

  it("文件不存在：给兜底值，不报错（首次启动就是这条路径）", async () => {
    const dir = await dataDir();
    expect(await numbersStore.load(dir)).toEqual([]);
  });

  it("并发写不会写出交错内容（临时名带随机后缀）", async () => {
    const dir = await dataDir();
    const a = Array.from({ length: 50 }, () => 1);
    const b = Array.from({ length: 50 }, () => 2);

    await Promise.all([numbersStore.save(dir, a), numbersStore.save(dir, b)]);

    // 无论谁赢，都必须是"完整的那一份"，不能是两份拼起来的
    const loaded = await numbersStore.load(dir);
    expect([JSON.stringify(a), JSON.stringify(b)]).toContain(JSON.stringify(loaded));
    // 临时文件不留残渣
    expect((await readdir(dir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});

describe("createJsonStore：坏文件留证", () => {
  it("内容不是合法 JSON：当空，并把坏文件改名留证（不当场覆盖）", async () => {
    const dir = await dataDir();
    const target = path.join(dir, "numbers.json");
    await numbersStore.save(dir, [1]);
    await writeFile(target, "{ 这不是 JSON", "utf8");

    expect(await numbersStore.load(dir)).toEqual([]);

    const names = await readdir(dir);
    // 坏文件被挪走了（改名留证），原来的名字上不留残骸
    expect(names).not.toContain("numbers.json");
    const quarantined = names.filter((name) => name.startsWith("numbers.json.bad-"));
    expect(quarantined).toHaveLength(1);
    expect(await readFile(path.join(dir, quarantined[0]!), "utf8")).toBe("{ 这不是 JSON");
    // 下一次写从兜底值开始，而不是把现场盖掉
    expect(await numbersStore.update(dir, (current) => [...current, 1])).toEqual([1]);
  });

  it("形状不对（该是数组却是对象）：同样按坏文件处理", async () => {
    const dir = await dataDir();
    const target = path.join(dir, "numbers.json");
    await numbersStore.save(dir, [1]);
    await writeFile(target, JSON.stringify({ nope: true }), "utf8");

    expect(await numbersStore.load(dir)).toEqual([]);
    expect((await readdir(dir)).some((name) => name.startsWith("numbers.json.bad-"))).toBe(true);
  });
});

describe("createJsonStore：读-改-写串行（lost update）", () => {
  it("20 个并发 update 各加一条：一条都不能丢", async () => {
    const dir = await dataDir();

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        numbersStore.update(dir, (current) => [...current, index]),
      ),
    );

    const loaded = await numbersStore.load(dir);
    expect(loaded).toHaveLength(20);
    expect([...loaded].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it("mutator 原样返回同一个引用 = 没什么要改：不落盘（连数据目录都不建）", async () => {
    const dir = await dataDir();

    const result = await numbersStore.update(dir, (current) => current);

    expect(result).toEqual([]);
    await expect(stat(dir)).rejects.toThrow();
  });

  it("坏文件之后接着 update：从兜底值开始写，留证文件还在", async () => {
    const dir = await dataDir();
    const target = path.join(dir, "numbers.json");
    await numbersStore.save(dir, [1]);
    await writeFile(target, "坏了", "utf8");

    const next = await numbersStore.update(dir, (current) => [...current, 7]);

    expect(next).toEqual([7]);
    expect(await numbersStore.load(dir)).toEqual([7]);
    expect((await readdir(dir)).some((name) => name.startsWith("numbers.json.bad-"))).toBe(true);
  });
});

describe("路由层：并发上传不丢更新（端到端）", () => {
  it("同时上传两首不同的歌：索引里两首都在", async () => {
    const dirs = await tempDirs();
    const config = testConfig({ ...dirs });
    const app = createApp(config);

    const [first, second] = await Promise.all([
      request(app).post("/api/songs/upload").attach("file", wavBuffer(1), "A-第一首.wav"),
      request(app).post("/api/songs/upload").attach("file", wavBuffer(1), "B-第二首.wav"),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const songs = await loadSongs(config.dataDir);
    // 两首都在：先写的那个没被后写的整份覆盖掉
    expect(songs).toHaveLength(2);
    expect(songs.map((song) => song.storedName).sort()).toEqual(
      [first.body.data.storedName, second.body.data.storedName].sort(),
    );
  });
});
