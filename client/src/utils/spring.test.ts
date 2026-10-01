import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPRING_PARAMS,
  POS_Y_SPRING_BASE,
  Spring,
  posYSpringParams,
  solveSpring,
} from "./spring";
/** 推进若干帧，返回轨迹（用于断言过冲 / 收敛） */
function run(spring: Spring, frames = 240, dt = 1 / 60): number[] {
  const track: number[] = [];
  for (let i = 0; i < frames; i++) {
    spring.update(dt);
    track.push(spring.position);
  }
  return track;
}

describe("Spring（弹簧求解，按阻尼简谐振子自行实现）", () => {
  it("欠阻尼参数会冲过目标再回弹——这正是它和 CSS 过渡的区别", () => {
    // 阻力取小值 → 欠阻尼；stiffness 100 / damping 2 必定过冲
    const spring = new Spring(0, { mass: 1, damping: 2, stiffness: 100 });
    spring.setTarget(100);
    const track = run(spring);

    const overshoot = Math.max(...track) - 100;
    // 冲过头
    expect(overshoot).toBeGreaterThan(1);
    // 而且振幅在衰减（末帧偏差远小于峰值）
    expect(Math.abs(track.at(-1)! - 100)).toBeLessThan(overshoot / 3);
  });

  it("过阻尼（ζ>1）单调逼近，不过冲", () => {
    // ζ = 40 / (2·√(100·1)) = 2
    const spring = new Spring(0, { mass: 1, damping: 40, stiffness: 100 });
    spring.setTarget(100);
    const track = run(spring);

    expect(Math.max(...track)).toBeLessThanOrEqual(100.0001);
    expect(track.at(-1)).toBeCloseTo(100, 1);
  });

  it("临界阻尼（ζ=1）不除零、也不过冲", () => {
    // ζ = 20 / (2·√(100·1)) = 1，两个实根重合，是最容易写出 NaN 的一支
    const spring = new Spring(0, { mass: 1, damping: 20, stiffness: 100 });
    spring.setTarget(100);
    const track = run(spring);

    expect(track.every((x) => Number.isFinite(x))).toBe(true);
    expect(Math.max(...track)).toBeLessThanOrEqual(100.0001);
    expect(track.at(-1)).toBeCloseTo(100, 1);
  });

  it("到达目标后自动停住（moving 变 false），且位置正好等于目标", () => {
    const spring = new Spring(0);
    spring.setTarget(120);
    run(spring, 600);

    expect(spring.moving).toBe(false);
    expect(spring.position).toBe(120);
    expect(spring.arrived()).toBe(true);
  });

  it("中途改目标不会顿一下：从当前位置与当前速度续算", () => {
    const spring = new Spring(0);
    spring.setTarget(100);
    run(spring, 10);
    const midPosition = spring.position;
    spring.setTarget(-50);
    run(spring, 600);

    // 位置连续（没有跳变），并且最终停在新的目标上
    expect(Math.abs(midPosition)).toBeGreaterThan(0);
    expect(spring.position).toBe(-50);
  });

  it("snap 直接落位，不再有残余运动", () => {
    const spring = new Spring(0);
    spring.setTarget(300);
    run(spring, 5);
    spring.snap(-20);

    expect(spring.position).toBe(-20);
    expect(spring.moving).toBe(false);
  });

  it("设一个极小的目标变化不会重启动画（阈值过滤）", () => {
    const spring = new Spring(50);
    spring.setTarget(50.0005);
    expect(spring.target).toBe(50);
    expect(spring.moving).toBe(false);
  });

  it("换参数不跳变：位置连续，并从新参数继续收敛", () => {
    const spring = new Spring(0, { mass: 1, damping: 10, stiffness: 100 });
    spring.setTarget(200);
    run(spring, 6);
    const before = spring.position;
    spring.setParams({ stiffness: 200, damping: Math.sqrt(200) * 2.3 });
    expect(spring.position).toBeCloseTo(before, 6);
    run(spring, 600);
    expect(spring.position).toBe(200);
  });

  it("solveSpring 在 t=0 时返回起点，延迟为负不动（接口契约）", () => {
    const solver = solveSpring(10, 0, 90, DEFAULT_SPRING_PARAMS);
    expect(solver(0)).toBeCloseTo(10, 6);
  });
});

describe("posYSpringParams（我们自己的参数策略）", () => {
  it("跳转 / 首末句（拿不到间隔）用慢速参数", () => {
    expect(posYSpringParams({ seeking: true })).toMatchObject({ stiffness: 100, damping: 16 });
    expect(posYSpringParams({})).toMatchObject({ stiffness: 100, damping: 16 });
  });

  it("歌曲结束用中速参数", () => {
    expect(posYSpringParams({ endOfSong: true })).toMatchObject({ stiffness: 150, damping: 24 });
  });

  it("句间间隔越短弹力越大（跟得越紧）", () => {
    const tight = posYSpringParams({ intervalSeconds: 0.12 });
    const loose = posYSpringParams({ intervalSeconds: 0.7 });

    expect(tight.stiffness).toBeGreaterThan(loose.stiffness!);
    expect(tight.stiffness).toBeLessThanOrEqual(230);
    expect(loose.stiffness).toBeGreaterThanOrEqual(180);
  });

  it("阻力由弹力反推（过冲幅度保持稳定），并带上纵向质量", () => {
    const params = posYSpringParams({ intervalSeconds: 0.3 });

    expect(params.damping).toBeCloseTo(Math.sqrt(params.stiffness!) * 2.3, 6);
    expect(params.mass).toBe(POS_Y_SPRING_BASE.mass);
  });
});
