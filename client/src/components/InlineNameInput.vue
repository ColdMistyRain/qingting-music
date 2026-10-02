<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
import { PLAYLIST_NAME_MAX_LENGTH } from "@qingting/shared";
import IconCheck from "~icons/ph/check";
import IconX from "~icons/ph/x";
import AppTooltip from "@/components/AppTooltip.vue";

/**
 * 行内命名输入（PS-01）：侧栏「新建歌单」与详情页「重命名」共用一份。
 *
 * 为什么不是 `window.prompt`：全站的确认与输入都在应用内（v5.53 起，
 * 原生弹框在这套玻璃界面上格格不入）；而为了一个名字造一个完整对话框又过重 ——
 * 原地长出一个输入框最合适。回车提交、Esc 取消，旁边两枚小键是给触屏用的（手机没有回车键）。
 */
const props = withDefaults(defineProps<{ modelValue?: string; placeholder?: string }>(), {
  modelValue: "",
  placeholder: "",
});
const emit = defineEmits<{ submit: [name: string]; cancel: [] }>();

const text = ref(props.modelValue);
const inputRef = ref<HTMLInputElement | null>(null);

watch(
  () => props.modelValue,
  (value) => {
    text.value = value;
  },
  { immediate: true },
);

onMounted(async () => {
  await nextTick();
  inputRef.value?.focus();
  inputRef.value?.select();
});

/** 空名不提交也不关闭：让用户接着改，而不是“点了一下什么都没发生” */
function submit(): void {
  const name = text.value.trim();
  if (!name) return;
  emit("submit", name);
}
</script>

<template>
  <div class="inline-name">
    <input
      ref="inputRef"
      v-model="text"
      class="inline-name__input"
      type="text"
      :placeholder="props.placeholder"
      :maxlength="PLAYLIST_NAME_MAX_LENGTH"
      @keydown.enter.prevent="submit"
      @keydown.esc.prevent="emit('cancel')"
    />
    <!-- 两枚键都只有图标 —— 按约定走 AppTooltip（label 同时是 aria-label，
         图标键没有可见文字，名字不能丢），不再只给原生 title（v6.10） -->
    <AppTooltip label="确定">
      <button class="inline-name__btn" type="button" :disabled="!text.trim()" @click="submit">
        <IconCheck class="icon" />
      </button>
    </AppTooltip>
    <AppTooltip label="取消">
      <button class="inline-name__btn" type="button" @click="emit('cancel')">
        <IconX class="icon" />
      </button>
    </AppTooltip>
  </div>
</template>

<style scoped>
.inline-name {
  display: flex;
  align-items: center;
  gap: 4px;
}

.inline-name__input {
  flex: 1;
  min-width: 0;
  height: 30px;
  padding: 0 9px;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-control);
  background: var(--glass-bg-strong);
  color: var(--text-1);
  font-size: 13px;
}

.inline-name__input::placeholder {
  color: var(--text-3);
}

.inline-name__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-control);
  color: var(--text-2);
}

.inline-name__btn:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text-1);
}

.inline-name__btn:disabled {
  opacity: 0.4;
}
</style>
