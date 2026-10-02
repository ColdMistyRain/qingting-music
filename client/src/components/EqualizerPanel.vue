<script setup lang="ts">
import { computed, ref } from "vue";
import { storeToRefs } from "pinia";
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
import IconX from "~icons/ph/x";
import VerticalSlider from "@/components/VerticalSlider.vue";
import { useEqualizerStore } from "@/stores/equalizer";
import {
  EQ_BANDS,
  EQ_GAIN_MAX,
  EQ_GAIN_MIN,
  EQ_GAIN_STEP,
  EQ_MASTER_MAX,
  EQ_MASTER_MIN,
  bandLabel,
  formatGain,
} from "@/utils/equalizer";

/**
 * 均衡器与音效面板（PL-13，设置 › 音效）。
 *
 * 十根竖杆是**自绘**的 `VerticalSlider`（与音量条共用）：原生 range 加 rotate(-90deg)
 * 拖动不跟手（AGENTS 坑 7），原型那版正是这么写的，这里不重复那个坑。
 * 预设用 Reka 的 Select（选型表里指定 EQ 预设用它），行为层交给它、皮肤还是我们的。
 *
 * 界面只在有意义的时机说数字：每段上面是当前增益、下面是频率；拖动时上面那个数就变了。
 */
const eq = useEqualizerStore();
// setup store 直接解构会丢响应性（settings 是 ref，从外面看已经被展开了）
const { settings } = storeToRefs(eq);

const nameInput = ref("");
const saveError = ref("");
/** 手柄默认不显示，指针在轨道上 / 键盘聚焦 / 拖动中才出现（配方在 global.css） */
const presetValue = computed({
  get: () => settings.value.preset,
  set: (name: string) => eq.applyPreset(name),
});

function saveCustom(): void {
  const name = nameInput.value;
  if (!name.trim()) {
    saveError.value = "先给这条曲线起个名字";
    return;
  }
  if (!eq.saveCustom(name)) {
    saveError.value = "这个名字用不了（与内置预设重名，或者叫“自定义”）";
    return;
  }
  saveError.value = "";
  nameInput.value = "";
}

function removeCustom(name: string): void {
  eq.removeCustom(name);
}
</script>

<template>
  <div class="set-card card fx">
    <div class="fx__head">
      <div>
        <b>均衡器与音效</b>
        <div class="set-note">
          10 段图形均衡器（31Hz~16kHz）与整体增益；开关就是 A/B 对比，关闭时音频直通。
          设置存在这台设备上。
        </div>
      </div>
      <button
        class="fx__pill"
        :class="{ 'is-on': eq.enabled }"
        :aria-pressed="eq.enabled"
        @click="eq.toggle()"
      >
        {{ eq.enabled ? "已开启" : "已关闭" }}
      </button>
    </div>

    <div class="fx__row">
      <span class="fx__label">预设</span>
      <SelectRoot v-model="presetValue">
        <SelectTrigger class="fx__select" aria-label="均衡器预设">
          <SelectValue />
          <SelectIcon class="fx__select-icon">
            <IconCaretDown class="icon" />
          </SelectIcon>
        </SelectTrigger>
        <SelectPortal>
          <SelectContent class="fx-menu" position="popper" :side-offset="6" align="start">
            <SelectViewport class="fx-menu__view">
              <SelectItem
                v-for="name in eq.presetNames"
                :key="name"
                :value="name"
                class="fx-menu__item"
              >
                <SelectItemText>{{ name }}</SelectItemText>
                <SelectItemIndicator class="fx-menu__check">
                  <IconCheck class="icon" />
                </SelectItemIndicator>
              </SelectItem>
            </SelectViewport>
          </SelectContent>
        </SelectPortal>
      </SelectRoot>
      <span v-if="eq.customNames.length > 0" class="fx__custom">
        <button
          v-for="name in eq.customNames"
          :key="name"
          class="fx__chip"
          :title="`删除自定义预设「${name}」`"
          @click="removeCustom(name)"
        >
          {{ name }}
          <IconX class="icon" />
        </button>
      </span>
    </div>

    <div class="fx__bands">
      <div v-for="(freq, index) in EQ_BANDS" :key="freq" class="fx__band">
        <span class="fx__band-value">{{ formatGain(settings.gains[index]) }}</span>
        <VerticalSlider
          class="fx__band-track"
          :model-value="settings.gains[index]"
          :min="EQ_GAIN_MIN"
          :max="EQ_GAIN_MAX"
          :step="EQ_GAIN_STEP"
          centered
          :label="`${bandLabel(freq)} 赫兹`"
          :value-text="`${formatGain(settings.gains[index])} 分贝`"
          @update:model-value="(value: number) => eq.setBand(index, value)"
        />
        <span class="fx__band-freq">{{ bandLabel(freq) }}</span>
      </div>
    </div>

    <div class="fx__row fx__row--gain">
      <span class="fx__label">增益</span>
      <input
        class="fx__gain"
        type="range"
        :min="EQ_MASTER_MIN"
        :max="EQ_MASTER_MAX"
        step="1"
        :value="settings.master"
        aria-label="整体增益"
        @input="eq.setMaster(Number(($event.target as HTMLInputElement).value))"
      />
      <span class="fx__gain-value">{{ formatGain(settings.master) }}dB</span>
    </div>

    <div class="fx__row fx__row--save">
      <input
        v-model="nameInput"
        class="fx__name"
        type="text"
        maxlength="20"
        placeholder="保存当前曲线为自定义预设"
        @keydown.enter="saveCustom"
      />
      <button class="btn" @click="saveCustom">保存</button>
    </div>
    <p v-if="saveError" class="fx__error" role="alert">{{ saveError }}</p>

    <div class="set-note">
      增益拉得太高时限幅器会自动压住峰值，防止爆音；均衡器关掉的整条链路都不参与。
    </div>
  </div>
</template>

<style scoped>
.fx {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.fx__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

/* A/B 开关：整枚是一个按钮（不是 checkbox）—— 它表达的是“现在生效吗”，
   所以用状态色说：开启时主题色底 + 白字，关闭时是普通面（与原型同一个形态） */
.fx__pill {
  flex: none;
  padding: 8px 18px;
  border-radius: 999px;
  font-size: 12.5px;
  background: var(--fill-track);
  color: var(--text-2);
  transition:
    background 0.2s,
    color 0.2s;
}

.fx__pill.is-on {
  background: var(--accent);
  color: var(--on-accent);
}

.fx__row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.fx__label {
  flex: none;
  min-width: 34px;
  font-size: 12.5px;
  color: var(--text-2);
}

.fx__select {
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
}

.fx__select-icon .icon {
  width: 14px;
  height: 14px;
  color: var(--text-3);
}

.fx__custom {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* 自定义预设：点它就是删除（标题里写清楚了）—— 存一份曲线很便宜，删错了再存一次就行 */
.fx__chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 999px;
  background: var(--fill-track);
  color: var(--text-2);
  font-size: 12px;
}

.fx__chip:hover {
  color: var(--danger);
}

.fx__chip .icon {
  width: 12px;
  height: 12px;
}

.fx__bands {
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  gap: 6px;
  padding: 6px 2px 2px;
}

.fx__band {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.fx__band-value {
  font-size: 11px;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}

.fx__band-track {
  --vsl-height: 148px;
  --vsl-width: 24px;
}

.fx__band-freq {
  font-size: 10.5px;
  color: var(--text-3);
  white-space: nowrap;
}

.fx__row--gain .fx__gain {
  flex: 1;
  accent-color: var(--accent);
  cursor: pointer;
}

.fx__gain-value {
  flex: none;
  min-width: 44px;
  text-align: right;
  font-size: 12px;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}

.fx__row--save .fx__name {
  flex: 1;
  height: 34px;
  padding: 0 11px;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-control);
  background: var(--glass-bg);
  color: var(--text-1);
  font-size: 13px;
}

.fx__error {
  font-size: 12px;
  color: var(--danger);
}

@media (max-width: 640px) {
  .fx__bands {
    gap: 2px;
  }

  .fx__band-track {
    --vsl-height: 118px;
    --vsl-width: 20px;
  }

  .fx__band-value,
  .fx__band-freq {
    font-size: 10px;
  }
}
</style>

<style>
/* ⚠️ 非 scoped：Reka 把 Select 的内容 Teleport 到 body，scoped 属性不会跟过去（AGENTS 坑 6）。
   隔离靠 fx-menu 前缀。 */
.fx-menu {
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

.fx-menu__item {
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

.fx-menu__item[data-highlighted] {
  background: var(--hover);
}

.fx-menu__check .icon {
  width: 14px;
  height: 14px;
  color: var(--accent);
}
</style>
