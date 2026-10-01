<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from "reka-ui";
import IconPencilSimple from "~icons/ph/pencil-simple";
import IconPlay from "~icons/ph/play";
import IconPlaylist from "~icons/ph/playlist";
import IconPlus from "~icons/ph/plus";
import IconTrash from "~icons/ph/trash";
import IconX from "~icons/ph/x";
import type { Song } from "@qingting/shared";
import EmptyState from "@/components/EmptyState.vue";
import InlineNameInput from "@/components/InlineNameInput.vue";
import NavToggle from "@/components/NavToggle.vue";
import { playlistErrorMessage } from "@/api/playlists";
import { useAuthStore } from "@/stores/auth";
import { useLibraryStore } from "@/stores/library";
import { usePlayerStore } from "@/stores/player";
import { usePlaylistsStore } from "@/stores/playlists";
import { confirmAction } from "@/utils/confirm";
import { formatTime } from "@/utils/format";
import { songToTrack } from "@/utils/library";
import { playableTracks, playlistTotalDuration, resolvePlaylist } from "@/utils/playlistEntries";
import type { PlaylistEntry } from "@/utils/playlistEntries";

/**
 * 歌单详情（PRD 3.6 / 原型 v2.6）：头部（封面 / 名称 / 曲目数 / 总时长）+ 操作 + 编号曲目列表。
 *
 * 数据在服务器端（PS-01）；"这条能不能播"交给 `utils/playlistEntries` 一处判断
 * （云端被删 / 本地缺失 / 在线未接入三种情况各自有话说，页面只管显示）。
 */
const props = defineProps<{ id: string }>();

const router = useRouter();
const auth = useAuthStore();
const playlists = usePlaylistsStore();
const library = useLibraryStore();
const player = usePlayerStore();

/** 歌单是访客级（AC-03）；未登录时本页没有内容可给（AC-01） */
const canEdit = computed(() => auth.role !== "anonymous");
const playlist = computed(() => playlists.byId.get(props.id) ?? null);
const entries = computed(() =>
  playlist.value
    ? resolvePlaylist(playlist.value, { songs: library.songs, queue: player.queue })
    : [],
);
const totalSeconds = computed(() =>
  playlist.value ? playlistTotalDuration(playlist.value.items) : 0,
);
const playable = computed(() => playableTracks(entries.value));
const cover = computed(() => entries.value.find((entry) => entry.item.cover)?.item.cover ?? null);

const renaming = ref(false);
const picking = ref(false);
const keyword = ref("");
const busy = ref(false);
const actionError = ref("");

/** 选择器只列"还没进这个歌单"的曲目：已在里面的不再出现，免得点了像没反应 */
const candidates = computed(() => {
  const already = new Set(playlist.value?.items.map((item) => item.refId) ?? []);
  const kw = keyword.value.trim().toLowerCase();
  return library.songs.filter((song) => {
    if (already.has(song.id)) return false;
    if (!kw) return true;
    return `${song.title} ${song.artist} ${song.album}`.toLowerCase().includes(kw);
  });
});

onMounted(async () => {
  if (!canEdit.value) return;
  await playlists.load();
  await library.load();
});

/** 写操作的统一收口：失败就把话显示在页面上，不吞掉 */
async function run(action: () => Promise<unknown>): Promise<void> {
  busy.value = true;
  actionError.value = "";
  try {
    await action();
  } catch (error) {
    actionError.value = playlistErrorMessage(error);
  } finally {
    busy.value = false;
  }
}

/** 从某一首开始播（PS-03）：只把能播的那批交给播放器，再按曲目对位 */
function playFrom(entry: PlaylistEntry): void {
  if (!entry.track) return;
  const index = playable.value.findIndex((track) => track.id === entry.track?.id);
  player.setQueue(playable.value, index < 0 ? 0 : index);
}

function playAll(): void {
  if (playable.value.length === 0) return;
  player.setQueue(playable.value, 0);
}

async function submitRename(name: string): Promise<void> {
  renaming.value = false;
  await run(() => playlists.rename(props.id, name));
}

async function removeEntry(entry: PlaylistEntry): Promise<void> {
  await run(() => playlists.removeItem(props.id, entry.item));
}

/** PS-02：把曲库里的歌加进来 */
async function addSong(song: Song): Promise<void> {
  await run(() => playlists.addTracks(props.id, [songToTrack(song)]));
}

/** PS-02：把当前播放列表整体加进来 —— 本地曲目就是这样进歌单的（只记引用，不搬文件） */
async function addCurrentQueue(): Promise<void> {
  await run(() => playlists.addTracks(props.id, player.queue));
}

async function removePlaylist(): Promise<void> {
  const name = playlist.value?.name ?? "";
  const ok = await confirmAction({
    title: `删除《${name}》？`,
    description: "歌单会被删掉，曲库里的歌与本机文件都不受影响。",
  });
  if (!ok) return;
  await run(async () => {
    await playlists.remove(props.id);
    await router.push({ name: "library" });
  });
}
</script>

<template>
  <section class="page-frame">
    <div class="page-head">
      <div class="page-head__title">
        <NavToggle />
        <h1>{{ playlist?.name ?? "歌单" }}</h1>
      </div>
    </div>

    <!-- 未登录（AC-01）：歌单是服务器功能，只给一句引导，不渲染点不动的假控件 -->
    <EmptyState
      v-if="!canEdit"
      :icon="IconPlaylist"
      title="登录后才能用歌单"
      desc="歌单存在服务器上，登录后就能把喜欢的歌收进来。"
    />

    <EmptyState
      v-else-if="!playlist && playlists.status === 'ready'"
      :icon="IconPlaylist"
      title="这个歌单不在了"
      desc="可能已经在别处删除。回音乐库或本地播放接着听吧。"
    />

    <template v-else-if="playlist">
      <div class="pl-head">
        <div class="pl-cover">
          <img v-if="cover" :src="cover" alt="" />
          <IconPlaylist v-else class="icon" />
        </div>

        <div class="pl-info">
          <InlineNameInput
            v-if="renaming"
            :model-value="playlist.name"
            placeholder="歌单名"
            @submit="submitRename"
            @cancel="renaming = false"
          />
          <p v-else class="pl-name">{{ playlist.name }}</p>
          <p class="pl-meta">
            {{ playlist.items.length }} 首
            <template v-if="totalSeconds > 0"> · {{ formatTime(totalSeconds) }}</template>
          </p>
        </div>

        <div class="pl-actions">
          <button class="btn btn-primary" :disabled="playable.length === 0" @click="playAll">
            <IconPlay class="icon" />
            播放全部
          </button>
          <button class="btn" :disabled="busy" @click="picking = true">
            <IconPlus class="icon" />
            添加曲目
          </button>
          <button class="btn" :disabled="busy" @click="renaming = true">
            <IconPencilSimple class="icon" />
            重命名
          </button>
          <button class="btn btn-danger" :disabled="busy" @click="removePlaylist">
            <IconTrash class="icon" />
            删除
          </button>
        </div>
      </div>

      <p v-if="actionError" class="pl-error" role="alert">{{ actionError }}</p>

      <p v-if="entries.length === 0" class="pl-empty">
        这个歌单还是空的。点「添加曲目」从音乐库里挑，或把当前播放列表整体加进来。
      </p>

      <ol v-else class="pl-list">
        <li
          v-for="(entry, index) in entries"
          :key="entry.key"
          class="pl-row"
          :class="{ 'is-missing': !entry.track }"
        >
          <button
            class="pl-main"
            :disabled="!entry.track"
            :title="entry.track ? `播放 ${entry.item.title}` : entry.reason"
            @click="playFrom(entry)"
          >
            <span class="pl-index">{{ index + 1 }}</span>
            <span class="pl-art">
              <img v-if="entry.item.cover" :src="entry.item.cover" alt="" />
              <IconPlaylist v-else class="icon" />
            </span>
            <span class="pl-text">
              <b>{{ entry.item.title }}</b>
              <small>{{ entry.track ? entry.item.artist : entry.reason }}</small>
            </span>
            <span class="pl-time">{{ formatTime(entry.item.duration ?? null) }}</span>
          </button>

          <button
            class="pl-remove"
            :disabled="busy"
            :title="`把《${entry.item.title}》移出歌单`"
            @click="removeEntry(entry)"
          >
            <IconX class="icon" />
          </button>
        </li>
      </ol>
    </template>

    <!-- 添加曲目的选择器：直接列曲库，点一下加一首、可连点 -->
    <DialogRoot v-model:open="picking">
      <DialogPortal>
        <DialogOverlay class="pl-scrim" />
        <DialogContent class="pl-picker">
          <DialogTitle class="pl-picker__title">添加曲目</DialogTitle>
          <DialogDescription class="sr-only">
            从音乐库里挑曲目加进这个歌单；同一首歌不会重复添加。
          </DialogDescription>

          <input
            v-model="keyword"
            class="pl-search"
            type="search"
            placeholder="搜索歌名 / 歌手 / 专辑"
          />

          <p v-if="library.status === 'loading'" class="pl-picker__hint">正在读取曲库…</p>
          <p v-else-if="library.error" class="pl-picker__hint">{{ library.error }}</p>
          <p v-else-if="library.songs.length === 0" class="pl-picker__hint">
            曲库还是空的，先去控制台上传几首歌。
          </p>
          <p v-else-if="candidates.length === 0" class="pl-picker__hint">
            没有可添加的了 —— 曲库里的歌都在这个歌单里，或者没有匹配的。
          </p>

          <ul v-else class="pl-picker__list">
            <li v-for="song in candidates" :key="song.id">
              <button class="pl-pick" :disabled="busy" @click="addSong(song)">
                <span class="pl-art">
                  <img v-if="song.coverUrl" :src="song.coverUrl" alt="" />
                  <IconPlaylist v-else class="icon" />
                </span>
                <span class="pl-text">
                  <b>{{ song.title }}</b>
                  <small>{{ song.artist }} · {{ song.album }}</small>
                </span>
                <IconPlus class="icon" />
              </button>
            </li>
          </ul>

          <div class="pl-picker__actions">
            <button class="btn" :disabled="busy" @click="addCurrentQueue">
              <IconPlus class="icon" />
              加上当前播放列表（{{ player.queue.length }} 首）
            </button>
            <button class="btn btn-primary" @click="picking = false">完成</button>
          </div>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  </section>
</template>

<style scoped>
.pl-head {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 4px 0 18px;
}

.pl-cover,
.pl-art {
  display: grid;
  place-items: center;
  overflow: hidden;
  flex: none;
  border-radius: var(--radius-cover);
  background: var(--accent-soft);
  color: var(--accent);
}

.pl-cover {
  width: 72px;
  height: 72px;
}

.pl-art {
  width: 40px;
  height: 40px;
}

.pl-cover img,
.pl-art img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.pl-cover .icon {
  width: 28px;
  height: 28px;
}

.pl-art .icon {
  width: 18px;
  height: 18px;
}

.pl-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pl-name {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-1);
}

.pl-meta {
  font-size: 12px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

.pl-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.pl-error {
  margin-bottom: 10px;
  font-size: 13px;
  color: var(--danger);
}

.pl-empty {
  padding: 26px 2px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-3);
}

.pl-list {
  display: flex;
  flex-direction: column;
  gap: var(--row-list-gap);
  list-style: none;
}

.pl-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-right: 8px;
  border-radius: var(--radius-row);
}

.pl-row:hover {
  background: var(--hover);
}

/* 不能播的（云端已删 / 本地缺失 / 在线未接入）：整行弱一档，原因写在歌手那一行 */
.pl-row.is-missing .pl-main {
  opacity: 0.55;
}

.pl-main {
  flex: 1;
  min-width: 0;
  display: grid;
  align-items: center;
  gap: var(--row-gap);
  grid-template-columns: 28px 40px minmax(0, 1fr) 56px;
  padding: 10px 4px 10px 0;
  text-align: left;
}

.pl-main:disabled {
  cursor: default;
}

.pl-index {
  font-size: 12px;
  color: var(--text-3);
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.pl-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.pl-text b,
.pl-text small {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.pl-text b {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-1);
}

.pl-text small {
  font-size: 12px;
  color: var(--text-3);
}

.pl-time {
  font-size: 12px;
  color: var(--text-3);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.pl-remove {
  display: grid;
  place-items: center;
  flex: none;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-control);
  color: var(--text-3);
}

.pl-remove:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text-1);
}
</style>

<style>
/* ⚠️ 弹层样式写在**非 scoped** 的块里：Reka 把内容 Teleport 到 body，
   scoped 的 [data-v-x] 不会跟过去（v4.60 实测）。隔离靠 pl- 前缀。 */
.pl-scrim {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: var(--scrim);
}

.pl-picker {
  position: fixed;
  inset: 0;
  margin: auto;
  z-index: 91;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: min(460px, 92vw);
  height: fit-content;
  max-height: min(78vh, 560px);
  padding: 18px 20px 16px;
  border-radius: var(--radius-panel);
  border: 1px solid var(--glass-border);
  /* 背后是列表正文：取"大面"那一档材质（与确认框/抽屉同一档，见开发约定） */
  background: var(--tray-bg);
  backdrop-filter: var(--tray-blur);
  -webkit-backdrop-filter: var(--tray-blur);
  box-shadow: var(--panel-sheen), var(--panel-shadow);
  animation: pl-pop-in 0.18s var(--ease-ios);
}

/* 只做透明度：面板带 backdrop-filter，动 transform 会每帧重算模糊（v5.54 的规则） */
@keyframes pl-pop-in {
  from {
    opacity: 0;
  }
}

.pl-picker__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
}

.pl-search {
  height: 34px;
  padding: 0 11px;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-control);
  background: var(--glass-bg);
  color: var(--text-1);
  font-size: 13px;
}

.pl-search::placeholder {
  color: var(--text-3);
}

.pl-picker__hint {
  padding: 10px 2px;
  font-size: 13px;
  color: var(--text-3);
}

.pl-picker__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
  overflow-y: auto;
  list-style: none;
}

.pl-pick {
  width: 100%;
  display: grid;
  align-items: center;
  gap: 10px;
  grid-template-columns: 40px minmax(0, 1fr) 20px;
  padding: 6px 8px;
  border-radius: var(--radius-row);
  text-align: left;
  color: var(--text-3);
}

.pl-pick:hover:not(:disabled) {
  background: var(--hover);
  color: var(--accent);
}

.pl-picker__actions {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 4px;
}
</style>
