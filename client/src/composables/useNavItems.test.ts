import { describe, expect, it } from "vitest";
import { pickNavItems } from "./useNavItems";

describe("pickNavItems", () => {
  it("未登录（无服务端权限）只给本地播放", () => {
    const names = pickNavItems({ canUseServer: false, onlineEnabled: true }).map((i) => i.name);
    expect(names).toEqual(["local"]);
  });

  it("登录但未配置音源：本地播放 + 音乐库", () => {
    const names = pickNavItems({ canUseServer: true, onlineEnabled: false }).map((i) => i.name);
    expect(names).toEqual(["local", "library"]);
  });

  it("登录且配置了音源：多出在线搜索", () => {
    const names = pickNavItems({ canUseServer: true, onlineEnabled: true }).map((i) => i.name);
    expect(names).toEqual(["local", "library", "online"]);
  });

  it("每项都有路由名、标签与图标（缺哪个都会渲染成空白）", () => {
    for (const item of pickNavItems({ canUseServer: true, onlineEnabled: true })) {
      expect(item.name).toBeTruthy();
      expect(item.label).toBeTruthy();
      expect(item.icon).toBeTruthy();
    }
  });

  it("每次返回新数组：调用方改它不会污染下一次结果", () => {
    const a = pickNavItems({ canUseServer: true, onlineEnabled: true });
    a.length = 0;
    const b = pickNavItems({ canUseServer: true, onlineEnabled: true });
    expect(b.map((i) => i.name)).toEqual(["local", "library", "online"]);
  });

  it("图标是同一份模块级组件（不会每次新建组件导致反复重挂）", () => {
    const a = pickNavItems({ canUseServer: true, onlineEnabled: false });
    const b = pickNavItems({ canUseServer: true, onlineEnabled: false });
    expect(a[0].icon).toBe(b[0].icon);
  });
});
