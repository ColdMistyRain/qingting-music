import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  listLyricSongIds,
  lyricsFilePath,
  pruneLyrics,
  readLyrics,
  removeLyrics,
  saveLyrics,
} from "../src/services/lyrics.js";
import { tempDirs } from "./helpers.js";

const LRC = "[ti:海阔天空]\n[00:12.00]今天我\n[00:16.00]寒夜里看雪飘过";

describe("歌词存储（LR-02 云端曲目：一首一份 data/lyrics/<id>.lrc）", () => {
  it("写入后再读回：内容一致", async () => {
    const { dataDir } = await tempDirs();
    await saveLyrics(dataDir, "song-1", LRC);

    expect(await readLyrics(dataDir, "song-1")).toBe(LRC);
    // 落盘位置就是约定的那个路径
    expect(await readFile(lyricsFilePath(dataDir, "song-1"), "utf8")).toBe(LRC);
  });

  it("没写过 / 目录都不存在：读到 null，不抛也不崩", async () => {
    const { dataDir } = await tempDirs();
    expect(await readLyrics(dataDir, "song-1")).toBeNull();

    await saveLyrics(dataDir, "song-2", LRC);
    expect(await readLyrics(dataDir, "song-9")).toBeNull();
  });

  it("空文件当没有歌词（写坏了也不至于给前端一个空歌本）", async () => {
    const { dataDir } = await tempDirs();
    await saveLyrics(dataDir, "song-3", "   \n  ");

    expect(await readLyrics(dataDir, "song-3")).toBeNull();
  });

  it("删除：文件真的没了；重复删也安全", async () => {
    const { dataDir } = await tempDirs();
    await saveLyrics(dataDir, "song-4", LRC);

    await removeLyrics(dataDir, "song-4");
    expect(await readLyrics(dataDir, "song-4")).toBeNull();
    await expect(removeLyrics(dataDir, "song-4")).resolves.toBeUndefined();
  });

  it("曲目 id 里的路径字符被削掉（请求里的字符串不直接拼路径）", async () => {
    const { dataDir } = await tempDirs();
    await saveLyrics(dataDir, "../../etc/passwd", LRC);

    expect(await listLyricSongIds(dataDir)).toEqual(["passwd"]);
  });

  it("pruneLyrics 清掉索引里已经没有的那些（删歌后残留的）", async () => {
    const { dataDir } = await tempDirs();
    await saveLyrics(dataDir, "keep", LRC);
    await saveLyrics(dataDir, "orphan-a", LRC);
    await saveLyrics(dataDir, "orphan-b", LRC);

    expect(await pruneLyrics(dataDir, ["keep"])).toBe(2);
    expect(await listLyricSongIds(dataDir)).toEqual(["keep"]);
  });

  it("重建索引时重写同一首：内容被覆盖，不留 .tmp", async () => {
    const { dataDir } = await tempDirs();
    await saveLyrics(dataDir, "song-5", "[00:01.00]旧歌词");
    await saveLyrics(dataDir, "song-5", "[00:02.00]新歌词");

    expect(await readLyrics(dataDir, "song-5")).toBe("[00:02.00]新歌词");
    await expect(readFile(`${lyricsFilePath(dataDir, "song-5")}.tmp`)).rejects.toThrow();
  });
});

describe("歌词文件写坏时不影响读取路径", () => {
  it("目录里混进非 .lrc 文件：列出来时忽略", async () => {
    const { dataDir } = await tempDirs();
    await saveLyrics(dataDir, "song-6", LRC);
    await writeFile(`${dataDir}/lyrics/notes.txt`, "随手记", "utf8");

    expect(await listLyricSongIds(dataDir)).toEqual(["song-6"]);
  });
});
