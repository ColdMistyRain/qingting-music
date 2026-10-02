import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { apiNotFound, errorHandler, sendFail, sendOk } from "../src/http.js";

describe("统一响应结构（PRD 5.6.2）", () => {
  it("成功：{ code: 0, data }，可指定状态码", async () => {
    const app = express();
    app.get("/ok", (_req, res) => sendOk(res, { hello: "世界" }));
    app.post("/created", (_req, res) => sendOk(res, { id: "x" }, 201));

    expect((await request(app).get("/ok")).body).toEqual({ code: 0, data: { hello: "世界" } });
    const created = await request(app).post("/created");
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ code: 0, data: { id: "x" } });
  });

  it("失败：HTTP 状态码 + { code, message }，业务码只在前端需要分支时才给", async () => {
    const app = express();
    app.get("/plain", (_req, res) => sendFail(res, 404, "没有这个"));
    app.get("/coded", (_req, res) => sendFail(res, 409, "重复了", 1001));

    const plain = await request(app).get("/plain");
    expect(plain.status).toBe(404);
    expect(plain.body).toEqual({ code: 404, message: "没有这个" });

    const coded = await request(app).get("/coded");
    expect(coded.status).toBe(409);
    expect(coded.body).toEqual({ code: 1001, message: "重复了" });
  });

  it("未匹配的 /api 路径：JSON 404（不能是 HTML，否则前端会拿到一坨 index.html）", async () => {
    const app = express();
    app.get("/api/anything", apiNotFound);

    const res = await request(app).get("/api/anything");
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.body.message).toBe("接口不存在");
  });
});

describe("errorHandler（兜底错误处理）", () => {
  it("路由里抛错 → 500 + { code: 500, message }，且**不向前端泄露堆栈**", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = express();
    app.get("/boom", () => {
      throw new Error("内部细节：D:/secret/path");
    });
    app.use(errorHandler);

    const res = await request(app).get("/boom");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ code: 500, message: "服务器内部错误" });
    expect(JSON.stringify(res.body)).not.toContain("secret");
    // 服务端自己要看得到（排查全靠它）
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it("响应头已经发出去时不再改响应（交给 Node 断连，否则会二次写入）", () => {
    const json = vi.fn();
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = { headersSent: true, status: vi.fn(), json } as unknown as Response;

    errorHandler(new Error("传输中途炸了"), {} as Request, res, (() => undefined) as NextFunction);

    expect(json).not.toHaveBeenCalled();
    logged.mockRestore();
  });
});
