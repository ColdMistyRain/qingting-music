import request, { type Response as SuperTestResponse } from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { LOGIN_MAX_FAILURES } from "../src/config.js";
import { testConfig } from "./helpers.js";

/** 取响应里的第一条 Cookie（去掉属性部分，便于回传） */
function firstCookie(res: SuperTestResponse): string {
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  return (list[0] ?? "").split(";")[0] ?? "";
}

const LOCKED = { userPassword: "guest-pass", adminPassword: "root-pass", authEnabled: true };

describe("GET /api/health", () => {
  it("返回服务状态（成功响应恒为 code:0）", async () => {
    const res = await request(createApp(testConfig())).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data.status).toBe("ok");
  });
});

describe("GET /api/config", () => {
  it("未配置外接音源时也在线可用（v6.29 内嵌默认启用），并给出上传上限（LB-02）", async () => {
    const res = await request(createApp(testConfig({ maxUploadSize: 1024 }))).get("/api/config");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ onlineEnabled: true, maxUploadSize: 1024 });
  });

  it("配置音源后 onlineEnabled = true", async () => {
    // 上传上限显式给一个值：原先靠的是那份“重复的 testConfig 默认 1024”，
    // 两份默认值不一致，换个来源就会静默变化（报告第 14 条）
    const app = createApp(
      testConfig({
        neteaseApiBase: "http://localhost:4000",
        onlineEnabled: true,
        maxUploadSize: 2048,
      }),
    );
    const res = await request(app).get("/api/config");
    expect(res.body.data).toEqual({ onlineEnabled: true, maxUploadSize: 2048 });
  });
});

describe("未知接口", () => {
  it("/api 下未匹配路径返回 JSON 404 而非 HTML", async () => {
    const res = await request(createApp(testConfig())).get("/api/not-exist");
    expect(res.status).toBe(404);
    expect(res.body.message).toBe("接口不存在");
  });
});

describe("GET /api/auth/status", () => {
  it("门禁关闭时视为管理员，全功能开放（AC-05）", async () => {
    const res = await request(createApp(testConfig())).get("/api/auth/status");
    expect(res.body.data).toEqual({ authEnabled: false, role: "admin" });
  });

  it("门禁开启且未带凭证时为未登录（AC-01）", async () => {
    const res = await request(createApp(testConfig(LOCKED))).get("/api/auth/status");
    expect(res.body.data).toEqual({ authEnabled: true, role: "anonymous" });
  });
});

describe("POST /api/auth/login", () => {
  it("访客密码登录得到 visitor 凭证", async () => {
    const app = createApp(testConfig(LOCKED));
    const res = await request(app).post("/api/auth/login").send({ password: "guest-pass" });
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe("visitor");

    const status = await request(app).get("/api/auth/status").set("Cookie", firstCookie(res));
    expect(status.body.data.role).toBe("visitor");
  });

  it("管理员密码登录得到 admin 凭证（AC-02 单密码自动识别角色）", async () => {
    const app = createApp(testConfig(LOCKED));
    const res = await request(app).post("/api/auth/login").send({ password: "root-pass" });
    expect(res.body.data.role).toBe("admin");

    const status = await request(app).get("/api/auth/status").set("Cookie", firstCookie(res));
    expect(status.body.data.role).toBe("admin");
  });

  it("密码错误返回 401 且不下发凭证", async () => {
    const res = await request(createApp(testConfig(LOCKED)))
      .post("/api/auth/login")
      .send({ password: "nope" });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("访问密码不正确");
    expect(firstCookie(res)).toBe("");
  });

  it("未配置门禁时登录接口直接拒绝", async () => {
    const res = await request(createApp(testConfig()))
      .post("/api/auth/login")
      .send({ password: "anything" });
    expect(res.status).toBe(400);
  });

  it("伪造凭证不会被认可", async () => {
    const app = createApp(testConfig(LOCKED));
    const status = await request(app)
      .get("/api/auth/status")
      .set("Cookie", "qt_auth=1.admin.deadbeef");
    expect(status.body.data.role).toBe("anonymous");
  });

  it("连续失败超限后返回 429（AC-06）", async () => {
    const app = createApp(testConfig(LOCKED));
    let last = 0;
    for (let i = 0; i < LOGIN_MAX_FAILURES + 1; i += 1) {
      const res = await request(app).post("/api/auth/login").send({ password: "wrong" });
      last = res.status;
    }
    expect(last).toBe(429);
  });

  /* 限速按 req.ip 计数，而 req.ip 受 `trust proxy` 影响（v6.8）。默认 **不信任**：
     直连部署时客户端自己塞 X-Forwarded-For 也换不来新名额 —— 否则“每次换一个 IP”就绕过了 AC-06。 */
  it("默认不信任 X-Forwarded-For：换着伪造也照样被限速", async () => {
    const app = createApp(testConfig(LOCKED));
    let last = 0;
    for (let i = 0; i < LOGIN_MAX_FAILURES + 1; i += 1) {
      const res = await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", `10.0.0.${i}`)
        .send({ password: "wrong" });
      last = res.status;
    }
    expect(last).toBe(429);
  });

  it("显式打开 TRUST_PROXY 后按代理给的 IP 计数（部署方自己负责别直连暴露）", async () => {
    const app = createApp(testConfig({ ...LOCKED, trustProxy: 1 }));
    let last = 0;
    for (let i = 0; i < LOGIN_MAX_FAILURES + 1; i += 1) {
      const res = await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", `10.0.0.${i}`)
        .send({ password: "wrong" });
      last = res.status;
    }
    expect(last).toBe(401); // 没被限速：每个伪造 IP 都算一个新来源
  });
});

describe("POST /api/auth/logout", () => {
  it("清除凭证后回到未登录（AC-04）", async () => {
    const app = createApp(testConfig(LOCKED));
    const login = await request(app).post("/api/auth/login").send({ password: "root-pass" });
    const logout = await request(app).post("/api/auth/logout").set("Cookie", firstCookie(login));
    expect(logout.body.data.role).toBe("anonymous");

    const status = await request(app).get("/api/auth/status").set("Cookie", firstCookie(logout));
    expect(status.body.data.role).toBe("anonymous");
  });
});
