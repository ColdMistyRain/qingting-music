<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from "reka-ui";
import {
  COVER_MAX_BYTES,
  COVER_EXTENSIONS,
  SONG_FIELD_MAX_LENGTH,
  isCoverFileName,
  validateLyricsText,
  type Song,
} from "@qingting/shared";
import IconImage from "~icons/ph/image";
import IconMusicNotes from "~icons/ph/music-notes";
import IconNote from "~icons/ph/note";
import {
  deleteSongCover,
  libraryErrorMessage,
  saveSongLyrics,
  updateSong,
  uploadSongCover,
} from "@/api/songs";
import { decodeLyricsBytes } from "@/utils/lyricsLibrary";
import { diffSongMeta } from "@/utils/songMeta";

/**
 * 曲目信息编辑弹窗（AD-02 + v6.13 扩展）：曲库管理每行「编辑」与上传完成后「填写信息」**共用这一份**。
 *
 * 为什么需要它：上传的音频里可能压根没有标签（或带错了），标题只能退到文件名、
 * 歌手退到“未知歌手”——这时得让人能改。还有两样东西同样会缺（需求方 v6.13：
 * “缺少封面上传和歌词上传”）：**封面**（文件里没图就是一片占位）与**歌词**
 * （文件里没内嵌就是空的）。三样都在这里补。
 *
 * 改的都是**曲库索引里的东西**，不重写音频容器（重写容器风险高，也不是用户要的）：
 * 改过的字段记进 `editedFields`、换过的封面与歌词记进 `editedAssets`，
 * **重建索引时保住它们**（见 `services/storage.ts`）。
 *
 * 三步分开提交（元信息 / 封面 / 歌词各一条接口）：某一步失败时，界面上会写清
 * “哪几步已经保存、哪一步没成”——已成功的那几步就地清掉待办状态，重试只补没成的。
 *
 * 行为层用 Reka Dialog（铁律 1）；样式写在非 scoped 块里（Teleport，v4.60）。
 * 与其他弹层同一套做法：`force-mount` + `data-state` 驱动过渡、只做 opacity、
 * 关闭态补 `visibility: hidden`（否则隐形面板会拦住点击）、关不丢内容（v5.55）。
 */
const props = defineProps<{ open: boolean; song: Song | null }>();
const emit = defineEmits<{
  "update:open": [value: boolean];
  /** 保存成功：第二个参数是刚刚存下的歌词正文（没改歌词时为 undefined） */
  saved: [song: Song, assets: { lyrics?: string }];
}>();

const title = ref("");
const artist = ref("");
const album = ref("");
/** 选好的封面文件（还没上传）；与 `coverRemoved` 互斥 */
const coverFile = ref<File | null>(null);
const coverRemoved = ref(false);
/** 本地预览用的 Blob URL（只用于预览，随选择变化释放） */
const coverPreviewUrl = ref("");
/** 歌词草稿：空串 = 没改过；「选择文件」读进来也是填进这里，用户可以顺手改两笔 */
const lyricsDraft = ref("");
const pasting = ref(false);
const lyricsError = ref("");
const saving = ref(false);
const error = ref("");

const coverInput = ref<HTMLInputElement | null>(null);
const lyricsInput = ref<HTMLInputElement | null>(null);

const coverAccept = COVER_EXTENSIONS.map((extension) => `.${extension}`).join(",");
const coverLimitText = `${Math.round(COVER_MAX_BYTES / 1024 / 1024)} MB`;

/** 当前该显示的封面：新选的 > 现成的（除非标了移除） */
const coverShown = computed(() => {
  if (coverFile.value) return coverPreviewUrl.value;
  if (coverRemoved.value) return "";
  return props.song?.coverUrl ?? "";
});
const hasCover = computed(() => coverShown.value !== "");
const coverAction = computed(() => (props.song?.coverUrl ? "换一张" : "选择图片"));

/** 歌词状态：草稿有内容就是要换，否则看索引里的标记 */
const lyricsState = computed(() => {
  if (lyricsDraft.value) {
    const lines = lyricsDraft.value.split(/\r?\n/).filter((line) => line.trim()).length;
    return `将保存 ${lines} 行新歌词（保存后替换曲库里现有的那份）`;
  }
  return props.song?.hasLyrics ? "曲库里已有歌词" : "曲库里还没有歌词";
});

// 每次打开都从这一条曲目重新填（关闭时不清：离场动画期间内容要留在原地，v5.55）
watch(
  () => [props.open, props.song?.id] as const,
  ([open]) => {
    const song = props.song;
    if (!open || !song) return;
    title.value = song.title;
    artist.value = song.artist;
    album.value = song.album;
    resetAssets();
    error.value = "";
  },
  { immediate: true },
);

/** 清掉封面/歌词的待办状态（打开时重置；某一步保存成功后也各自清一次） */
function resetAssets(): void {
  coverFile.value = null;
  coverRemoved.value = false;
  setCoverPreview("");
  lyricsDraft.value = "";
  pasting.value = false;
  lyricsError.value = "";
}

function setCoverPreview(url: string): void {
  if (coverPreviewUrl.value) URL.revokeObjectURL(coverPreviewUrl.value);
  coverPreviewUrl.value = url;
}

function close(): void {
  emit("update:open", false);
}

function pickCover(): void {
  error.value = "";
  coverInput.value?.click();
}

function onCoverChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  // 清掉 value：同一个文件改完再选一次也要能触发 change
  input.value = "";
  if (!file) return;

  if (!isCoverFileName(file.name)) {
    error.value = "封面得是图片（JPG / PNG / WebP）";
    return;
  }
  if (file.size > COVER_MAX_BYTES) {
    error.value = `封面太大了（上限 ${coverLimitText}）`;
    return;
  }

  coverFile.value = file;
  coverRemoved.value = false;
  setCoverPreview(URL.createObjectURL(file));
  error.value = "";
}

function removeCover(): void {
  coverFile.value = null;
  setCoverPreview("");
  coverRemoved.value = true;
}

function pickLyrics(): void {
  lyricsError.value = "";
  lyricsInput.value?.click();
}

/** 选 .lrc：按编码回退读成文本，填进草稿框 —— 两条路（文件 / 粘贴）汇成同一件事 */
async function onLyricsChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;

  try {
    const text = decodeLyricsBytes(await file.arrayBuffer());
    const check = validateLyricsText(text);
    if (!check.ok) {
      lyricsError.value = check.message;
      return;
    }
    lyricsDraft.value = check.value;
    pasting.value = true;
    lyricsError.value = "";
  } catch {
    lyricsError.value = "这个文件读不出来，换一份试试。";
  }
}

function startPaste(): void {
  pasting.value = true;
  lyricsError.value = "";
}

async function save(): Promise<void> {
  const song = props.song;
  if (!song || saving.value) return;

  // 只发改过的字段（规则见 utils/songMeta）
  const patch = diffSongMeta(song, {
    title: title.value,
    artist: artist.value,
    album: album.value,
  });

  /** 歌词草稿：非空才提交；提交前先在本地校验，错误直接指到歌词那一行 */
  let lyricsText = "";
  if (lyricsDraft.value.trim()) {
    const check = validateLyricsText(lyricsDraft.value);
    if (!check.ok) {
      lyricsError.value = check.message;
      return;
    }
    lyricsText = check.value;
  }

  const steps: { label: string; run: () => Promise<Song | null> }[] = [];
  if (patch) {
    steps.push({ label: "曲目信息", run: () => updateSong(song.id, patch) });
  }
  if (coverFile.value) {
    const file = coverFile.value;
    steps.push({
      label: "封面",
      run: async () => {
        const updated = await uploadSongCover(song.id, file);
        // 这一步落地了：清掉待办，失败重试时不会再发一遍
        coverFile.value = null;
        return updated;
      },
    });
  } else if (coverRemoved.value) {
    steps.push({
      label: "封面",
      run: async () => {
        const updated = await deleteSongCover(song.id);
        coverRemoved.value = false;
        return updated;
      },
    });
  }
  if (lyricsText) {
    steps.push({
      label: "歌词",
      run: async () => {
        const updated = await saveSongLyrics(song.id, lyricsText);
        lyricsDraft.value = "";
        pasting.value = false;
        return updated;
      },
    });
  }

  // 什么都没改：当作关闭，不白跑接口
  if (steps.length === 0) {
    close();
    return;
  }

  saving.value = true;
  error.value = "";
  let updated: Song | null = null;

  for (let index = 0; index < steps.length; index += 1) {
    try {
      updated = (await steps[index]!.run()) ?? updated;
    } catch (err) {
      // 说清哪几步已经保存、哪一步没成 —— 三步各自独立，不能假装“保存失败”一笔带过
      const done = steps.slice(0, index).map((step) => step.label);
      const what = steps[index]!.label;
      error.value = done.length
        ? `${done.join("、")}已保存，但${what}没保存成功：${libraryErrorMessage(err)}`
        : libraryErrorMessage(err);
      saving.value = false;
      return;
    }
  }
  saving.value = false;

  if (updated) emit("saved", updated, lyricsText ? { lyrics: lyricsText } : {});
  close();
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
          这里的改动只影响曲库里显示的信息，不会重写音频文件本身；改过的内容重建索引也会保留。
        </DialogDescription>

        <form class="sm-form" @submit.prevent="save">
          <!-- 封面（AD-02 扩展）：文件里没图时补一张，不满意可以换或去掉 -->
          <div class="sm-asset">
            <span class="sm-asset__label">封面</span>
            <div class="sm-asset__body">
              <div class="sm-cover">
                <img v-if="coverShown" :src="coverShown" alt="" />
                <IconImage v-else class="icon" />
              </div>
              <div class="sm-asset__ops">
                <button type="button" class="btn btn-quiet" @click="pickCover">
                  {{ coverAction }}
                </button>
                <button v-if="hasCover" type="button" class="btn btn-quiet" @click="removeCover">
                  去掉
                </button>
                <span class="sm-asset__hint">JPG / PNG / WebP，最大 {{ coverLimitText }}</span>
              </div>
            </div>
          </div>

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

          <!-- 歌词（AD-02 扩展）：传文件与直接粘文本是同一条路，读进来都落在这个框里 -->
          <div class="sm-asset">
            <span class="sm-asset__label">歌词</span>
            <div class="sm-asset__body">
              <div class="sm-asset__state">
                <IconNote class="icon" />
                {{ lyricsState }}
              </div>
              <div class="sm-asset__ops">
                <button type="button" class="btn btn-quiet" @click="pickLyrics">
                  <IconMusicNotes class="icon" />
                  选择 .lrc 文件
                </button>
                <button v-if="!pasting" type="button" class="btn btn-quiet" @click="startPaste">
                  粘贴歌词
                </button>
              </div>
              <textarea
                v-if="pasting"
                v-model="lyricsDraft"
                class="sm-lyrics"
                rows="6"
                spellcheck="false"
                placeholder="把歌词粘到这里，例如：[00:12.34]第一句"
              />
              <p v-if="lyricsError" class="sm-error" role="alert">{{ lyricsError }}</p>
              <p v-else-if="pasting" class="sm-asset__hint">
                需要带时间标签的行（LRC 的 [mm:ss.xx] / 增强型 LRC / yrc）—— 播放时按它跟进度走。
              </p>
            </div>
          </div>

          <p v-if="error" class="sm-error" role="alert">{{ error }}</p>

          <div class="sm-actions">
            <button type="button" class="btn" :disabled="saving" @click="close">取消</button>
            <button type="submit" class="btn btn-primary" :disabled="saving || !title.trim()">
              {{ saving ? "保存中…" : "保存" }}
            </button>
          </div>
        </form>
      </DialogContent>

      <!-- 藏在组件里的两个选择器：由上面的按钮触发，选完就清空 value -->
      <input
        ref="coverInput"
        class="sm-file"
        type="file"
        :accept="coverAccept"
        @change="onCoverChange"
      />
      <input
        ref="lyricsInput"
        class="sm-file"
        type="file"
        accept=".lrc,.yrc,.txt,text/plain"
        @change="onLyricsChange"
      />
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
  /* 加了封面与歌词两块之后高度紧，宽一点、上限松一点，免得保存键总要滚一下才看见 */
  width: min(460px, 94vw);
  height: fit-content;
  max-height: min(86vh, 640px);
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

/* 封面 / 歌词这两块：标签在左、内容在右，与上面三个字段同一竖直节奏 */
.sm-asset {
  display: flex;
  gap: 10px;
  font-size: 12px;
  color: var(--text-2);
}

.sm-asset__label {
  flex: 0 0 28px;
  padding-top: 8px;
}

.sm-asset__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

/* 封面缩略图：与列表行里的封面同一档圆角，空态是一只图片图标（不编造图案） */
.sm-cover {
  display: grid;
  place-items: center;
  width: 72px;
  height: 72px;
  overflow: hidden;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-control);
  background: var(--glass-bg-strong);
  color: var(--text-3);
}

.sm-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.sm-asset__ops {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.sm-asset__ops .btn {
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
}

.sm-asset__hint {
  flex-basis: 100%;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--text-3);
}

.sm-asset__state {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-2);
}

.sm-lyrics {
  width: 100%;
  min-height: 108px;
  padding: 9px 11px;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-control);
  background: var(--glass-bg-strong);
  color: var(--text-1);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.7;
  resize: vertical;
}

.sm-lyrics::placeholder {
  color: var(--text-3);
}

/* 藏起来的文件选择器用 opacity 而不是 display:none —— 部分浏览器对后者不让点 */
.sm-file {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
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
