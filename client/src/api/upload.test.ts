import { describe, expect, it } from "vitest";
import { ApiError } from "./http";
import { parseUploadResponse } from "./upload";

describe("parseUploadResponse", () => {
  it("成功：取出 data 里的歌曲", () => {
    const body = JSON.stringify({ code: 0, data: { id: "a", title: "晴天" } });
    expect(parseUploadResponse(200, body)).toMatchObject({ id: "a", title: "晴天" });
  });

  it("失败：带出 HTTP 状态与后端消息", () => {
    const body = JSON.stringify({ code: 400, message: "只支持音频文件" });
    expect(() => parseUploadResponse(400, body)).toThrowError(
      expect.objectContaining({ status: 400, message: "只支持音频文件" }),
    );
  });

  it("重复文件：保留业务码，前端据此给“跳过 / 覆盖”分支（LB-02）", () => {
    const body = JSON.stringify({ code: 1001, message: "同名同大小的文件已存在" });
    try {
      parseUploadResponse(409, body);
      throw new Error("本应抛错");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe(1001);
      expect((error as ApiError).status).toBe(409);
    }
  });

  it("响应不是 JSON（网关错误页）时不崩，给出兜底文案", () => {
    expect(() => parseUploadResponse(502, "<html>Bad Gateway</html>")).toThrowError(/HTTP 502/);
  });

  it("HTTP 200 但 code 不为 0 也算失败", () => {
    expect(() => parseUploadResponse(200, JSON.stringify({ code: 500, message: "内部错误" }))).toThrowError(
      "内部错误",
    );
  });
});
