/**
 * 弹簧动画（物理插值）。
 *
 * **改编自 AMLL**（`@applemusic-like-lyrics/core` 的 `utils/spring.ts`，AGPL-3.0），
 * 它的求解器又标注为 pushkine 的 MIT 实现（github.com/pushkine）。本项目因此整体以
 * AGPL-3.0-only 分发（见根 `LICENSE` 与 `README`）。与 AMLL 版的差异只在我们这边的减法：
 * - 去掉它的 `Duration` 包装层，统一用**秒**（本项目的时间单位本来就是秒）；
 * - 去掉延迟队列（逐行错峰我们用不上）；
 * - **求解公式、`arrived()` 的判定阈值与自停条件保持一致**——那正是它“弹”而 CSS
 *   过渡只是“滑”的原因，也是我们抄它的唯一目的。
 *
 * 纯计算、不碰 DOM，便于单测（PRD 11.2）。
 */

export interface SpringParams {
  /** 质量 */
  mass: number;
  /** 阻力 */
  damping: number;
  /** 弹力 */
  stiffness: number;
  /** 强制使用过阻尼解（阻力很小的时候有用） */
  soft?: boolean;
}

/** 默认参数（AMLL 的默认值：mass 1 / damping 10 / stiffness 100） */
export const DEFAULT_SPRING_PARAMS: SpringParams = { mass: 1, damping: 10, stiffness: 100 };

/** AMLL 纵向滚动用的基础参数（它同样用了 0.9 的质量，比默认更“沉”一点） */
export const POS_Y_SPRING_BASE: SpringParams = { mass: 0.9, damping: 15, stiffness: 90 };

/** 数值求导的步长（与 AMLL 一致） */
const DERIVATIVE_STEP = 0.001;
/** “已到位”的阈值：位置、速度、加速度都要小于它（与 AMLL 一致） */
const ARRIVED_EPSILON = 0.01;

function derivative(f: (t: number) => number): (t: number) => number {
  return (t) => (f(t + DERIVATIVE_STEP) - f(t - DERIVATIVE_STEP)) / (2 * DERIVATIVE_STEP);
}

/**
 * 求弹簧的解析解：给定起点、初速度、终点与参数，返回“t 秒后位置”的函数。
 * 两支分开算：**过阻尼**指数逼近（不过冲）、**欠阻尼**带指数衰减的振荡（能看见回弹）。
 */
export function solveSpring(
  from: number,
  velocity: number,
  to: number,
  params: SpringParams = DEFAULT_SPRING_PARAMS,
): (t: number) => number {
  const { mass, damping, stiffness, soft = false } = params;
  const delta = to - from;

  if (soft || 1 <= damping / (2 * Math.sqrt(stiffness * mass))) {
    // 过阻尼：单调逼近目标
    const angularFrequency = -Math.sqrt(stiffness / mass);
    const leftover = -angularFrequency * delta - velocity;
    return (t) => to - (delta + t * leftover) * Math.E ** (t * angularFrequency);
  }

  // 欠阻尼：会冲过目标再回弹
  const dampingFrequency = Math.sqrt(4 * mass * stiffness - damping ** 2);
  const leftover = (damping * delta - 2 * mass * velocity) / dampingFrequency;
  const dfm = (0.5 * dampingFrequency) / mass;
  const dm = -(0.5 * damping) / mass;
  return (t) =>
    to - (Math.cos(t * dfm) * delta + Math.sin(t * dfm) * leftover) * Math.E ** (t * dm);
}

export class Spring {
  private targetValue: number;
  private currentValue: number;
  private elapsed = 0;
  private solver: (t: number) => number;
  private velocityAt: (t: number) => number;
  private accelerationAt: (t: number) => number;

  constructor(
    initial = 0,
    private params: SpringParams = DEFAULT_SPRING_PARAMS,
  ) {
    this.targetValue = initial;
    this.currentValue = initial;
    this.solver = () => initial;
    this.velocityAt = () => 0;
    this.accelerationAt = () => 0;
  }

  get position(): number {
    return this.currentValue;
  }

  get target(): number {
    return this.targetValue;
  }

  /** 是否还在动（false = 已停稳，调用方可以停掉 rAF） */
  get moving(): boolean {
    return !this.arrived();
  }

  /** 直接跳到某位置：拖动跟手、换歌、页面不可见时都用它 */
  snap(position: number): void {
    this.targetValue = position;
    this.currentValue = position;
    this.elapsed = 0;
    this.solver = () => position;
    this.velocityAt = () => 0;
    this.accelerationAt = () => 0;
  }

  /** 设定目标：从**当前位置与当前速度**续算，所以中途改目标不会“顿一下” */
  setTarget(target: number): void {
    if (Math.abs(this.targetValue - target) < 0.001) return;
    this.resetSolver(target);
  }

  /** 换弹簧参数（如句间隔变了、开始跳转）：同样从当前位置与速度续算，不跳变。
     对应 AMLL 的 `updateParams`，只少了延迟队列。 */
  setParams(params: Partial<SpringParams>): void {
    this.params = { ...this.params, ...params };
    this.resetSolver(this.targetValue);
  }

  /** 重开求解器：保留位置与速度，换目标或换参数都走它 */
  private resetSolver(target: number): void {
    const velocity = this.velocityAt(this.elapsed);
    this.elapsed = 0;
    this.targetValue = target;
    this.solver = solveSpring(this.currentValue, velocity, target, this.params);
    this.velocityAt = derivative(this.solver);
    this.accelerationAt = derivative(this.velocityAt);
  }

  /** 逐帧推进（`deltaSeconds` 为距上一帧的秒数）；到位置就自动停住 */
  update(deltaSeconds: number): void {
    this.elapsed += deltaSeconds;
    this.currentValue = this.solver(this.elapsed);
    if (this.arrived()) this.snap(this.targetValue);
  }

  /** 位置、速度、加速度都足够小就算到位（与 AMLL 同口径） */
  arrived(): boolean {
    return (
      Math.abs(this.targetValue - this.currentValue) < ARRIVED_EPSILON &&
      Math.abs(this.velocityAt(this.elapsed)) < ARRIVED_EPSILON &&
      Math.abs(this.accelerationAt(this.elapsed)) < ARRIVED_EPSILON
    );
  }
}

/* ---------- 参数策略（移植自 AMLL 的 `getPosYSpringPolicy`） ----------
   它的思路：跳转/间奏/首末句用**慢速**（稳，不甩），歌曲结束用**中速**，
   正常播放则按“当前句与上一句的时间间隔”动态给弹力——间隔越短弹力越大
   （句子追得紧时要更快跟上），并用 `sqrt(stiffness) * 2.2` 反推阻力，
   这样无论弹力怎么变，**过冲幅度都保持稳定**（这是它调好的关键）。 */
const SLOW = { stiffness: 90, damping: 15 };
const MEDIUM = { stiffness: 140, damping: 22 };
const MIN_INTERVAL_MS = 100;
const MAX_INTERVAL_MS = 800;
const MIN_STIFFNESS = 170;
const MAX_STIFFNESS = 220;
const DAMPING_MULTIPLIER = 2.2;
const INTERVAL_EXPONENT = 0.2;

export interface PosYSpringOptions {
  /** 本次是不是跳转（点击歌词行、拖进度条）：跳转用慢速，免得甩得晕 */
  seeking?: boolean;
  /** 是否已经唱到全曲最后一段（AMLL 在歌曲结束时降到中速） */
  endOfSong?: boolean;
  /** 当前句与上一句的时间差（秒）；首句 / 末句拿不到就留空 */
  intervalSeconds?: number;
}

export function posYSpringParams(options: PosYSpringOptions = {}): SpringParams {
  if (options.seeking) return { ...POS_Y_SPRING_BASE, ...SLOW };
  if (options.endOfSong) return { ...POS_Y_SPRING_BASE, ...MEDIUM };
  if (options.intervalSeconds == null) return { ...POS_Y_SPRING_BASE, ...SLOW };

  const intervalMs = Math.min(
    Math.max(options.intervalSeconds * 1000, MIN_INTERVAL_MS),
    MAX_INTERVAL_MS,
  );
  // 间隔越短 → ratio 越接近 1 → 弹力越大
  const ratio =
    (1 - (intervalMs - MIN_INTERVAL_MS) / (MAX_INTERVAL_MS - MIN_INTERVAL_MS)) ** INTERVAL_EXPONENT;
  const stiffness = MIN_STIFFNESS + ratio * (MAX_STIFFNESS - MIN_STIFFNESS);
  return {
    ...POS_Y_SPRING_BASE,
    stiffness,
    damping: Math.sqrt(stiffness) * DAMPING_MULTIPLIER,
  };
}
