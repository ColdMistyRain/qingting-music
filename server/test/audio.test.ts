import { type IncomingMessage } from "node:http";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { tempDirs, testConfig, wavBuffer } from "./helpers.js";

async function setup(overrides: Record<string, unknown> = {}) {
  const dirs = await tempDirs();
  const config = testConfig({ ...dirs, ...overrides });
  return { app: createApp(config), config };
}

/** 上传一首，返回它的 storedName 与完整记录 */
async function uploadOne(app: ReturnType<typeof createApp>, name = "BEYOND-海阔天空.wav") {
  const res = await request(app).post("/api/songs/upload").attach("file", wavBuffer(1), name);
  return res.body.data as { id: string; storedName: string; size: number };
}

/** LB-06：按 HTTP Range 响应音频流，边界值见 PRD 11.2 */
describe("GET /audio/:storedName", () => {
  it("整文件请求：200 + Accept-Ranges + 正确 Content-Length", async () => {
    const { app } = await setup();
    const song = await uploadOne(app);

    const res = await request(app).get(`/audio/${song.storedName}`).buffer(true).parse(binaryParser);

    expect(res.status).toBe(200);
    expect(res.headers["accept-ranges"]).toBe("bytes");
    expect(Number(res.headers["content-length"])).toBe(song.size);
    expect(res.headers["content-type"]).toContain("audio/wav");
  });

  it("带 Range：206 + Content-Range + 只回那段字节", async () => {
    const { app } = await setup();
    const song = await uploadOne(app);

    const res = await request(app)
      .get(`/audio/${song.storedName}`)
      .set("Range", "bytes=0-9")
      .buffer(true)
      .parse(binaryParser);

    expect(res.status).toBe(206);
    expect(res.headers["content-range"]).toBe(`bytes 0-9/${song.size}`);
    expect(Number(res.headers["content-length"])).toBe(10);
    expect(res.body.length).toBe(10);
  });

  it("后缀区间（拖到末尾续播）：206 且落在文件尾部", async () => {
    const { app } = await setup();
    const song = await uploadOne(app);

    const res = await request(app)
      .get(`/audio/${song.storedName}`)
      .set("Range", "bytes=-10")
      .buffer(true)
      .parse(binaryParser);

    expect(res.status).toBe(206);
    expect(res.headers["content-range"]).toBe(`bytes ${song.size - 10}-${song.size - 1}/${song.size}`);
  });

  it("区间越界：416 + Content-Range: bytes */size（浏览器据此重试整文件）", async () => {
    const { app } = await setup();
    const song = await uploadOne(app);

    const res = await request(app).get(`/audio/${song.storedName}`).set("Range", `bytes=${song.size}-`);

    expect(res.status).toBe(416);
    expect(res.headers["content-range"]).toBe(`bytes */${song.size}`);
  });

  it("非法 Range 语法按忽略处理，回整文件 200", async () => {
    const { app } = await setup();
    const song = await uploadOne(app);

    const res = await request(app).get(`/audio/${song.storedName}`).set("Range", "bytes=abc");

    expect(res.status).toBe(200);
  });

  it("文件不存在：404；名字里带路径分隔符：直接挡掉", async () => {
    const { app } = await setup();

    expect((await request(app).get("/audio/not-here.wav")).status).toBe(404);
    expect((await request(app).get("/audio/..%2Fdata%2Fsongs.json")).status).toBe(404);
  });
});

/** 封面（内嵌封面落盘后的文件）：只放图片扩展名，不能顺手把 uploads 整个静态托管出去 */
describe("GET /covers/:name", () => {
  it("图片文件名正常回图；非图片扩展名一律 404（否则音频就能绕过门禁）", async () => {
    const { app } = await setup();
    const song = await uploadOne(app);

    expect((await request(app).get("/covers/whatever.jpg")).status).toBe(404);
    // 用音频文件的真实名字去请求 /covers：扩展名不在图片白名单里，必须 404
    expect((await request(app).get(`/covers/${song.storedName}`)).status).toBe(404);
  });
});

/** AC-03：音频流是访客级；上传/删除/统计是管理级 */
describe("云端曲库的权限分级（AC-03）", () => {
  const LOCKED = { userPassword: "guest-pass", adminPassword: "root-pass", authEnabled: true };

  async function login(app: ReturnType<typeof createApp>, password: string): Promise<string> {
    const res = await request(app).post("/api/auth/login").send({ password });
    const raw = res.headers["set-cookie"] as unknown as string[] | string | undefined;
    const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
    return (list[0] ?? "").split(";")[0] ?? "";
  }

  it("未登录：列表 401、音频流 401（云端内容不给未登录看）", async () => {
    const { app } = await setup(LOCKED);
    const song = { storedName: "whatever.wav" };

    expect((await request(app).get("/api/songs")).status).toBe(401);
    expect((await request(app).get(`/audio/${song.storedName}`)).status).toBe(401);
  });

  it("访客：能看列表与听音频，但不能上传/删除/看统计（403）", async () => {
    const { app } = await setup(LOCKED);
    const cookie = await login(app, "guest-pass");

    expect((await request(app).get("/api/songs").set("Cookie", cookie)).status).toBe(200);
    expect(
      (await request(app).post("/api/songs/upload").set("Cookie", cookie).attach("file", wavBuffer(1), "a.wav"))
        .status,
    ).toBe(403);
    expect((await request(app).get("/api/stats").set("Cookie", cookie)).status).toBe(403);
  });

  it("管理员：上传与统计都能用", async () => {
    const { app } = await setup(LOCKED);
    const cookie = await login(app, "root-pass");

    const res = await request(app)
      .post("/api/songs/upload")
      .set("Cookie", cookie)
      .attach("file", wavBuffer(1), "a.wav");

    expect(res.status).toBe(201);
    expect((await request(app).get("/api/stats").set("Cookie", cookie)).body.data.songCount).toBe(1);
  });
});

/** supertest 默认把响应当文本处理，音频是二进制：手工收成 Buffer。
    superagent 的 Parser 类型把第一个参数标成它自己的 Response，运行时给的其实是
    IncomingMessage，只能断言一下类型（库里已知的类型不对）。 */
const binaryParser = ((res: IncomingMessage, callback: (error: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(chunk));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
}) as unknown as Parameters<request.Test["parse"]>[0];
