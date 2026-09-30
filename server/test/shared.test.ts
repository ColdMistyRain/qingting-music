import { describe, expect, it } from "vitest";
import { fileExtension, hasAccess, isAudioFileName } from "@qingting/shared";

describe("fileExtension", () => {
  it("取小写扩展名", () => {
    expect(fileExtension("song.MP3")).toBe("mp3");
    expect(fileExtension("a.b.flac")).toBe("flac");
  });

  it("无扩展名或点结尾返回空串", () => {
    expect(fileExtension("README")).toBe("");
    expect(fileExtension("noext.")).toBe("");
    expect(fileExtension(".hidden")).toBe("");
  });
});

describe("isAudioFileName", () => {
  it("白名单内命中（LB-02 / LC-02）", () => {
    for (const name of ["a.mp3", "b.flac", "c.WAV", "d.ogg", "e.m4a", "f.aac", "g.opus"]) {
      expect(isAudioFileName(name)).toBe(true);
    }
  });

  it("非音频与伪装扩展名一律拒绝", () => {
    expect(isAudioFileName("cover.jpg")).toBe(false);
    expect(isAudioFileName("a.mp3.exe")).toBe(false);
    expect(isAudioFileName("song")).toBe(false);
  });
});

describe("hasAccess", () => {
  it("访客级：visitor 与 admin 通过，未登录拒绝（AC-03）", () => {
    expect(hasAccess("visitor", "visitor")).toBe(true);
    expect(hasAccess("admin", "visitor")).toBe(true);
    expect(hasAccess("anonymous", "visitor")).toBe(false);
  });

  it("管理级：仅 admin 通过", () => {
    expect(hasAccess("admin", "admin")).toBe(true);
    expect(hasAccess("visitor", "admin")).toBe(false);
    expect(hasAccess("anonymous", "admin")).toBe(false);
  });
});
