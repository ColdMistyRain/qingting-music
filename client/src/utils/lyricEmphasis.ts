/**
 * 逐字"瞬时辉光爆发"（LR-05 的强调效果）。
 *
 * 效果参考 AMLL 的强调动画（逐字依次辉光 + 轻微上浮，峰值在动画中段），但**代码是
 * 按自己的参数模型重写的**（不转录它的实现），因此不涉及它的 AGPL：本项目只参考效果，
 * 颜色也用我们自己的 `--accent-soft` 而不是白。
 *
 * 纯函数：只算参数与关键帧，不碰 DOM，便于单测（PRD 11.2）。
 * 用法：某个字刚唱完时，把它传给 `element.animate()` 跑一次即可。
 */

/** 动画时长下限（毫秒）：太短会看不见，太长会拖到下一句 */
const MIN_DURATION_MS = 700;
/** 动画时长上限（毫秒） */
const MAX_DURATION_MS = 1800;
/** 辉光半径上限（em） */
const MAX_GLOW_EM = 0.3;
/** 生成的关键帧数量（越多越平滑，32 帧足够 60fps 下看不出折线） */
const FRAME_COUNT = 32;

export interface EmphasisParams {
  /** 动画时长（毫秒） */
  durationMs: number;
  /** 每个字相对前一个字的错峰（毫秒） */
  staggerMs: number;
  /** 幅度（1 为基准） */
  amount: number;
  /** 辉光强度（em 系数） */
  glow: number;
}

/**
 * 由字的时长算出强调参数。
 * - 时长越长，动画越长越明显（长音本来就该更有存在感）；
 * - `isLastWord`（整行最后一个字）加强一档——收尾那一下最容易被看见；
 * - 上限夹住：再长也不能把动画拖到下一句，再强也不能糊成一团。
 */
export function emphasisParams(options: {
  /** 这个字唱了多久（秒） */
  durationSeconds: number;
  /** 这一句里有多少个字（用于错峰） */
  charCount: number;
  /** 是否整行的最后一个字 */
  isLastWord?: boolean;
}): EmphasisParams {
  const rawMs = Math.max(0, options.durationSeconds) * 1000;
  const charCount = Math.max(1, options.charCount);
  const boost = options.isLastWord ? 1.5 : 1;
  const durationMs = Math.min(Math.max(rawMs * boost, MIN_DURATION_MS), MAX_DURATION_MS);

  return {
    durationMs,
    // 错峰：整段动画的前 1/3 摊给这一句的所有字，读起来是"依次亮起"而不是齐闪
    staggerMs: durationMs / 3 / charCount,
    amount: Math.min(1.2, (0.6 + rawMs / 2500) * (options.isLastWord ? 1.4 : 1)),
    glow: Math.min(MAX_GLOW_EM, (0.12 + rawMs / 6000) * boost),
  };
}

/**
 * 辉光的强度曲线（0~1）：**两端为 0、中段为 1** 的对称爆发。
 * 用 `sin²(πx)` 而不是线性三角：中段更饱满、首尾收得更自然。
 */
export function emphasisProfile(x: number): number {
  if (!(x > 0) || x >= 1) return 0;
  const s = Math.sin(Math.PI * x);
  return s * s;
}

/**
 * 生成一个字的关键帧：辉光从 0 冲到峰值再收回 0，同时轻微放大 + 上浮 + 与邻字互相推挤，
 * 最后回到原位（`fill` 用 `none`，跑完不会留下残留样式）。
 *
 * @param charIndex 该字在句中的序号
 * @param charCount 该句的字数
 */
export function emphasisKeyframes(options: {
  charIndex: number;
  charCount: number;
  params: EmphasisParams;
}): Keyframe[] {
  const { charIndex, charCount, params } = options;
  // 居中的字位移最小，两侧的字往中间挤一点（整体的"呼吸"感来自这里）
  const push = (charCount / 2 - charIndex) / Math.max(1, charCount);

  return Array.from({ length: FRAME_COUNT }, (_, i) => {
    const x = (i + 1) / FRAME_COUNT;
    const p = emphasisProfile(x);
    const lift = -p * 0.05 * params.amount;
    const scale = 1 + p * 0.08 * params.amount;

    return {
      offset: x,
      transform: `translate(${(-push * p * 0.03 * params.amount).toFixed(4)}em, ${lift.toFixed(4)}em) scale(${scale.toFixed(4)})`,
      textShadow: `0 0 ${(p * params.glow).toFixed(4)}em var(--accent-soft), 0 0 ${(p * params.glow * 0.4).toFixed(4)}em var(--accent-soft)`,
    };
  });
}

/** 这套关键帧只动 transform 与 text-shadow（都能走合成层），不会触发重排 */
export const EMPHASIS_KEYFRAME_PROPERTIES = ["transform", "textShadow"] as const;
