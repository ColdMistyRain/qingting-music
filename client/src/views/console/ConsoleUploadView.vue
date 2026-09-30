<script setup lang="ts">
import { computed, ref } from "vue";
import IconArrowsClockwise from "~icons/ph/arrows-clockwise";
import IconCheckCircle from "~icons/ph/check-circle";
import IconFolderOpen from "~icons/ph/folder-open";
import IconUploadSimple from "~icons/ph/upload-simple";
import IconWarningCircle from "~icons/ph/warning-circle";
import IconX from "~icons/ph/x";
import { SONG_DUPLICATE_CODE, isAudioFileName } from "@qingting/shared";
import { ApiError } from "@/api/http";
import { isRetryableUploadError, uploadSong } from "@/api/upload";
import { useConfigStore } from "@/stores/config";
import { useLibraryStore } from "@/stores/library";
import { formatSize } from "@/utils/format";

/**
 * 控制台 · 上传导入（AD-01 / LB-01~03）。
 * 逐个文件顺序上传：每个文件独立进度与结果，某个失败不影响后面的（PRD AD-01），
 * 上传成功后直接把新曲目插进曲库 store，切到曲库管理 / 音乐库就能看到。
 */

type ItemStatus = "waiting" | "uploading" | "done" | "duplicate" | "skipped" | "failed";

interface UploadItem {
  /** 本地唯一键：文件名可能重复，不能拿来当 key */
  key: string;
  file: File;
  status: ItemStatus;
  /** 0~1 */
  progress: number;
  message: string;
  /** 值不值得重试（不可重试的错误不给重试按钮，避免误导） */
  retryable: boolean;
  overwrite: boolean;
}

const STATUS_LABELS: Record<ItemStatus, string> = {
  waiting: "等待中",
  uploading: "上传中",
  done: "已完成",
  duplicate: "已存在",
  skipped: "已跳过",
  failed: "失败",
};

const library = useLibraryStore();
const config = useConfigStore();
void config.load();

const items = ref<UploadItem[]>([]);
const dragging = ref(false);
const skippedFiles = ref(0);
const fileInput = ref<HTMLInputElement | null>(null);

let keySeed = 0;
let running = false;
const controllers = new Map<string, AbortController>();

const limitLabel = computed(() => (config.maxUploadSize ? formatSize(config.maxUploadSize, 0) : "300 MB"));
const doneCount = computed(() => items.value.filter((item) => item.status === "done").length);
const duplicateCount = computed(() => items.value.filter((item) => item.status === "duplicate").length);
const failedCount = computed(() => items.value.filter((item) => item.status === "failed").length);
/** 只有“可重试的失败”才计入，用于汇总与“全部重试” */
const retryableItems = computed(() => items.value.filter((item) => item.status === "failed" && item.retryable));
const busy = computed(() =>
  items.value.some((item) => item.status === "waiting" || item.status === "uploading"),
);
/** 汇总只说“需要你知道的”：完成 / 重复 / 失败各多少 */
const summaryText = computed(() => {
  if (items.value.length === 0) return "";
  const parts = [`${items.value.length} 个任务`];
  if (doneCount.value > 0) parts.push(`完成 ${doneCount.value}`);
  if (duplicateCount.value > 0) parts.push(`重复 ${duplicateCount.value}`);
  if (failedCount.value > 0) parts.push(`失败 ${failedCount.value}`);
  return parts.join(" · ");
});
const clearable = computed(() => items.value.some((item) => item.status === "done" || item.status === "skipped"));

/** 把可重试的失败全部重新排回队列 */
function retryAll(): void {
  for (const item of retryableItems.value) {
    item.status = "waiting";
    item.message = "";
  }
  void runQueue();
}

function addFiles(files: FileList | File[]): void {
  const list = Array.from(files);
  const audio = list.filter((file) => isAudioFileName(file.name));
  skippedFiles.value += list.length - audio.length;

  for (const file of audio) {
    items.value.push({
      key: `item-${(keySeed += 1)}`,
      file,
      status: "waiting",
      progress: 0,
      message: "",
      retryable: true,
      overwrite: false,
    });
  }
  void runQueue();
}

function pickFiles(): void {
  fileInput.value?.click();
}

function onFileInput(event: Event): void {
  const input = event.target as HTMLInputElement;
  if (input.files?.length) addFiles(input.files);
  // 清空以便重复选择同一个文件也能触发 change
  input.value = "";
}

function onDrop(event: DragEvent): void {
  dragging.value = false;
  if (event.dataTransfer?.files.length) addFiles(event.dataTransfer.files);
}

function statusText(item: UploadItem): string {
  if (item.status === "uploading") return `${STATUS_LABELS.uploading} ${Math.round(item.progress * 100)}%`;
  return item.message || STATUS_LABELS[item.status];
}

/** 顺序跑完所有“等待中”的任务；正在跑时不重入 */
async function runQueue(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const item = items.value.find((entry) => entry.status === "waiting");
      if (!item) break;
      await runOne(item);
    }
  } finally {
    running = false;
  }
}

async function runOne(item: UploadItem): Promise<void> {
  const controller = new AbortController();
  controllers.set(item.key, controller);
  item.status = "uploading";
  item.progress = 0;
  item.message = "";

  try {
    const song = await uploadSong(item.file, {
      overwrite: item.overwrite,
      signal: controller.signal,
      onProgress: (ratio) => {
        item.progress = ratio;
      },
    });
    item.status = "done";
    item.progress = 1;
    item.message = `${formatSize(song.size)} · ${song.title}`;
    library.applyUploaded(song);
  } catch (error) {
    if (error instanceof ApiError && error.code === SONG_DUPLICATE_CODE) {
      item.status = "duplicate";
      item.message = "同名同大小，已存在";
    } else if (error instanceof DOMException && error.name === "AbortError") {
      item.status = "skipped";
      item.message = "已取消";
    } else {
      item.status = "failed";
      item.message = error instanceof Error ? error.message : "上传失败";
      item.retryable = isRetryableUploadError(error);
    }
  } finally {
    controllers.delete(item.key);
  }
}

function overwrite(item: UploadItem): void {
  item.overwrite = true;
  item.status = "waiting";
  item.message = "";
  void runQueue();
}

function skip(item: UploadItem): void {
  item.status = "skipped";
  item.message = "已跳过";
}

function retry(item: UploadItem): void {
  item.status = "waiting";
  item.message = "";
  void runQueue();
}

function cancel(item: UploadItem): void {
  controllers.get(item.key)?.abort();
}

function removeItem(item: UploadItem): void {
  cancel(item);
  items.value = items.value.filter((entry) => entry.key !== item.key);
}

function clearFinished(): void {
  // 只清“已完成/已跳过”，正在上传与待处理（含失败待重试）的留着
  items.value = items.value.filter((item) => item.status !== "done" && item.status !== "skipped");
}
</script>

<template>
  <section>
    <div class="page-head">
      <h1>
        上传导入
        <div class="sub">音乐会上传到你的服务器，手机浏览器也能听</div>
      </h1>
    </div>

    <div
      class="dropzone"
      :class="{ 'dropzone--drag': dragging, 'dropzone--compact': items.length > 0 }"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <span class="dz-badge"><IconUploadSimple class="icon" /></span>
      <div class="dz-title">把音频文件拖到这里</div>
      <div class="dz-sub">支持 MP3 · FLAC · WAV · OGG · M4A · OPUS · 单个最大 {{ limitLabel }}</div>
      <div class="dropzone__actions">
        <button class="btn" :class="{ 'btn-primary': items.length === 0 }" @click="pickFiles">
          <IconFolderOpen class="icon" />
          选择文件
        </button>
      </div>
      <div class="dz-note">重名文件会先提示，可选择跳过或覆盖；某个文件失败不影响其他文件</div>
      <input
        ref="fileInput"
        class="sr-only"
        type="file"
        multiple
        accept=".mp3,.flac,.wav,.ogg,.m4a,.aac,.opus,audio/*"
        @change="onFileInput"
      />
    </div>

    <div class="queue card">
      <div class="queue__head">
        <b>上传队列</b>
        <span
          class="queue__summary"
          :class="{ 'queue__summary--warn': failedCount > 0 }"
          aria-live="polite"
        >
          {{ summaryText }}
        </span>
        <button v-if="retryableItems.length > 0 && !busy" class="btn btn-quiet" @click="retryAll">
          <IconArrowsClockwise class="icon" />
          全部重试（{{ retryableItems.length }}）
        </button>
        <button v-if="clearable" class="btn btn-quiet" @click="clearFinished">清空已完成</button>
      </div>

      <p v-if="skippedFiles > 0" class="queue__skip">已忽略 {{ skippedFiles }} 个非音频文件</p>

      <p v-if="items.length === 0" class="queue__empty">
        拖入文件后，这里会逐个显示上传进度与结果
      </p>

      <div v-else class="up-list">
        <div v-for="item in items" :key="item.key" class="up" :class="`up--${item.status}`">
          <span class="up__icon">
            <IconCheckCircle v-if="item.status === 'done'" class="icon" />
            <IconWarningCircle v-else-if="item.status === 'failed'" class="icon" />
            <IconUploadSimple v-else class="icon" />
          </span>

          <div class="up__info">
            <div class="up__title" :title="item.file.name">{{ item.file.name }}</div>

            <!-- 结果行紧贴文件名：不用把眼睛跨到最右边去找失败原因 -->
            <div v-if="item.status === 'uploading'" class="up__progress">
              <div class="bar up__bar">
                <div class="bar__fill" :style="{ width: `${Math.round(item.progress * 100)}%` }" />
              </div>
              <span class="up__percent">{{ Math.round(item.progress * 100) }}%</span>
            </div>
            <div v-else class="up__result">{{ statusText(item) }}</div>
          </div>

          <div class="up__actions">
            <template v-if="item.status === 'duplicate'">
              <button class="btn btn-quiet" @click="overwrite(item)">覆盖</button>
              <button class="btn btn-quiet" @click="skip(item)">跳过</button>
            </template>
            <!-- 不可重试的错误（文件不合规）不给重试：重试永远不会成功，只会误导 -->
            <button
              v-else-if="item.status === 'failed' && item.retryable"
              class="btn btn-quiet"
              @click="retry(item)"
            >
              <IconArrowsClockwise class="icon" />
              重试
            </button>
            <button v-if="item.status === 'uploading'" class="ctl" title="取消上传" @click="cancel(item)">
              <IconX class="icon" />
            </button>
            <button v-else class="ctl" title="从队列移除" @click="removeItem(item)">
              <IconX class="icon" />
            </button>
          </div>
        </div>
      </div>

      <p v-if="items.length > 0 && !busy" class="queue__foot">
        这一批处理完了，去<RouterLink :to="{ name: 'console-songs' }">曲库管理</RouterLink>看看。
      </p>
    </div>
  </section>
</template>

<style scoped>
.queue {
  margin-top: 14px;
  padding: 16px 20px 18px;
}

.queue__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--glass-border);
}

.queue__head b {
  font-size: 14px;
}

.queue__head span {
  margin-right: auto;
  font-size: 12px;
  color: var(--text-3);
}

.queue__empty {
  padding: 22px 0 6px;
  text-align: center;
  font-size: 12.5px;
  color: var(--text-3);
}

.queue__skip,
.queue__foot {
  padding-top: 10px;
  font-size: 12px;
  color: var(--text-3);
}

.queue__foot a {
  color: var(--accent);
  text-decoration: none;
}

.up-list {
  display: grid;
  /* 用间距代替细分割线：行本身有圆角与底色，贴太紧会显得挤（用户反馈） */
  gap: 6px;
  padding-top: 10px;
}

/* 行栅格：图标 / 文件名+结果 / 操作。
   行高比单行列表高一些：两行文字需要呼吸，否则显得紧凑。 */
.up {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  min-height: 64px;
  padding: 10px 12px;
  border-radius: var(--radius-row);
  transition: background 0.15s;
}

/* 汇总：只说“需要你知道的”，有失败时标红 */
.queue__summary {
  margin-right: auto;
  font-size: 12px;
  color: var(--text-3);
}

.queue__summary--warn {
  color: var(--danger);
}

.up:hover {
  background: var(--hover);
}

.up__icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--glass-bg-strong);
  color: var(--text-2);
}

.up__icon .icon {
  width: 16px;
  height: 16px;
}

.up--uploading .up__icon {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  animation: up-pulse 1.6s ease-in-out infinite;
}

.up--done .up__icon {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.up--failed .up__icon {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}

.up--duplicate .up__icon,
.up--skipped .up__icon {
  color: var(--text-3);
}

@keyframes up-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}

@media (prefers-reduced-motion: reduce) {
  .up--uploading .up__icon {
    animation: none;
  }
}

/* 失败行给一层极淡的警示底：一眼能抳出哪几行要处理（不靠满屏红字） */
.up--failed {
  background: color-mix(in srgb, var(--danger) 6%, transparent);
}

.up--failed:hover {
  background: color-mix(in srgb, var(--danger) 13%, transparent);
}

.up__info {
  min-width: 0;
}

.up__title {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 结果行：成功写“大小 · 歌名”，失败写原因，都紧贴文件名下方 */
.up__result {
  margin-top: 5px;
  font-size: 11.5px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.up--done .up__result {
  color: var(--text-2);
}

.up--failed .up__result {
  color: var(--danger);
}

/* 上传中：进度条就坐在结果行的位置（与文件名同一个信息块） */
.up__progress {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}

.up__bar {
  flex: 1;
  max-width: 220px;
}

.up__percent {
  font-size: 11.5px;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}

.up__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: flex-end;
}
</style>
