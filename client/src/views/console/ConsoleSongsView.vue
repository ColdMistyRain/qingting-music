<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import type { Song } from "@qingting/shared";
import IconListDashes from "~icons/ph/list-dashes";
import IconMagnifyingGlass from "~icons/ph/magnifying-glass";
import IconPencilSimple from "~icons/ph/pencil-simple";
import IconSortAscending from "~icons/ph/sort-ascending";
import IconSortDescending from "~icons/ph/sort-descending";
import IconTrash from "~icons/ph/trash";
import IconWarningCircle from "~icons/ph/warning-circle";
import EmptyState from "@/components/EmptyState.vue";
import SongMetaDialog from "@/components/SongMetaDialog.vue";
import { useLibraryStore } from "@/stores/library";
import { confirmAction } from "@/utils/confirm";
import { formatDateTime, formatSize } from "@/utils/format";
import { filterSongs, sortSongs, type SongSortKey, type SortDirection } from "@/utils/library";

/**
 * 控制台 · 曲库管理（AD-02 / LB-04~05）。
 * 搜索与排序都走 `utils/library` 的纯函数；删除都要二次确认，确认统一走 `confirmAction`。
 */
const SORT_OPTIONS: { value: SongSortKey; label: string }[] = [
  { value: "uploadedAt", label: "上传时间" },
  { value: "title", label: "标题" },
  { value: "artist", label: "歌手" },
  { value: "size", label: "大小" },
];

const library = useLibraryStore();
onMounted(() => void library.load());

const keyword = ref("");
const sortKey = ref<SongSortKey>("uploadedAt");
const direction = ref<SortDirection>("desc");
const selected = ref<Set<string>>(new Set());
const busy = ref(false);
const actionError = ref("");

const rows = computed(() =>
  sortSongs(filterSongs(library.songs, keyword.value), sortKey.value, direction.value),
);

/** 正在编辑的那一条（AD-02）：弹窗由两个入口共用，这里只管“编辑哪首” */
const editing = ref<Song | null>(null);
const metaOpen = ref(false);

function startEdit(song: Song): void {
  editing.value = song;
  metaOpen.value = true;
}

/** 保存成功：就地换掉列表里那一条，并在队列里同步（曲目可能正在唱） */
function onMetaSaved(song: Song): void {
  library.applyUpdated(song);
}

const allSelected = computed(
  () => rows.value.length > 0 && rows.value.every((s) => selected.value.has(s.id)),
);
const selectedCount = computed(() => selected.value.size);
const showEmptyState = computed(() => library.status === "ready" && library.songs.length === 0);
const showErrorPanel = computed(() => library.status === "error" && library.songs.length === 0);

function toggleSelect(id: string): void {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

function toggleAll(): void {
  selected.value = allSelected.value ? new Set() : new Set(rows.value.map((song) => song.id));
}

function toggleDirection(): void {
  direction.value = direction.value === "asc" ? "desc" : "asc";
}

/** 单曲删除：先问一句（带歌名，别让用户猜删的是哪首） */
async function askRemoveOne(id: string, title: string): Promise<void> {
  const ok = await confirmAction({
    title: `删除《${title}》？`,
    description: "会和服务器上的文件一起删掉，且无法撤销。",
  });
  if (!ok) return;
  await removeOne(id);
}

async function removeOne(id: string): Promise<void> {
  busy.value = true;
  actionError.value = "";
  try {
    await library.remove(id);
    toggleSelectIfSelected(id);
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : "删除失败";
  } finally {
    busy.value = false;
  }
}

function toggleSelectIfSelected(id: string): void {
  if (!selected.value.has(id)) return;
  const next = new Set(selected.value);
  next.delete(id);
  selected.value = next;
}

/** 批量删除先问一句；逐个来，失败的留在选中里方便重试，不因为一首失败就中断整批 */
async function askRemoveSelected(): Promise<void> {
  const count = selectedCount.value;
  if (count === 0) return;
  const ok = await confirmAction({
    title: `删除选中的 ${count} 首？`,
    description: "会和服务器上的文件一起删掉，且无法撤销。",
    confirmText: `删除 ${count} 首`,
  });
  if (!ok) return;
  await removeSelected();
}

async function removeSelected(): Promise<void> {
  const ids = [...selected.value];
  if (ids.length === 0) return;

  busy.value = true;
  actionError.value = "";
  const failed: string[] = [];
  for (const id of ids) {
    try {
      await library.remove(id);
    } catch {
      failed.push(id);
    }
  }
  selected.value = new Set(failed);
  busy.value = false;
  if (failed.length > 0) actionError.value = `${failed.length} 首没能删掉（已保留选中，可重试）`;
}
</script>

<template>
  <section class="page-frame">
    <div class="page-head">
      <h1>
        曲库管理
        <div class="sub">
          共 {{ library.songs.length }} 首 · 占用 {{ formatSize(library.totalSize) }}
        </div>
      </h1>
      <button
        v-if="library.songs.length > 0 || library.status === 'error'"
        class="btn"
        :disabled="library.status === 'loading'"
        @click="library.load(true)"
      >
        刷新
      </button>
    </div>

    <!-- 刷新失败 / 操作失败：保留列表，只在上部给提示（不要白屏） -->
    <div v-if="library.status === 'error' && library.songs.length > 0" class="strip">
      <IconWarningCircle class="icon" />
      <span>{{ library.error }}</span>
      <button class="btn btn-quiet" @click="library.load(true)">重试</button>
    </div>

    <div v-if="actionError" class="strip">
      <IconWarningCircle class="icon" />
      <span>{{ actionError }}</span>
    </div>

    <div v-if="library.songs.length > 0" class="toolbar">
      <label class="search">
        <IconMagnifyingGlass class="icon" />
        <input v-model="keyword" type="search" placeholder="搜索歌名、歌手或专辑" />
      </label>

      <label class="sort">
        <select v-model="sortKey">
          <option v-for="option in SORT_OPTIONS" :key="option.value" :value="option.value">
            按{{ option.label }}
          </option>
        </select>
      </label>
      <button
        class="ctl"
        :title="direction === 'asc' ? '升序（点击改为降序）' : '降序（点击改为升序）'"
        @click="toggleDirection"
      >
        <IconSortAscending v-if="direction === 'asc'" class="icon" />
        <IconSortDescending v-else class="icon" />
      </button>

      <span class="toolbar__spacer count">
        {{
          rows.length === library.songs.length ? `共 ${rows.length} 首` : `找到 ${rows.length} 首`
        }}
      </span>

      <button class="btn btn-danger" :disabled="selectedCount === 0" @click="askRemoveSelected">
        <IconTrash class="icon" />
        批量删除{{ selectedCount > 0 ? `（${selectedCount}）` : "" }}
      </button>
    </div>

    <!-- 只有表格滚动（方案 A）：页头与工具条固定在上部 -->
    <div class="page-frame__scroll">
      <div
        v-if="library.status === 'loading' && library.songs.length === 0"
        class="page-frame__fill"
      >
        <p class="note">正在读取曲库…</p>
      </div>

      <div v-else-if="showErrorPanel" class="page-frame__fill">
        <div class="fail card">
          <span class="fail__badge"><IconWarningCircle class="icon" /></span>
          <div class="fail__title">曲库没能读出来</div>
          <p class="fail__desc">{{ library.error }}</p>
          <button class="btn btn-primary" @click="library.load(true)">重试</button>
        </div>
      </div>

      <div v-else-if="showEmptyState" class="page-frame__fill">
        <EmptyState
          :icon="IconListDashes"
          title="曲库还是空的"
          desc="上传的音乐会出现在这里，可以搜索、排序与批量管理。"
          fill
        >
          <RouterLink class="btn btn-primary" :to="{ name: 'console-upload' }"
            >去上传音乐</RouterLink
          >
        </EmptyState>
      </div>

      <div v-else class="songs card">
        <div class="sg sg--head">
          <label class="sg__check">
            <input type="checkbox" :checked="allSelected" aria-label="全选" @change="toggleAll" />
          </label>
          <span></span>
          <span>曲目</span>
          <span class="sg__num">大小</span>
          <span class="sg__num">上传时间</span>
          <span></span>
        </div>

        <p v-if="rows.length === 0" class="note">没有匹配的歌曲，换个关键词试试。</p>

        <div v-for="song in rows" :key="song.id" class="sg">
          <label class="sg__check">
            <input
              type="checkbox"
              :checked="selected.has(song.id)"
              :aria-label="`选择 ${song.title}`"
              @change="toggleSelect(song.id)"
            />
          </label>

          <div class="sg__cover">
            <img v-if="song.coverUrl" :src="song.coverUrl" alt="" />
            <IconListDashes v-else class="icon" />
          </div>

          <div class="sg__main" :title="song.title">
            <div class="sg__title">{{ song.title }}</div>
            <div class="sg__sub">{{ song.artist }} · {{ song.album }}</div>
          </div>

          <div class="sg__num">{{ formatSize(song.size) }}</div>
          <div class="sg__num">{{ formatDateTime(song.uploadedAt) }}</div>

          <div class="sg__actions">
            <button
              class="ctl"
              :disabled="busy"
              title="编辑曲目信息"
              aria-label="编辑曲目信息"
              @click="startEdit(song)"
            >
              <IconPencilSimple class="icon" />
            </button>
            <button
              class="ctl"
              :disabled="busy"
              title="删除这首歌"
              @click="askRemoveOne(song.id, song.title)"
            >
              <IconTrash class="icon" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <SongMetaDialog v-model:open="metaOpen" :song="editing" @saved="onMetaSaved" />
  </section>
</template>

<style scoped>
.note {
  padding: 20px 0;
  text-align: center;
  font-size: 12.5px;
  color: var(--text-3);
}

.count {
  font-size: 12px;
  color: var(--text-3);
}

.sort select {
  height: 34px;
  padding: 0 10px;
  border-radius: var(--radius-control);
  background: var(--glass-bg-strong);
  border: 1px solid var(--glass-border);
  color: var(--text-2);
  font-size: 12.5px;
  cursor: pointer;
}

.fail {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 40px 24px 34px;
  text-align: center;
}

.fail__badge {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--danger) 14%, transparent);
  color: var(--danger);
}

.fail__title {
  font-size: 14px;
  font-weight: 600;
}

.fail__desc {
  font-size: 12.5px;
  color: var(--text-2);
  max-width: 380px;
}

.strip {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 8px 12px;
  border-radius: var(--radius-control);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
  font-size: 12.5px;
}

.strip .icon {
  width: 16px;
  height: 16px;
}

.strip .btn {
  margin-left: auto;
}

.songs {
  padding: 6px 10px 10px;
  /* 行间距跟着“宽/窄”换档（v4.91，与曲目列表同一套口径）：
     宽屏 gap 为 0（细线正落在行的上沿），窄屏（列收起）改由间距承担。 */
  display: flex;
  flex-direction: column;
  gap: 0;
}

@media (max-width: 1024px) {
  .songs {
    gap: var(--row-list-gap);
  }
}

/* 列：勾选 / 封面 / 曲目 / 大小 / 上传时间 / 操作 */
.sg {
  /* 分隔线用伪元素画，需要定位上下文 */
  position: relative;
  display: grid;
  grid-template-columns: 24px 40px minmax(0, 1fr) 90px 148px auto;
  align-items: center;
  gap: 14px;
  /* 与上传队列、曲目行同一套行节奏：两行文字不塞在 54px 里。
     **高度取 4 的倍数**（v4.92）：本列表的细线是行的 `::before`，行距就是行高，
     行高不是 4 的倍数时，125% 缩放下每条线的相位会循环（有的粗有的细）。 */
  min-height: 64px;
  padding: 8px 8px;
  border-radius: var(--radius-row);
}

.sg:not(.sg--head):hover {
  background: var(--hover);
}

/* 数据行之间的细线（v4.91：宽表靠它引导视线不串行；两端按行内边距内缩，不顶到圆角）。
   不用 border-top：行有圆角，线会沿圆角拐下去、两端各留一段弧。
   窄屏（列收起）不画线，分隔交给 .songs 的 gap。 */
.sg:not(.sg--head) + .sg:not(.sg--head)::before {
  content: "";
  position: absolute;
  top: 0;
  left: 8px;
  right: 8px;
  height: 1px;
  background: var(--glass-border);
  /* 同上：恒等于 1 个设备像素，避免“有的细线粗有的细” */
  transform: scaleY(var(--px-scale));
  transform-origin: top center;
}

@media (max-width: 1024px) {
  .sg:not(.sg--head) + .sg:not(.sg--head)::before {
    display: none;
  }
}

.sg--head {
  /* 与曲目列表表头同一规则：不吸顶、不加底色（吸顶要不透明底，
     而在玻璃岛上它一定露成色带，见 global.css 的说明） */
  height: 34px;
  border-bottom: 1px solid var(--glass-border);
  border-radius: 0;
  font-size: 11.5px;
  color: var(--text-3);
}

.sg__check {
  display: grid;
  place-items: center;
}

.sg__cover {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  overflow: hidden;
  border-radius: var(--radius-cover);
  background: linear-gradient(135deg, var(--cv1), var(--cv2));
  color: rgba(255, 255, 255, 0.8);
}

.sg__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.sg__cover .icon {
  width: 16px;
  height: 16px;
}

.sg__main {
  min-width: 0;
}

.sg__title {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sg__sub {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sg__num {
  font-size: 12px;
  color: var(--text-2);
  white-space: nowrap;
}

.sg--head .sg__num {
  color: var(--text-3);
}

.sg__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: flex-end;
}
</style>
