<script setup lang="ts" generic="T extends string">
import {
  SelectContent,
  SelectIcon,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from "reka-ui";
import IconCaretDown from "~icons/ph/caret-down";
import IconCheck from "~icons/ph/check";

/**
 * 下拉选择（**应用内唯一实现**：Reka Select 行为层 + 自绘玻璃面板，v6.25）。
 *
 * 为什么不用原生 `<select>`：它的**弹层是操作系统/引擎自己画的**，CSS 只能改收起时那个框，
 * 一展开就是另一套语言（白底、系统字体、系统行高、系统勾选）——实测曲库管理的排序下拉
 * 就是这样一坨白色面板，与设置页均衡器的预设下拉完全两样（需求方：“样式没有对齐”）。
 * 原生 `select` 还改不了面板的圆角、阴影、滚动条与悬浮态，等于把这个控件交给了系统。
 *
 * 行为（键盘、类型搜索、`aria-*`、滚动到选中项）都在 Reka 里；这里只管触发器与面板的外衣，
 * 并把“宿主差异”留给宿主：默认外观是卡片内控件那一档（34px / `--glass-bg` / 13px，面板下限 132px），
 * 工具栏里的用法用 `:deep(.as-trigger)` 覆盖成那一档的密度（见 `ConsoleSongsView`）。
 * 面板宽度跟内容走、下限与默认触发器同宽；宿主若把触发器加宽，要一并覆盖 `.as-menu` 的下限。
 *
 * ⚠️ **别给这个组件传 `class`**：`SelectRoot` 自己不渲染元素，组件根是个 fragment，
 * 透传的 class / 属性会被 Vue 直接丢掉（不报错）。要挂宿主样式就外面包一层元素（AGENTS 坑 33）。
 *
 * ⚠️ 面板样式必须写在**非 scoped** 的 `<style>` 里：Reka 把内容 Teleport 到 body，
 * scoped 的 `[data-v-x]` 不会跟过去（AGENTS 坑 6）。
 */
const props = defineProps<{
  modelValue: T;
  /** 选项：`value` 给逻辑（可与业务联合类型对齐），`label` 给显示 */
  options: readonly { value: T; label: string }[];
  /** 无障碍名：这个下拉是干什么用的（触发器里只有文字，没有上下文） */
  label: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{ "update:modelValue": [value: T] }>();

function onValueChange(value: unknown): void {
  emit("update:modelValue", value as T);
}
</script>

<template>
  <SelectRoot
    :model-value="props.modelValue"
    :disabled="props.disabled"
    @update:model-value="onValueChange"
  >
    <SelectTrigger class="as-trigger" :aria-label="props.label">
      <SelectValue />
      <SelectIcon class="as-caret">
        <IconCaretDown class="icon" />
      </SelectIcon>
    </SelectTrigger>
    <SelectPortal>
      <SelectContent class="as-menu" position="popper" :side-offset="6" align="start">
        <SelectViewport class="as-menu__view">
          <SelectItem
            v-for="option in props.options"
            :key="option.value"
            :value="option.value"
            class="as-menu__item"
          >
            <SelectItemText>{{ option.label }}</SelectItemText>
            <SelectItemIndicator class="as-menu__check">
              <IconCheck class="icon" />
            </SelectItemIndicator>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>

<style scoped>
/* 触发器：卡片内控件那一档（与 `.fx__name` 这类输入框同一套尺寸与材质）。
   宿主要换档就覆盖这几条 —— 但**别改结构**（仍然是 flex + space-between + 箭头在右）。 */
.as-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 132px;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-control);
  background: var(--glass-bg);
  color: var(--text-1);
  font-size: 13px;
  cursor: pointer;
}

.as-trigger:hover {
  border-color: color-mix(in srgb, var(--accent) 35%, var(--glass-border));
}

/* 键盘聚焦才给环（鼠标点开不给，与全站其余控件一致） */
.as-trigger:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 70%, transparent);
  outline-offset: 2px;
}

.as-caret {
  display: inline-flex;
  flex: none;
}

.as-caret .icon {
  width: 14px;
  height: 14px;
  color: var(--text-3);
}

.as-trigger[data-state="open"] .as-caret .icon {
  color: var(--text-2);
}
</style>

<style>
/* ⚠️ 非 scoped：面板被 Teleport 到 body（理由见组件注释）。隔离靠 `as-` 前缀。 */
.as-menu {
  z-index: 92;
  min-width: 132px;
  max-height: 260px;
  overflow: hidden auto;
  padding: 6px;
  border-radius: var(--radius-control);
  border: 1px solid var(--glass-border);
  background: var(--tray-bg);
  backdrop-filter: var(--tray-blur);
  -webkit-backdrop-filter: var(--tray-blur);
  box-shadow: var(--panel-sheen), var(--panel-shadow);
}

.as-menu__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 10px;
  border-radius: var(--radius-control);
  font-size: 13px;
  color: var(--text-1);
  cursor: pointer;
  outline: none;
  user-select: none;
}

.as-menu__item[data-highlighted] {
  background: var(--hover);
}

.as-menu__check .icon {
  width: 14px;
  height: 14px;
  color: var(--accent);
}
</style>
