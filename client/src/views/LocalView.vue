<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import IconFolderOpen from "~icons/ph/folder-open";
import IconShieldCheck from "~icons/ph/shield-check";
import IconTrash from "~icons/ph/trash";
import IconUploadSimple from "~icons/ph/upload-simple";
import TrackListHead from "@/components/TrackListHead.vue";
import TrackRow from "@/components/TrackRow.vue";
import { usePlayerStore } from "@/stores/player";
import { collectFilesFromEntries, type EntryLike } from "@/utils/fileSystem";
import { formatTime } from "@/utils/format";
import { pickAudioFiles, probeDuration, toLocalTrack } from "@/utils/localFiles";
import { coverUrlFrom, readAudioTags } from "@/utils/metadata";

/**
 * 本地播放（PRD 3.3 LC-01~06）。
 * 文件全程留在浏览器：URL.createObjectURL 生成 Blob URL 交给播放器，
 * 不上传、不落盘；清空列表或移除曲目时立即 revokeObjectURL（LC-06）。
 */
const player = usePlayerStore();

const fileInput = ref<HTMLInputElement | null>(null);
const dragging = ref(false);
/** “清空列表”是否已进入待确认态 */
const confirmingClear = ref(false);
/** 被过滤掉的非音频数量与正在探测时长的曲目数，用于给用户一句反馈 */
const skipped = ref(0);
const probing = ref(0);

const hasTracks = computed(() => player.queue.length > 0);
const totalSeconds = computed(() =>
  player.queue.reduce((sum, track) => sum + (track.duration ?? 0), 0),
);

function pickFiles(): void {
  fileInput.value?.click();
}

function onFileInput(event: Event): void {
  const input = event.target as HTMLInputElement;
  addFiles(Array.from(input.files ?? []));
  input.value = ""; // 允许再次选择同一文件
}

function addFiles(files: readonly File[]): void {
  const audioFiles = pickAudioFiles(files);
  skipped.value = files.length - audioFiles.length;
  if (audioFiles.length === 0) return;

  const tracks = audioFiles.map((file) => toLocalTrack(file, URL.createObjectURL(file)));
  player.addTracks(tracks);

  // 读内嵌标签（LC-04）：成功则覆盖文件名解析结果并拿到封面；失败退回探测时长（LC-03）
  audioFiles.forEach((file, index) => {
    const track = tracks[index];
    if (!track) return;
    probing.value += 1;
    void readAudioTags(file)
      .then(async (tags) => {
        if (!tags) {
          const seconds = await probeDuration(track.url);
          if (seconds !== null) player.patchDuration(track.id, seconds);
          return;
        }
        const cover = coverUrlFrom(tags.picture);
        player.patchTrack(track.id, {
          ...(tags.title ? { title: tags.title } : {}),
          ...(tags.artist ? { artist: tags.artist } : {}),
          ...(tags.album ? { album: tags.album } : {}),
          ...(cover ? { cover } : {}),
          ...(tags.duration ? { duration: tags.duration } : {}),
        });
      })
      .finally(() => {
        probing.value -= 1;
      });
  });
}

/** 优先走 FileSystemEntry（支持文件夹），退化到 dataTransfer.files */
function filesFromDataTransfer(dataTransfer: DataTransfer | null): void {
  const entries = Array.from(dataTransfer?.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.webkitGetAsEntry?.() as unknown as EntryLike | null)
    .filter((entry): entry is EntryLike => entry !== null);

  if (entries.length > 0) {
    void collectFilesFromEntries(entries).then(addFiles);
    return;
  }
  addFiles(Array.from(dataTransfer?.files ?? []));
}

/* 拖拽整页可用（LC-01）：并阻止浏览器默认"打开文件"行为 */
function onWindowDragOver(event: DragEvent): void {
  // 只接管"拖文件进来"，别影响页内以后的拖拽（如排序）
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  dragging.value = true;
}

function onWindowDragLeave(event: DragEvent): void {
  // relatedTarget 为 null 表示鼠标真的离开了窗口
  if (event.relatedTarget === null) dragging.value = false;
}

function onWindowDrop(event: DragEvent): void {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  dragging.value = false;
  filesFromDataTransfer(event.dataTransfer);
}

onMounted(() => {
  window.addEventListener("dragover", onWindowDragOver);
  window.addEventListener("dragleave", onWindowDragLeave);
  window.addEventListener("drop", onWindowDrop);
});

onUnmounted(() => {
  window.removeEventListener("dragover", onWindowDragOver);
  window.removeEventListener("dragleave", onWindowDragLeave);
  window.removeEventListener("drop", onWindowDrop);
});

/** 点行上的播放键：正在播的那首再点即暂停 */
function onRowPlay(index: number): void {
  if (index === player.currentIndex) player.toggle();
  else player.playAt(index);
}

/** 清空是不可逆的批量动作：先问一句，确认后才真清（LC-06） */
function clearAll(): void {
  confirmingClear.value = false;
  player.clear();
}

// 列表被逐首移除到空时，别把“待确认”留给下一次进来
watch(
  () => player.queue.length,
  (length) => {
    if (length === 0) confirmingClear.value = false;
  },
);
</script>

<template>
  <section class="page-frame">
    <div class="page-head">
      <h1>
        本地播放
        <div class="sub">
          {{
            hasTracks
              ? `本地列表 · ${player.queue.length} 首 · ${formatTime(totalSeconds)}`
              : "直接在浏览器里播放，文件不经过服务器"
          }}
        </div>
      </h1>
      <!-- 有曲目时"添加"并入页头：投放区不再单独占一行（v4.37） -->
      <div v-if="hasTracks" class="page-head__actions">
        <button class="btn" title="支持 MP3 · FLAC · WAV · OGG · M4A · OPUS" @click="pickFiles">
          <IconFolderOpen class="icon" />
          选择文件
        </button>
        <template v-if="confirmingClear">
          <span class="confirm-hint">确定清空这 {{ player.queue.length }} 首？</span>
          <button class="btn btn-quiet" @click="confirmingClear = false">取消</button>
          <button class="btn btn-danger" @click="clearAll">清空</button>
        </template>
        <button v-else class="btn btn-danger" @click="confirmingClear = true">
          <IconTrash class="icon" />
          清空列表
        </button>
      </div>
    </div>

    <!-- 空列表才需要这张投放卡（它的作用是说明 + 隐私承诺，不是常驻工具条） -->
    <div v-if="!hasTracks" class="stage">
      <div class="dropzone" :class="{ 'dropzone--drag': dragging }">
        <span class="dz-badge"><IconUploadSimple class="icon" /></span>
        <div class="dz-title">拖入音乐文件或文件夹</div>
        <div class="dz-sub">支持 MP3 · FLAC · WAV · OGG · M4A · OPUS</div>
        <div class="dropzone__actions">
          <button class="btn btn-primary" @click="pickFiles">
            <IconFolderOpen class="icon" />
            选择文件
          </button>
        </div>
        <div class="dz-note">
          <IconShieldCheck class="icon" />
          文件只在你的浏览器里播放，不上传、不留存
        </div>
      </div>
    </div>

    <input
      ref="fileInput"
      class="sr-only"
      type="file"
      multiple
      accept=".mp3,.flac,.wav,.ogg,.m4a,.aac,.opus,audio/*"
      @change="onFileInput"
    />

    <!-- 拖入提示：投放卡不在时用一层浮层告诉用户"松手就落进来"（不挤动列表） -->
    <div v-if="dragging && hasTracks" class="drag-veil">松手就加入本地列表</div>

    <!-- 表头 = “说明”：放在滚动区外面（固定层），所以既不用吸顶、也不用底色，
         标签常驻而列表在它下面滚（v4.41） -->
    <TrackListHead v-if="hasTracks" />

    <!-- 只有列表滚动：页头与表头固定在上部（方案 A） -->
    <div v-if="hasTracks" class="local__list page-frame__scroll">
      <p v-if="skipped > 0" class="local__hint">已忽略 {{ skipped }} 个非音频文件</p>
      <p v-if="probing > 0" class="local__hint">正在读取歌曲信息…</p>
      <TrackRow
        v-for="(track, index) in player.queue"
        :key="track.id"
        :track="track"
        :index="index"
        :active="player.currentIndex === index"
        :playing="player.playing"
        @play="onRowPlay"
        @remove="player.removeAt"
      />
    </div>
  </section>
</template>

<style scoped>
/* 空列表：投放卡在帧里居中，页面不显得空 */
.stage {
  flex: 1;
  min-height: 0;
  display: grid;
  place-items: center;
}

.stage .dropzone {
  width: min(100%, 560px);
}

.local__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.local__hint {
  font-size: 12px;
  color: var(--text-3);
  padding: 4px 12px;
}
</style>
