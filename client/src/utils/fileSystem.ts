/**
 * 拖入文件夹的递归收集（PRD LC-01）。
 * 只依赖浏览器 FileSystemEntry 的最小接口，因此可用假对象完整单测。
 */

export interface DirectoryReaderLike {
  readEntries(onSuccess: (entries: EntryLike[]) => void, onError?: (error: unknown) => void): void;
}

export interface EntryLike {
  isFile: boolean;
  isDirectory: boolean;
  file(onSuccess: (file: File) => void, onError?: (error: unknown) => void): void;
  createReader?(): DirectoryReaderLike;
}

/** 递归收集拖入项里的全部文件（文件夹会展开） */
export async function collectFilesFromEntries(entries: readonly EntryLike[]): Promise<File[]> {
  const files: File[] = [];
  for (const entry of entries) {
    if (entry.isFile) {
      const file = await readFileEntry(entry);
      if (file) files.push(file);
    } else if (entry.isDirectory && entry.createReader) {
      files.push(...(await readDirectory(entry.createReader())));
    }
  }
  return files;
}

function readFileEntry(entry: EntryLike): Promise<File | null> {
  return new Promise((resolve) => {
    entry.file(
      (file) => resolve(file),
      () => resolve(null),
    );
  });
}

async function readDirectory(reader: DirectoryReaderLike): Promise<File[]> {
  const files: File[] = [];
  // readEntries 每次最多返回 100 条，必须一直读到返回空数组为止
  for (;;) {
    const batch = await readEntriesOnce(reader);
    if (batch.length === 0) break;
    files.push(...(await collectFilesFromEntries(batch)));
  }
  return files;
}

function readEntriesOnce(reader: DirectoryReaderLike): Promise<EntryLike[]> {
  return new Promise((resolve) => {
    reader.readEntries(
      (entries) => resolve(entries),
      () => resolve([]),
    );
  });
}
