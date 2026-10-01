import { describe, expect, it } from "vitest";
import { formatDateTime, formatSize, formatTime } from "./format";

describe("formatTime", () => {
  it("按 mm:ss 输出，分与秒都补零（v5.57 需求方：“时间改成两位显示”）", () => {
    expect(formatTime(0)).toBe("00:00");
    expect(formatTime(9)).toBe("00:09");
    expect(formatTime(65)).toBe("01:05");
    expect(formatTime(225)).toBe("03:45");
    expect(formatTime(3600)).toBe("60:00");
    expect(formatTime(6000)).toBe("100:00");
    expect(formatTime(59 * 60 + 59)).toBe("59:59");
  });

  it("小数秒向下取整", () => {
    expect(formatTime(59.9)).toBe("00:59");
  });

  it("未知或非法时长返回占位符", () => {
    expect(formatTime(null)).toBe("--:--");
    expect(formatTime(undefined)).toBe("--:--");
    expect(formatTime(-1)).toBe("--:--");
    expect(formatTime(Number.NaN)).toBe("--:--");
  });
});

describe("formatSize", () => {
  it("按 B/KB/MB/GB 逐级换算，保留 1 位小数", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(2048)).toBe("2.0 KB");
    expect(formatSize(300 * 1024 * 1024)).toBe("300.0 MB");
    expect(formatSize(1024 ** 3)).toBe("1.0 GB");
  });

  it("非法值返回破折号", () => {
    expect(formatSize(null)).toBe("—");
    expect(formatSize(-5)).toBe("—");
  });
});

describe("formatDateTime", () => {
  it("解析 ISO 字符串并输出本地时间格式", () => {
    expect(formatDateTime("2026-09-30T10:05:00.000Z")).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("非法时间原样返回", () => {
    expect(formatDateTime("not-a-date")).toBe("not-a-date");
  });
});
