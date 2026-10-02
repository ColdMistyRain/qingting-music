<script setup lang="ts">
import { computed, nextTick, watch } from "vue";
import { RadioGroupItem, RadioGroupRoot } from "reka-ui";
import { useActiveIndicator } from "@/composables/useActiveIndicator";

/**
 * 分段控件（设置页的「模式 / 材质」，v5.9）。
 *
 * 分工沿用全站那条：**行为层给 Reka，皮肤我们自己画**。
 * - 行为：`RadioGroup` 自带 `role="radiogroup"` / `role="radio"`、`aria-checked`、
 *   roving tabindex（只有选中项在 Tab 序列里）与 ←→ 方向键切选项。
 * - 皮肤：`.seg` 那套配方搬进这里（原来在 global.css，全站只有设置页在用），
 *   选中态不再靠 `.active` 类，而是 Reka 的 `[data-state="checked"]`。
 * - 动画：选中底板是一条**共享元素**，位置尺寸由 `useActiveIndicator` 量出来写成
 *   CSS 变量，滑动交给 `transform / width` —— 与 Tab 下划线同一套做法。
 */
const props = defineProps<{
  modelValue: string;
  options: readonly { value: string; label: string }[];
}>();

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const { setRoot, rect, ready, sync } = useActiveIndicator('[role="radio"][data-state="checked"]');

// 选中项变了就得重量一次：底板要滑到新位置（尺寸不变时 ResizeObserver 不会响）
watch(
  () => props.modelValue,
  () => void nextTick(sync),
);

const pillStyle = computed(() => ({
  "--pill-x": `${rect.value.x}px`,
  "--pill-y": `${rect.value.y}px`,
  "--pill-w": `${rect.value.w}px`,
  "--pill-h": `${rect.value.h}px`,
}));

function onUpdate(value: unknown): void {
  emit("update:modelValue", String(value));
}
</script>

<template>
  <div :ref="setRoot" class="seg-wrap" :class="{ 'is-ready': ready }">
    <RadioGroupRoot class="seg" :model-value="props.modelValue" @update:model-value="onUpdate">
      <RadioGroupItem
        v-for="opt in props.options"
        :key="opt.value"
        :value="opt.value"
        class="seg__opt"
      >
        {{ opt.label }}
      </RadioGroupItem>
    </RadioGroupRoot>
    <!-- 滑动的选中底板：位置尺寸全来自 JS 写的原始值，装饰物所以 aria-hidden -->
    <span class="seg__pill" aria-hidden="true" :style="pillStyle" />
  </div>
</template>

<style scoped>
/* 容器同时是量坐标用的 offsetParent，必须 position: relative */
.seg-wrap {
  position: relative;
  display: inline-flex;
}

.seg {
  display: inline-flex;
  padding: 3px;
  border-radius: var(--radius-control);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
}

.seg__opt {
  padding: 6px 16px;
  border-radius: 8px;
  font-size: 12.5px;
  color: var(--text-2);
  font-family: inherit;
  /* 文字要压在底板**上面**：底板是 .seg 之后的兄弟节点（后画的在上），
     不给按钮自己的层叠上下文，选中项的文字会被那块颜色盖住（实测：字直接看不见）。 */
  position: relative;
  z-index: 1;
  /* 文字颜色要过渡：底板滑过去的同时，两个标签互换颜色（底板自己管滑） */
  transition: color 0.15s;
}

.seg__opt:hover {
  color: var(--text-1);
}

/* 选中态由 Reka 的 data-state 驱动（不再用 .active 类）：文字用主题色（软底之上，
   v5.99 与选中曲目行的做法一致），底板由 .seg__pill 画 */
.seg__opt[data-state="checked"] {
  color: var(--accent);
}

.seg__pill {
  position: absolute;
  top: var(--pill-y, 0);
  left: 0;
  width: var(--pill-w, 0);
  height: var(--pill-h, 0);
  border-radius: 8px;
  /* 选中的底板同样是**软底**（v5.99，与主按钮 / 选中曲目行 / 播放键一致）：
     实心主题色块只留给状态标记（复选框打勾那种），选项本身就是个可点控件。 */
  background: var(--accent-soft);
  border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  transform: translateX(var(--pill-x, 0));
  /* 未量到之前（is-ready 未加）不显示也不过渡，否则开页时会从 0 滑到第一格 */
  opacity: 0;
  pointer-events: none;
}

.seg-wrap.is-ready .seg__pill {
  opacity: 1;
  transition:
    transform 0.22s var(--ease-ios),
    width 0.22s var(--ease-ios);
}

@media (prefers-reduced-motion: reduce) {
  .seg__pill,
  .seg__opt {
    transition: none;
  }
}
</style>
