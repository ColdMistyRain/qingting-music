import { afterEach, describe, expect, it } from "vitest";
import { answerConfirm, confirmAction, currentConfirm } from "./confirm";

/** 把队列排空，避免用例之间互相污染（某个用例失败时也不给下一个留脏状态） */
function drain(): void {
  while (currentConfirm.value) answerConfirm(false);
}

describe("confirmAction", () => {
  afterEach(drain);

  it("没人回答之前不 resolve；点确定后 resolve 成 true", async () => {
    let settled: boolean | undefined;
    const answer = confirmAction({ title: "删除《海阔天空》？" }).then((value) => {
      settled = value;
      return value;
    });

    // 先让微任务队列跑空：没有 answerConfirm，它不该落地
    await Promise.resolve();
    expect(settled).toBeUndefined();
    expect(currentConfirm.value?.title).toBe("删除《海阔天空》？");

    answerConfirm(true);
    await expect(answer).resolves.toBe(true);
    expect(currentConfirm.value).toBeNull();
  });

  it("取消（含 Esc / 点遮罩）返回 false", async () => {
    const answer = confirmAction({ title: "清空播放队列？" });
    answerConfirm(false);
    await expect(answer).resolves.toBe(false);
  });

  it("补默认值：确定 / 取消 / danger（破坏性动作默认红）", async () => {
    void confirmAction({ title: "确定吗？" });
    expect(currentConfirm.value).toMatchObject({
      confirmText: "确定",
      cancelText: "取消",
      tone: "danger",
    });
  });

  it("原样保留调用方给的文案与主色（上传这类非破坏性动作用 primary）", async () => {
    void confirmAction({
      title: "上传 13 首到音乐库？",
      description: "文件会逐个传到服务器。",
      confirmText: "上传",
      tone: "primary",
    });
    expect(currentConfirm.value).toMatchObject({
      title: "上传 13 首到音乐库？",
      description: "文件会逐个传到服务器。",
      confirmText: "上传",
      tone: "primary",
    });
  });

  it("连着来两条请求时按顺序一条条弹，第二条不会顶掉第一条", async () => {
    const first = confirmAction({ title: "第一条" });
    const second = confirmAction({ title: "第二条" });

    expect(currentConfirm.value?.title).toBe("第一条");

    answerConfirm(true);
    await expect(first).resolves.toBe(true);
    expect(currentConfirm.value?.title).toBe("第二条");

    answerConfirm(false);
    await expect(second).resolves.toBe(false);
    expect(currentConfirm.value).toBeNull();
  });

  it("每条请求带自己的 id（界面靠它知道换了一条，重新聚焦到取消键）", async () => {
    void confirmAction({ title: "第一条" });
    const firstId = currentConfirm.value?.id;
    answerConfirm(false);

    void confirmAction({ title: "第二条" });
    expect(currentConfirm.value?.id).not.toBe(firstId);
  });

  it("没有待确认时发答案是空操作（不会误伤下一条）", async () => {
    expect(() => answerConfirm(true)).not.toThrow();

    const answer = confirmAction({ title: "还在等" });
    answerConfirm(false);
    await expect(answer).resolves.toBe(false);
  });
});
