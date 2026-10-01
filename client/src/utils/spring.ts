/**
 * 弹簧动画（物理插值）。
 *
 * **按公式自行实现**：这里的求解器就是阻尼简谐振子的解析解——
 *   `m·x'' + c·x' + k·x = k·target` → `u = x - target`，`ω₀ = √(k/m)`，`ζ = c / (2√(mk))`；
 *   ζ ≥ 1 两个实根（过阻尼/临界，单调逼近）、ζ < 1 一对共轭复根（欠阻尼，带衰减的振荡）。
 *   解法是教科书内容；**实现思路参考了 pushkine 的 MIT 实现**（github.com/pushkine，它的文件头标注
 *   `MIT License`），与它、以及 AMLL 的版本不同之处在于：
 *   - 过阻尼不再「用临界公式近似」，而是老老实实解两个实根（ζ 大时更准）；
 *   - 不要它的 `soft` 开关——那个开关的作用，判 ζ 就已经天然分开了；
 *   - 时间单位统一用**秒**（本项目本来就是秒），不要 `Duration` 包装层；
 *   - 不要延迟队列（逐行错峰我们用不上）。
 * **本文件不含 AGPL / GPL 代码**（v4.86；详见 `AGENTS.md` 铁律 9）。
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
}

/** 默认参数：接近临界的略微欠阻尼（ζ≈0.92），干净利落、只留一点回弹 */
export const DEFAULT_SPRING_PARAMS: SpringParams = { mass: 1, damping: 26, stiffness: 200 };

/** 歌词列表纵向滚动的质量：比默认略大一点（“沉”一些，长句位移不会显得跳） */
const LYRIC_MASS = 0.9;
/** 兜底参数 = 正常播放那一档的上沿（拿不到句间间隔时直接用它） */
export const POS_Y_SPRING_BASE: SpringParams = { mass: LYRIC_MASS, damping: 35, stiffness: 230 };

/** 数值求导的步长：解析式已给出，这里只用来取速度与加速度做“停稳”判定 */
const DERIVATIVE_STEP = 0.001;
/** “已到位”的阈值：位置、速度、加速度都要小于它（只看位置会把慢速末端误判成已停） */
const ARRIVED_EPSILON = 0.01;

function derivative(f: (t: number) => number): (t: number) => number {
  return (t) => (f(t + DERIVATIVE_STEP) - f(t - DERIVATIVE_STEP)) / (2 * DERIVATIVE_STEP);
}

/**
 * 求弹簧的解析解：给定起点、初速度、终点与参数，返回“t 秒后位置”的函数。
 * 按阻尼比分两支：ζ ≥ 1 两个实根（单调逼近，不过冲）、ζ < 1 共轭复根（过冲再回弹）。
 */
export function solveSpring(
  from: number,
  velocity: number,
  to: number,
  params: SpringParams = DEFAULT_SPRING_PARAMS,
): (t: number) => number {
  const { mass, damping, stiffness } = params;
  const omega = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  /** 相对目标的初始位移（目标的“偏差”） */
  const offset = from - to;

  if (zeta >= 1) {
    // 过阻尼 / 临界：两个实根（ζ = 1 时重合，回到临界公式）
    if (Math.abs(zeta - 1) < 1e-9) {
      return (t) => to + (offset + (velocity + omega * offset) * t) * Math.E ** (-omega * t);
    }
    const root = omega * Math.sqrt(zeta * zeta - 1);
    const r1 = -zeta * omega + root;
    const r2 = -zeta * omega - root;
    const head = (velocity - r2 * offset) / (r1 - r2);
    const tail = offset - head;
    return (t) => to + head * Math.E ** (r1 * t) + tail * Math.E ** (r2 * t);
  }

  // 欠阻尼：会冲过目标再回弹
  const omegaDamped = omega * Math.sqrt(1 - zeta * zeta);
  const cosine = offset;
  const sine = (velocity + zeta * omega * offset) / omegaDamped;
  return (t) =>
    to +
    Math.E ** (-zeta * omega * t) *
      (cosine * Math.cos(omegaDamped * t) + sine * Math.sin(omegaDamped * t));
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

  /** 位置、速度、加速度都足够小就算到位（只比位置会在慢速末端提前停住） */
  arrived(): boolean {
    return (
      Math.abs(this.targetValue - this.currentValue) < ARRIVED_EPSILON &&
      Math.abs(this.velocityAt(this.elapsed)) < ARRIVED_EPSILON &&
      Math.abs(this.accelerationAt(this.elapsed)) < ARRIVED_EPSILON
    );
  }
}

/* ---------- 参数策略（我们自己的数值） ----------
   思路（物理直觉 + 实测手感，不是拄来的常数）：三种场景分别要不同的“稳”与“快”；
   正常播放时再按句间间隔微调——句子追得紧就弹快一点，间隔长就慢一点，免得抢拍。
   阻力用 `√stiffness × 系数` 反推，这样改弹力时**过冲幅度基本不变**（试过固定阻力：
   弹力一高就甩得过头）。 */
/** 跳转 / 首末句：稳为先，不要甩 */
const SLOW = { stiffness: 100, damping: 16 };
/** 歌曲结束：介乎两者之间 */
const MEDIUM = { stiffness: 150, damping: 24 };
/** 正常播放的弹力区间与间隔区间（毫秒） */
const MIN_INTERVAL_MS = 120;
const MAX_INTERVAL_MS = 700;
const MIN_STIFFNESS = 180;
const MAX_STIFFNESS = 230;
const DAMPING_MULTIPLIER = 2.3;
const INTERVAL_EXPONENT = 0.25;

export interface PosYSpringOptions {
  /** 本次是不是跳转（点击歌词行、拖进度条）：跳转用慢速，免得甩得晕 */
  seeking?: boolean;
  /** 是否已经唱到全曲最后一段（AMLL 在歌曲结束时降到中速） */
  endOfSong?: boolean;
  /** 当前句与上一句的时间差（秒）；首句 / 末句拿不到就留空 */
  intervalSeconds?: number;
}

export function posYSpringParams(options: PosYSpringOptions = {}): SpringParams {
  if (options.seeking) return { mass: LYRIC_MASS, ...SLOW };
  if (options.endOfSong) return { mass: LYRIC_MASS, ...MEDIUM };
  if (options.intervalSeconds == null) return { mass: LYRIC_MASS, ...SLOW };

  const intervalMs = Math.min(
    Math.max(options.intervalSeconds * 1000, MIN_INTERVAL_MS),
    MAX_INTERVAL_MS,
  );
  // 间隔越短 → ratio 越接近 1 → 弹力越大
  const ratio =
    (1 - (intervalMs - MIN_INTERVAL_MS) / (MAX_INTERVAL_MS - MIN_INTERVAL_MS)) ** INTERVAL_EXPONENT;
  const stiffness = MIN_STIFFNESS + ratio * (MAX_STIFFNESS - MIN_STIFFNESS);
  return {
    mass: LYRIC_MASS,
    stiffness,
    damping: Math.sqrt(stiffness) * DAMPING_MULTIPLIER,
  };
}
