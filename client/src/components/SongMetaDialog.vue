<script setup lang="ts">
import { ref, watch } from "vue";
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from "reka-ui";
import { SONG_FIELD_MAX_LENGTH, type Song } from "@qingting/shared";
import { libraryErrorMessage, updateSong } from "@/api/songs";
import { diffSongMeta } from "@/utils/songMeta";

/**
 * 元信息编辑弹窗（AD-02）：曲库管理每行「编辑」与上传完成后「填写信息」**共用这一份**。
 *
 * 为什么需要它：上传的音频里可能压根没有标签（或带错了），标题只能退到文件名、
 * 歌手退到“未知歌手”——这时得让人能改。改的是**曲库索引里的显示信息**，
 * 不去重写音频容器的标签（那是另一件事，风险也高）；服务端会把改过的字段记进
 * `editedFields`，重建索引时保住它们（见 `services/storage.ts` 的 `withSongMeta`）。
 *
 * 只提交**真正改过**的字段：这样“手动”的记账是精确的 —— 你只改了歌名，
 * 歌手/专辑仍然跟着音频标签走，将来补了标签还能自动刷新。
 *
 * 行为层用 Reka Dialog（铁律 1）；样式写在非 scoped 块里（Teleport，v4.60）。
 * 与其他弹层同一套做法：`force-mount` + `data-state` 驱动过渡、只做 opacity、
 * 关闭态补 `visibility: hidden`（否则隐形面板会拦住点击）、关不丢内容（v5.55）。
 */
const props = defineProps<{ open: boolean; song: Song | null }>();
const emit = defineEmits<{ "update:open": [value: boolean]; saved: [song: Song] }>();

const title = ref("");
const artist = ref("");
const album = ref("");
const saving = ref(false);
const error = ref("");

// 每次打开都从这一条曲目重新填（关闭时不清：离场动画期间内容要留在原地，v5.55）
watch(
  () => [props.open, props.song?.id] as const,
  ([open]) => {
    const song = props.song;
    if (!open || !song) return;
    title.value = song.title;
    artist.value = song.artist;
    album.value = song.album;
    error.value = "";
  },
  { immediate: true },
);

function close(): void {
  emit("update:open", false);
}

async function save(): Promise<void> {
  const song = props.song;
  if (!song || saving.value) return;

  // 只发改过的字段（规则见 utils/songMeta）；没改就当作关闭，不白跑一趟接口
  const patch = diffSongMeta(song, {
    title: title.value,
    artist: artist.value,
    album: album.value,
  });
  if (!patch) {
    close();
    return;
  }

  saving.value = true;
  error.value = "";
  try {
    const updated = await updateSong(song.id, patch);
    emit("saved", updated);
    close();
  } catch (err) {
    error.value = libraryErrorMessage(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <DialogRoot
    :open="props.open"
    @update:open="
      (value) => {
        if (!value) close();
      }
    "
  >
    <DialogPortal>
      <DialogOverlay class="sm-scrim" force-mount />
      <DialogContent class="sm-card" force-mount>
        <DialogTitle class="sm-title">编辑曲目信息</DialogTitle>
        <DialogDescription class="sm-desc">
          这首歌的标签缺失或不对时可以在这里改，改过的字段重建索引也会保留。
        </DialogDescription>

        <form class="sm-form" @submit.prevent="save">
          <label class="sm-field">
            <span>歌名</span>
            <input
              v-model="title"
              type="text"
              required
              :maxlength="SONG_FIELD_MAX_LENGTH"
              placeholder="必填"
            />
          </label>
          <label class="sm-field">
            <span>歌手</span>
            <input v-model="artist" type="text" :maxlength="SONG_FIELD_MAX_LENGTH" />
          </label>
          <label class="sm-field">
            <span>专辑</span>
            <input v-model="album" type="text" :maxlength="SONG_FIELD_MAX_LENGTH" />
          </label>

          <p v-if="error" class="sm-error" role="alert">{{ error }}</p>

          <div class="sm-actions">
            <button type="button" class="btn" :disabled="saving" @click="close">取消</button>
            <button type="submit" class="btn btn-primary" :disabled="saving || !title.trim()">
              {{ saving ? "保存中…" : "保存" }}
            </button>
          </div>
        </form>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style>
/* ⚠️ 非 scoped：Reka 把内容 Teleport 到 body，scoped 的 [data-v-x] 不会跟过去（v4.60）。
   隔离靠 sm- 前缀；材质取“大面”那一档（背后是列表正文，见开发约定）。 */
.sm-scrim {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: var(--scrim);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition:
    opacity 0.2s ease,
    visibility 0s 0.2s;
}

.sm-scrim[data-state="open"] {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transition:
    opacity 0.2s var(--ease-ios),
    visibility 0s;
}

.sm-card {
  position: fixed;
  inset: 0;
  margin: auto;
  z-index: 101;
  width: min(420px, 92vw);
  height: fit-content;
  max-height: min(80vh, 520px);
  overflow-y: auto;
  padding: 20px 22px 18px;
  border-radius: var(--radius-panel);
  border: 1px solid var(--glass-border);
  background: var(--tray-bg);
  backdrop-filter: var(--tray-blur);
  -webkit-backdrop-filter: var(--tray-blur);
  box-shadow: var(--panel-sheen), var(--panel-shadow);
  opacity: 0;
  visibility: hidden;
  /* 只做透明度：面板带 backdrop-filter，动 transform 每帧重算模糊（v5.54） */
  transition:
    opacity 0.2s ease,
    visibility 0s 0.2s;
}

.sm-card[data-state="open"] {
  opacity: 1;
  visibility: visible;
  transition:
    opacity 0.18s var(--ease-ios),
    visibility 0s;
}

.sm-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
}

.sm-desc {
  margin-top: 6px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-2);
}

.sm-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 16px;
}

.sm-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: var(--text-2);
}

.sm-field input {
  height: 34px;
  padding: 0 11px;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-control);
  background: var(--glass-bg-strong);
  color: var(--text-1);
  font-size: 13px;
}

.sm-field input::placeholder {
  color: var(--text-3);
}

.sm-error {
  font-size: 12px;
  color: var(--danger);
}

.sm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 6px;
}

@media (max-width: 480px) {
  .sm-actions .btn {
    flex: 1;
    justify-content: center;
  }
}
</style>
