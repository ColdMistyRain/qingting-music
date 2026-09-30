import { describe, expect, it } from "vitest";
import { collectFilesFromEntries, type DirectoryReaderLike, type EntryLike } from "./fileSystem";

function fakeFile(name: string): File {
  return { name } as File;
}

function fileEntry(name: string): EntryLike {
  return {
    isFile: true,
    isDirectory: false,
    file(onSuccess) {
      onSuccess(fakeFile(name));
    },
  };
}

function brokenEntry(): EntryLike {
  return {
    isFile: true,
    isDirectory: false,
    file(_onSuccess, onError) {
      onError?.(new Error("读取失败"));
    },
  };
}

/** 批次式目录读取器：模拟 Chome 每次最多返回 100 条、读完返回空数组的行为 */
function directoryEntry(batches: EntryLike[][]): EntryLike {
  let call = 0;
  const reader: DirectoryReaderLike = {
    readEntries(onSuccess) {
      onSuccess(batches[call] ?? []);
      call += 1;
    },
  };
  return {
    isFile: false,
    isDirectory: true,
    file(_onSuccess, onError) {
      onError?.(new Error("目录不能当文件读"));
    },
    createReader: () => reader,
  };
}

describe("collectFilesFromEntries", () => {
  it("收集散落的文件", async () => {
    const files = await collectFilesFromEntries([fileEntry("a.mp3"), fileEntry("b.flac")]);
    expect(files.map((file) => file.name)).toEqual(["a.mp3", "b.flac"]);
  });

  it("展开一层目录", async () => {
    const files = await collectFilesFromEntries([directoryEntry([[fileEntry("a.mp3")]])]);
    expect(files.map((file) => file.name)).toEqual(["a.mp3"]);
  });

  it("递归展开多层目录", async () => {
    const nested = directoryEntry([[directoryEntry([[fileEntry("deep.mp3")]])]]);
    const files = await collectFilesFromEntries([nested]);
    expect(files.map((file) => file.name)).toEqual(["deep.mp3"]);
  });

  it("分批读取，直到返回空数组才停（一次最多 100 条）", async () => {
    const batched = directoryEntry([
      [fileEntry("1.mp3"), fileEntry("2.mp3")],
      [fileEntry("3.mp3")],
      [],
    ]);
    const files = await collectFilesFromEntries([batched]);
    expect(files.map((file) => file.name)).toEqual(["1.mp3", "2.mp3", "3.mp3"]);
  });

  it("单个条目读取失败不影响其它文件", async () => {
    const files = await collectFilesFromEntries([brokenEntry(), fileEntry("ok.mp3")]);
    expect(files.map((file) => file.name)).toEqual(["ok.mp3"]);
  });

  it("空输入返回空数组", async () => {
    expect(await collectFilesFromEntries([])).toEqual([]);
  });
});
