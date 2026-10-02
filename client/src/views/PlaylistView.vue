<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from "reka-ui";
import AppTooltip from "@/components/AppTooltip.vue";
import IconDotsSixVertical from "~icons/ph/dots-six-vertical";
import IconDownloadSimple from "~icons/ph/download-simple";
import IconFileCode from "~icons/ph/file-code";
import IconMusicNotes from "~icons/ph/music-notes";
import IconPencilSimple from "~icons/ph/pencil-simple";
import IconPlay from "~icons/ph/play";
import IconPlaylist from "~icons/ph/playlist";
import IconWarningCircle from "~icons/ph/warning-circle";
import IconPlus from "~icons/ph/plus";
import IconTrash from "~icons/ph/trash";
import IconX from "~icons/ph/x";
import type { Song } from "@qingting/shared";
import EmptyState from "@/components/EmptyState.vue";
import InlineNameInput from "@/components/InlineNameInput.vue";
import NavToggle from "@/components/NavToggle.vue";
import { playlistErrorMessage } from "@/api/playlists";
import { useLibraryStore } from "@/stores/library";
import { usePlayerStore } from "@/stores/player";
import { usePlaylistsStore } from "@/stores/playlists";
import { confirmAction } from "@/utils/confirm";
import { formatTime } from "@/utils/format";
import { songToTrack } from "@/utils/library";
import { playableTracks, playlistTotalDuration, resolvePlaylist } from "@/utils/playlistEntries";
import type { PlaylistEntry } from "@/utils/playlistEntries";
import { exportFileName, toExportJson, toM3U8 } from "@/utils/playlistExport";

/**
 * 歌单详情（PRD 3.6 / 原型 v2.6）：头部（封面 / 名称 / 曲目数 / 总时长）+ 操作 + 编号曲目列表。
 *
 * 数据在服务器端（PS-01）；"这条能不能播"交给 `utils/playlistEntries` 一处判断
 * （云端被删 / 本地缺失 / 在线未接入三种情况各自有话说，页面只管显示）。
 */
const props = defineProps<{ id: string }>();

const router = useRouter();
const playlists = usePlaylistsStore();
const library = useLibraryStore();
const player = usePlayerStore();

/** 歌单是访客级（AC-03），但 `/playlist/:id` 没开 `meta.anonymous` —— 未登录访问会被路由守卫直接送去登录页，
    所以这里不需要“未登录”分支（v6.8 删掉，原先那一段永远看不到）。 */
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
// 封面拼贴取“第一条有封面的那一条”，用**解析后的实时封面**（`entry.cover`）——
// 歌单里存的是加入那一刻的快照，换过封面/删过曲目之后那个 URL 就是 404（v6.13）
const cover = computed(() => entries.value.find((entry) => entry.cover)?.cover ?? null);

const renaming = ref(false);
const picking = ref(false);
const keyword = ref("");
const busy = ref(false);
const actionError = ref("");
const listEl = ref<HTMLOListElement | null>(null);

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

/**
 * PS-04：歌单内排序。
 *
 * 拖动用**指针事件自己实现**（浏览器原生的 HTML5 拖放做不出“行跟手”的观感，
 * 触屏上也基本不可用）：按下把手 → 抓住指针 → 行跟着 `translateY` 走、
 * 越过某行中心线就把它定为落点 → 松手发一次整表替换（服务端那一份顺序是唯一真相）。
 * 排序是管理型操作，但对键盘用户不能没有出路：焦点在把手上时 ↑ ↓ 就能挪一格。
 */
const dragFrom = ref(-1);
const dragTo = ref(-1);
const dragOffset = ref(0);
let dragStartY = 0;
let rowCenters: number[] = [];
let scroller: HTMLElement | null = null;

const dragging = computed(() => dragFrom.value >= 0);

/** 被拖的行往上/往下找第一个能滚的祖先（长歌单不滚就够不着首尾） */
function findScroller(from: HTMLElement): HTMLElement | null {
  let node = from.parentElement;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (/(auto|scroll)/.test(overflowY) && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return null;
}

function startDrag(index: number, event: PointerEvent): void {
  if (busy.value || entries.value.length < 2) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;

  const handle = event.currentTarget as HTMLElement;
  const list = handle.closest(".pl-list");
  if (!list) return;

  // 行高、间距都可能在主题/断点下不同，所以量一次实际几何，不要拿常量算
  rowCenters = [...list.querySelectorAll(".pl-row")].map((row) => {
    const rect = row.getBoundingClientRect();
    return rect.top + rect.height / 2;
  });
  scroller = findScroller(handle);

  handle.setPointerCapture(event.pointerId);
  dragStartY = event.clientY;
  dragFrom.value = index;
  dragTo.value = index;
  dragOffset.value = 0;
}

function moveDrag(event: PointerEvent): void {
  if (!dragging.value) return;
  dragOffset.value = event.clientY - dragStartY;

  // 越过某行的中心线，就把目标定在它之后（拖拽的常规手感）
  let slot = 0;
  for (let i = 0; i < rowCenters.length; i += 1) {
    if (event.clientY > rowCenters[i]) slot = i + 1;
  }
  // slot 是“插在第几条之前”，而它自己还占着一格：往下拖时要减掉自己
  const to = slot > dragFrom.value ? slot - 1 : slot;
  dragTo.value = Math.max(0, Math.min(entries.value.length - 1, to));

  if (!scroller) return;
  const rect = scroller.getBoundingClientRect();
  const edge = 56;
  if (event.clientY < rect.top + edge) scroller.scrollTop -= 14;
  else if (event.clientY > rect.bottom - edge) scroller.scrollTop += 14;
}

/** 松手：位置真变了才发请求（返回失败会走 run 的报错提示，列表保持服务端那一份） */
async function endDrag(): Promise<void> {
  const from = dragFrom.value;
  const to = dragTo.value;
  resetDrag();
  if (from < 0 || from === to) return;
  await run(() => playlists.moveItem(props.id, from, to));
}

function resetDrag(): void {
  dragFrom.value = -1;
  dragTo.value = -1;
  dragOffset.value = 0;
  rowCenters = [];
  scroller = null;
}

/** 键盘排序：焦点在把手上时 ↑ ↓ 挪一格 */
async function nudge(index: number, delta: number): Promise<void> {
  const to = index + delta;
  if (busy.value || to < 0 || to >= entries.value.length) return;

  busy.value = true;
  actionError.value = "";
  try {
    await playlists.moveItem(props.id, index, to);
    await nextTick();
    // 行是按身份键渲染的（Vue 直接搬同一个节点），而**节点被搬动时焦点会丢** ——
    // 不送回的话，键盘用户每挪一格就得重新 Tab 一遍，连按 ↑ ↓ 也就废了
    listEl.value?.querySelectorAll<HTMLElement>(".pl-grip")[to]?.focus();
  } catch (error) {
    actionError.value = playlistErrorMessage(error);
  } finally {
    busy.value = false;
  }
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

/**
 * 导出（PS-06）：在浏览器里生成文件、交给下载，不走服务端（不新增接口与存储）。
 * 地址要用绝对路径：导出的 M3U8 常常是拿到手机/车机上的另一个播放器里去开的。
 */
function downloadText(name: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  // 有些引擎要求链接先入文档才认这次点击；用完顺手收回对象地址（回收放在下一拍，
  // 立刻回收会把还没开始的下载掐掉）
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportM3U8(): void {
  const current = playlist.value;
  if (!current) return;
  downloadText(
    exportFileName(current.name, "m3u8"),
    toM3U8(current.name, entries.value, { origin: location.origin }),
    "audio/x-mpegurl",
  );
}

function exportJson(): void {
  const current = playlist.value;
  if (!current) return;
  downloadText(
    exportFileName(current.name, "json"),
    toExportJson(current, new Date().toISOString()),
    "application/json",
  );
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

    <!-- 页头（封面 / 名称 / 操作）：与其它列表页同一套骨架 —— 钉在帧上不滚，只有下面的曲目滚 -->
    <div v-if="playlist" class="pl-head">
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
        <p v-else class="pl-name" :title="playlist.name">{{ playlist.name }}</p>
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
        <DropdownMenuRoot>
          <DropdownMenuTrigger as-child>
            <button class="btn" :disabled="playlist.items.length === 0">
              <IconDownloadSimple class="icon" />
              导出
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuContent class="pl-menu" side="bottom" align="end" :side-offset="6">
              <DropdownMenuItem class="pl-menu__item" @select="exportM3U8">
                <IconMusicNotes class="icon" />
                <span>
                  M3U8 播放列表
                  <small>别的播放器直接能读</small>
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem class="pl-menu__item" @select="exportJson">
                <IconFileCode class="icon" />
                <span>
                  JSON 备份
                  <small>留着以后还原</small>
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenuRoot>
        <button class="btn btn-danger" :disabled="busy" @click="removePlaylist">
          <IconTrash class="icon" />
          删除
        </button>
      </div>
    </div>

    <p v-if="playlist && actionError" class="pl-error" role="alert">{{ actionError }}</p>

    <!-- 只有列表滚动（与其它列表页同一套骨架）：状态撑满帧并居中，曲目列表才是滚动内容。
         三态齐全（v6.8）：读取中 → 读不出来（带重试）→ 读到了但歌单不在（已删）。
         原先少了前两态，直达本页或后端临时不可用时会剩下一片空白，而且无法自救。 -->
    <div class="page-frame__scroll">
      <EmptyState
        v-if="playlist === null && playlists.status === 'loading'"
        class="page-frame__fill"
        :icon="IconPlaylist"
        title="正在读取…"
        desc="歌单存在服务器上，稍等一下。"
      />

      <div v-else-if="playlist === null && playlists.status === 'error'" class="page-frame__fill">
        <div class="fail card">
          <span class="fail__badge"><IconWarningCircle class="icon" /></span>
          <div class="fail__title">歌单没能读出来</div>
          <p class="fail__desc">{{ playlists.error }}</p>
          <button class="btn btn-primary" @click="playlists.load(true)">重试</button>
        </div>
      </div>

      <EmptyState
        v-else-if="playlist === null"
        class="page-frame__fill"
        :icon="IconPlaylist"
        title="这个歌单不在了"
        desc="可能已经在别处删除。回音乐库或本地播放接着听吧。"
      />

      <template v-else-if="playlist">
        <div v-if="entries.length === 0" class="page-frame__fill">
          <p class="pl-empty">
            这个歌单还是空的。点「添加曲目」从音乐库里挑，或把当前播放列表整体加进来。
          </p>
        </div>

        <ol v-else ref="listEl" class="pl-list" :class="{ 'is-dragging': dragging }">
          <li
            v-for="(entry, index) in entries"
            :key="entry.key"
            class="pl-row"
            :class="{
              'is-missing': !entry.track,
              'is-dragging': dragFrom === index,
              'is-drop-line': dragging && dragFrom !== dragTo && dragTo === index,
            }"
            :style="dragFrom === index ? { '--drag-offset': `${dragOffset}px` } : undefined"
          >
            <!-- 序号格就是拖拽把手（不另占一列，也不和行里的播放按钮抢点击）：
               hover / 键盘聚焦时数字换成把手图标，触屏直接显示把手 -->
            <AppTooltip :label="`拖动排序：${entry.title}（也可用 ↑ ↓）`">
              <button
                class="pl-grip"
                :class="{ 'is-active': dragFrom === index }"
                :disabled="entries.length < 2"
                :aria-label="`拖动排序 ${entry.title}，共 ${entries.length} 首，当前第 ${index + 1} 首`"
                @pointerdown="startDrag(index, $event)"
                @pointermove="moveDrag"
                @pointerup="endDrag"
                @pointercancel="resetDrag"
                @keydown.up.prevent="nudge(index, -1)"
                @keydown.down.prevent="nudge(index, 1)"
              >
                <span class="pl-grip__num">{{ index + 1 }}</span>
                <IconDotsSixVertical class="icon pl-grip__icon" />
              </button>
            </AppTooltip>

            <button
              class="pl-main"
              :disabled="!entry.track"
              :title="entry.track ? `播放 ${entry.title}` : entry.reason"
              @click="playFrom(entry)"
            >
              <span class="pl-art">
                <img v-if="entry.cover" :src="entry.cover" alt="" />
                <IconPlaylist v-else class="icon" />
              </span>
              <span class="pl-text">
                <b>{{ entry.title }}</b>
                <small>{{ entry.track ? entry.artist : entry.reason }}</small>
              </span>
              <span class="pl-time">{{ formatTime(entry.item.duration ?? null) }}</span>
            </button>

            <AppTooltip :label="`把《${entry.title}》移出歌单`">
              <button class="pl-remove" :disabled="busy" @click="removeEntry(entry)">
                <IconX class="icon" />
              </button>
            </AppTooltip>
          </li>
        </ol>
      </template>
    </div>

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
  /* `flex: 1` 等于 `1 1 0%`：基准宽度为 0，按钮组一挤就把这一块压成 0 宽 ——
     歌单名于是“一个字一行”竖着排（实测 818px 下“tmp-骨架验证”就是竖的）。
     所以基准要取内容宽度（auto），并留一个保底宽度：宁可让按钮组内部换行，
     也不要让这一块消失。 */
  flex: 1 1 auto;
  min-width: 140px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pl-name {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-1);
  /* 页头是钉住的（不跟着列表滚），高度必须稳定：过长的歌单名截断，不要换成多行 */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

/* 窄屏：四个按钮挤在同一行会把曲目名压成一字一行（实测 390px 下“排序实测”是竖着的），
   所以让按钮整组换到第二行，封面与名称留在第一行 */
@media (max-width: 640px) {
  .pl-head {
    flex-wrap: wrap;
  }

  .pl-actions {
    flex-basis: 100%;
    justify-content: flex-start;
  }
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
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-right: 8px;
  border-radius: var(--radius-row);
}

/* 拖拽中：不选文字（行跟着指针跑的时候会把歌名选上），也不给悬浮底色干扰 */
.pl-list.is-dragging {
  user-select: none;
}

/* 跟手的那一行：抬起来（只动 transform / opacity，不动模糊相关属性）。
   底色必须是**不透明**的：`--hover` 那类半透明色会让下面那一行透上来，
   看起来就是两行字叠在一起（实测截图里“光辉岁月”就是这么糊掉的）。 */
.pl-row.is-dragging {
  z-index: 2;
  /* 底必须**不透明**：透的话被盖住的那一行会从下面浮上来，看着就是两行字叠在一起。
     `--plane` 本身就是实心面板色（#fff / #232326），直接用即可。 */
  background: var(--plane);
  box-shadow: var(--card-shadow);
  transform: translateY(var(--drag-offset, 0px));
}

/* 落点提示：画在“它即将占据的那一行”的上沿，颜色只表达状态（简约优先） */
.pl-row.is-drop-line::before {
  content: "";
  position: absolute;
  left: 8px;
  right: 8px;
  top: -3px;
  height: 2px;
  border-radius: 1px;
  background: var(--accent);
}

/* 跟手那一行自己也满足 :hover（指针就在它上面），而两条规则特异性相同、这条在后面 ——
   不加 :not() 的话悬浮底色会盖掉拖拽态的不透明底，被盖住的行就透上来了（实测）。 */
.pl-row:hover:not(.is-dragging) {
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
  grid-template-columns: 40px minmax(0, 1fr) 56px;
  padding: 10px 4px 10px 0;
  text-align: left;
}

.pl-main:disabled {
  cursor: default;
}

/* 序号格兼拖拽把手：默认显示序号，hover / 键盘聚焦 / 触屏时显示把手图标 */
.pl-grip {
  display: grid;
  place-items: center;
  flex: none;
  width: 24px;
  height: 30px;
  border-radius: var(--radius-control);
  color: var(--text-3);
  cursor: grab;
  /* 触屏上拖把手不能变成滚动页面 */
  touch-action: none;
}

.pl-grip:disabled {
  cursor: default;
}

.pl-grip__num {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.pl-grip__icon {
  display: none;
  width: 16px;
  height: 16px;
}

.pl-grip:hover:not(:disabled),
.pl-grip:focus-visible {
  background: var(--hover);
  color: var(--text-1);
}

.pl-grip:hover:not(:disabled) .pl-grip__num,
.pl-grip:focus-visible .pl-grip__num,
.pl-grip.is-active .pl-grip__num {
  display: none;
}

.pl-grip:hover:not(:disabled) .pl-grip__icon,
.pl-grip:focus-visible .pl-grip__icon,
.pl-grip.is-active .pl-grip__icon {
  display: block;
}

.pl-grip:active {
  cursor: grabbing;
}

@media (hover: none) {
  /* 触屏没有 hover：直接把把手显出来，不然无从下手 */
  .pl-grip__num {
    display: none;
  }

  .pl-grip__icon {
    display: block;
  }
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

/* 导出（PS-06）：材质取“大面”那一档（--tray-*）。
   菜单是开在**成片正文**（列表行）上的，`--panel-*` 那一档只有 0.46/0.52 的遮盖度，
   在模糊不参与合成的环境里两层字会叠成一片（v5.53 的确认框同理）。
   ⚠️ 这里**故意不加** `force-mount`：菜单不需要退场动画，关上就卸载 ——
   而带定位的浮层一旦常驻，Reka 的包装层（[data-reka-popper-content-wrapper]）
   会留一块隐形的命中区吞掉后面的点击（v5.62 实测踩过）；实测关掉菜单后
   `elementFromPoint` 命中的仍是底下那个按钮。 */
.pl-menu {
  z-index: 92;
  min-width: 212px;
  padding: 6px;
  border-radius: var(--radius-panel);
  border: 1px solid var(--glass-border);
  background: var(--tray-bg);
  backdrop-filter: var(--tray-blur);
  -webkit-backdrop-filter: var(--tray-blur);
  box-shadow: var(--panel-sheen), var(--panel-shadow);
  animation: pl-pop-in 0.16s var(--ease-ios);
}

.pl-menu__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-control);
  font-size: 13px;
  color: var(--text-1);
  cursor: pointer;
  outline: none;
}

.pl-menu__item[data-highlighted] {
  background: var(--hover);
}

.pl-menu__item .icon {
  flex: none;
  width: 16px;
  height: 16px;
  color: var(--text-3);
}

.pl-menu__item small {
  display: block;
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--text-3);
}
</style>
