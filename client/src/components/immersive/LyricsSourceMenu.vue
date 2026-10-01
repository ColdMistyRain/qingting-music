<script setup lang="ts">
import { computed, ref } from "vue";
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from "reka-ui";
import IconArrowCounterClockwise from "~icons/ph/arrow-counter-clockwise";
import IconFileText from "~icons/ph/file-text";
import { usePlayerStore } from "@/stores/player";
import { decodeLyricsBytes } from "@/utils/lyricsLibrary";

/**
 * 歌词来源菜单（LR-02 第三条来源的入口，v4.87）。
 *
 * 只管一件事：把用户手上的 `.lrc` / `.yrc` 交给 store（存哪儿、优先级多高都在 store 与
 * `utils/lyricsLibrary` 里定）。为什么值得给个入口：音频内嵌的歌词多半只有行级，
 * 而用户手里那份可能是逐字版——没有入口，LR-05 的逐字效果对他们就等于不存在。
 *
 * 行为层仍然交给 Reka 的 Popover（打开/关闭、Esc、点外部、焦点归还，铁律 1）；
 * 触发按钮由调用方通过 #trigger 插槽传入（它属于页面顶栏那套控件，样式留在页面里）。
 */
const player = usePlayerStore();
const open = ref(false);
/** 导入失败（文件里没有时间标签 / 读不出来）时的就地提示，比弹一条全局提示更贴近操作 */
const failed = ref(false);
const fileRef = ref<HTMLInputElement | null>(null);

/** 现在用的是哪一份：菜单里写清楚，省得用户猜 */
const status = computed(() => {
  if (player.hasImportedLyrics) return "正在使用手动导入的歌词";
  if (!player.lyricsSource.trim()) return "这首歌暂时没有歌词";
  return "正在使用曲目自带的歌词";
});

function pickFile(): void {
  failed.value = false;
  fileRef.value?.click();
}

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  // 清掉 value：同一个文件改完再选一次也要能触发 change
  input.value = "";
  if (!file) return;

  try {
    const text = decodeLyricsBytes(await file.arrayBuffer());
    if (player.importLyrics(text)) {
      failed.value = false;
      open.value = false; // 成功就收起来，让用户直接看到歌词
    } else {
      failed.value = true;
    }
  } catch {
    failed.value = true;
  }
}

function clearImported(): void {
  player.clearImportedLyrics();
  failed.value = false;
  open.value = false;
}
</script>

<template>
  <PopoverRoot v-model:open="open" @update:open="failed = false">
    <PopoverTrigger as-child>
      <slot name="trigger" />
    </PopoverTrigger>

    <PopoverPortal>
      <PopoverContent class="lsm" side="bottom" align="end" :side-offset="10">
        <b class="lsm-title">歌词来源</b>
        <p class="lsm-status">{{ status }}</p>
        <p v-if="failed" class="lsm-error">
          这份文件里没找到歌词——需要带时间标签的行（LRC 的 <code>[mm:ss.xx]</code> 或 yrc）。
        </p>

        <button class="lsm-item" @click="pickFile">
          <IconFileText class="icon" />
          从文件导入歌词
        </button>
        <button v-if="player.hasImportedLyrics" class="lsm-item" @click="clearImported">
          <IconArrowCounterClockwise class="icon" />
          恢复曲目自带的歌词
        </button>

        <p class="lsm-hint">
          支持 LRC（逐行）、增强型 LRC（行内 <code>&lt;mm:ss.xx&gt;</code> 逐字）与 yrc（逐字）
        </p>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>

  <!-- 藏在组件里的文件选择器：由菜单项触发，导入完就清空 value -->
  <input
    ref="fileRef"
    class="lsm-file"
    type="file"
    accept=".lrc,.yrc,.txt,text/plain"
    @change="onFileChange"
  />
</template>

<style>
/* ⚠️ 弹层内容被 Reka Teleport 到 body，拿不到 scoped 属性，所以这里必须写非 scoped 样式（坑 6），
   隔离靠 `.lsm` 前缀。 */
.lsm {
  z-index: 80;
  width: 264px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-radius: 14px;
  border: 1px solid var(--line);
  background: var(--chrome-bg);
  backdrop-filter: blur(18px);
  box-shadow: var(--shadow-2);
  color: var(--text-1);
  font-size: 13px;
}

.lsm-title {
  font-size: 12px;
  letter-spacing: 0.12em;
  color: var(--text-3);
}

.lsm-status {
  margin: 0;
  color: var(--text-2);
}

.lsm-error {
  margin: 0;
  padding: 8px 10px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--danger, #d9534f) 14%, transparent);
  color: var(--text-1);
  line-height: 1.5;
}

.lsm-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--text-1);
  font: inherit;
  text-align: left;
  cursor: pointer;
  /* 悬浮反馈用“光”，不做位移（开发约定） */
  transition: background 0.15s ease;
}

.lsm-item:hover {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
}

.lsm-item .icon {
  font-size: 16px;
  color: var(--text-2);
}

.lsm-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-3);
}

.lsm code {
  font-size: 11px;
  padding: 0 3px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--text-1) 8%, transparent);
}

.lsm-file {
  display: none;
}
</style>
