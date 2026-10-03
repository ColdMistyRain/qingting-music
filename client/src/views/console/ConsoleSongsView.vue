<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import type { Song } from "@qingting/shared";
import IconListDashes from "~icons/ph/list-dashes";
import IconMagnifyingGlass from "~icons/ph/magnifying-glass";
import IconPencilSimple from "~icons/ph/pencil-simple";
import IconSortAscending from "~icons/ph/sort-ascending";
import IconSortDescending from "~icons/ph/sort-descending";
import IconTrash from "~icons/ph/trash";
import IconWarningCircle from "~icons/ph/warning-circle";
import AppTooltip from "@/components/AppTooltip.vue";
import EmptyState from "@/components/EmptyState.vue";
import SongMetaDialog from "@/components/SongMetaDialog.vue";
import AppSelect from "@/components/AppSelect.vue";
import { useVirtualList } from "@/composables/useVirtualList";
import { useLibraryStore } from "@/stores/library";
import { confirmAction } from "@/utils/confirm";
import { debounce } from "@/utils/debounce";
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
/* 关键词拆两份（v6.9）：输入框读 `keyword`（即时回显），表格读 `query`（停 150ms 才跟上）。
   这里比音乐库更值得防抖：每次按键都要把过滤结果整份**中文排序**
   （`localeCompare(…, "zh-Hans-CN")`，369 首 ≈ 3100 次 ICU 比较）。 */
const query = ref("");
const applyQuery = debounce((value: string) => {
  query.value = value;
}, 150);
watch(keyword, (value) => applyQuery.call(value));
onBeforeUnmount(() => applyQuery.cancel());
const sortKey = ref<SongSortKey>("uploadedAt");
/** 下拉里显示的那份（带“按”字）：`SORT_OPTIONS` 本体还要给排序逻辑用，不动它 */
const sortOptions = computed(() =>
  SORT_OPTIONS.map((option) => ({ value: option.value, label: `按${option.label}` })),
);
const direction = ref<SortDirection>("desc");
const selected = ref<Set<string>>(new Set());
const busy = ref(false);
const actionError = ref("");

const rows = computed(() =>
  sortSongs(filterSongs(library.songs, query.value), sortKey.value, direction.value),
);

/**
 * 长列表虚拟滚动（LB-08，v6.27）：这一页没有独立的列表容器 —— 曲目行就是滚动区的
 * 直接子元素，所以把滚动区自己当列表（垫片插在它里面，列表顶自然在滚动原点）。
 * 排序与过滤仍在这份**全量数据**上做（LB-04 / LB-07），只是渲染收窄到看得见的那几行。
 */
const scrollerEl = ref<HTMLElement | null>(null);
const { start, end, padTop, padBottom } = useVirtualList({
  list: scrollerEl,
  rowSelector: ".sg",
  count: () => rows.value.length,
});
/** 交给模板的是窗口里那一段；行还是原来那些行（选中态按 id 认，与下标无关） */
const windowRows = computed(() => rows.value.slice(start.value, end.value));

/** 结果数只在“确实在筛”时才报（v5.97）：没筛时它就等于页头那个总数，没必要说两遍 */
const isFiltering = computed(() => query.value.trim().length > 0);

/** 正在编辑的那一条（AD-02）：弹窗由两个入口共用，这里只管“编辑哪首” */
const editing = ref<Song | null>(null);
const metaOpen = ref(false);

function startEdit(song: Song): void {
  editing.value = song;
  metaOpen.value = true;
}

/** 保存成功：就地换掉列表里那一条，并在队列里同步（曲目可能正在唱） */
function onMetaSaved(song: Song, assets: { lyrics?: string }): void {
  library.applyUpdated(song, assets);
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

      <!-- 外面这层 div 只为给宿主样式一个落点：`SelectRoot` 自己**不渲染包装元素**
           （组件根是 fragment，透传的 class 会被丢掉），所以不能把 class 写在组件上。 -->
      <div class="sort">
        <AppSelect v-model="sortKey" :options="sortOptions" label="排序方式" />
      </div>
      <!-- 只有图标的键按约定走 AppTooltip（label 同时是 aria-label）——v6.10 从原生 title 收口 -->
      <AppTooltip :label="direction === 'asc' ? '升序（点击改为降序）' : '降序（点击改为升序）'">
        <button class="ctl" @click="toggleDirection">
          <IconSortAscending v-if="direction === 'asc'" class="icon" />
          <IconSortDescending v-else class="icon" />
        </button>
      </AppTooltip>

      <!-- 与音乐库同一条规则（v5.97）：总数在页头说过了，这里只在**筛选后**报结果数。
           元素常驻（空着也占位）—— 右边那枚批量删除按钮靠它的 `margin-left: auto` 贴边。 -->
      <span class="toolbar__spacer count">{{ isFiltering ? `找到 ${rows.length} 首` : "" }}</span>

      <button class="btn btn-danger" :disabled="selectedCount === 0" @click="askRemoveSelected">
        <IconTrash class="icon" />
        批量删除{{ selectedCount > 0 ? `（${selectedCount}）` : "" }}
      </button>
    </div>

    <!-- 加载 / 失败 / 空态：撑满页框并居中（与页框同级，不放进卡里） -->
    <div v-if="library.status === 'loading' && library.songs.length === 0" class="page-frame__fill">
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
        <RouterLink class="btn btn-primary" :to="{ name: 'console-upload' }">去上传音乐</RouterLink>
      </EmptyState>
    </div>

    <!-- 表格（方案 A）：卡就是这张“表” —— 表头钉在卡顶、只有行滚（v5.79）。
         滚动区**放进卡里**而不是把表头挪到卡外：两者因此共享卡的同一套内边距，天然对齐。 -->
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

      <div ref="scrollerEl" class="page-frame__scroll">
        <div
          v-if="padTop > 0"
          class="row-pad"
          :style="{ height: `${padTop}px` }"
          aria-hidden="true"
        />
        <p v-if="rows.length === 0" class="note">没有匹配的歌曲，换个关键词试试。</p>

        <div v-for="song in windowRows" :key="song.id" class="sg">
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
            <AppTooltip label="编辑曲目信息">
              <button class="ctl" :disabled="busy" @click="startEdit(song)">
                <IconPencilSimple class="icon" />
              </button>
            </AppTooltip>
            <AppTooltip label="删除这首歌">
              <button class="ctl" :disabled="busy" @click="askRemoveOne(song.id, song.title)">
                <IconTrash class="icon" />
              </button>
            </AppTooltip>
          </div>
        </div>

        <div
          v-if="padBottom > 0"
          class="row-pad"
          :style="{ height: `${padBottom}px` }"
          aria-hidden="true"
        />
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

.sort :deep(.as-trigger) {
  /* 工具栏那一档（与旁边的搜索框同高）：下拉触发器默认是卡片内控件那一档，
     在工具栏里要跟着邻居走 —— 宿主差异由宿主给（v6.25，同时把原来的原生 `<select>`
     换成共用的 `AppSelect`：原生弹层是系统画的、样式管不到）。 */
  min-width: 132px;
  background: var(--glass-bg-strong);
  color: var(--text-2);
  font-size: 12.5px;
}

.songs {
  padding: 6px 10px 10px;
  /* 行间距跟着“宽/窄”换档（v4.91，与曲目列表同一套口径）：
     宽屏 gap 为 0（细线正落在行的上沿），窄屏（列收起）改由间距承担。 */
  display: flex;
  flex-direction: column;
  gap: 0;
  /* 有内容时卡自己撑满页框剩下的高度 —— 卡里的滚动区才有确定高度可滚（v5.79） */
  flex: 1;
  min-height: 0;
  /* 撤掉全局“页框直接子元素让出滚动条宽度”的补偿（那条是为“滚动区当页框直接子元素”写的）：
     滚动条现在在卡里，卡再让一次就会左右不对称；改由表头自己让（见下）。 */
  margin-right: 0;
}

/* 卡里的滚动区（v5.79）：只有行滚，表头钉在卡顶。
   全局那条“负边距铺到岛边”也是为“滚动区当页框直接子元素”写的，放进卡里要撤掉，
   否则滚动区左右各溢出卡边 20px。 */
.songs > .page-frame__scroll {
  margin-inline: 0;
  padding-inline: 0;
  min-height: 0;
}

/* 表头**不再**需要让出滚动条宽度（v6.21 拆掉这条补偿）：
   它当初是为了补“滚动条占位”——滚动条在卡里把行挤窄，而表头在滚动区外不会跟着窄。
   换成浮层滚动条后滚动条不再占位（实测 `reserved` = 0），再减 10px 反而让表头比行窄一格：
   实测表头「大小 / 上传时间 / 操作」的 left 比行里对应列**偏左 10px**（1057 vs 1067）。
   教训与 v6.18 记的那三处一致：补偿要跟它要补的那个东西一起拆 ——
   这一处在视图文件里，当时扫的只是全局样式，漏了。 */

@media (max-width: 1024px) {
  .songs {
    gap: var(--row-list-gap);
  }

  /* 窄屏不画行间细线，分隔交给间距 —— 但间距必须加在**行与行之间**：
     v5.80 把滚动区移进卡之后，行住在 `.page-frame__scroll` 里，`.songs` 的 gap
     只分开「表头 / 滚动区」两段，行与行反而贴在一起了（实测行距恒 64px，线又被
     `display: none` 掉 → 一整列行没有分隔）。 */
  .songs > .page-frame__scroll {
    display: flex;
    flex-direction: column;
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
  /* 与曲目列表表头同一规则：**不吸顶、不加底色** —— 它现在在滚动区**外面**（卡里的第一个孩子，
     只有下面的行滚），所以不用不透明底去盖从下面经过的行。
     （v5.79 之前它与行一起在滚动区里，于是跟着一起滚 —— 那是 bug，不是“跟随头部”。）
     高度：**必须显式关掉 `.sg` 的 `min-height: 64px`** —— `min-height` 压得住 `height`，
     只写 height 的话表头实际还是 64px（和数据行一样高，只是标签居中，看着就是一大块空）。
     34px 与曲目列表的 `.list-head` 同高（说明行是同一档：11.5px 标签、不加底色）。 */
  min-height: 0;
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

/* 表头最后一格是空占位。它必须与行里“两个图标键 + 6px 间距”同宽 ——
   否则那一列在行里是 48px、在表头里是 0，`minmax(0, 1fr)` 的曲目列就会多吞 48px，
   表头的「大小 / 上传时间」整体右移 48px（v5.79 实测：行 436 / 表头 484）。
   宽度从图标尺寸令牌派生，键尺寸变了这里跟着变。 */
.sg--head > :last-child {
  width: calc(var(--ctl-icon-size, 21px) * 2 + 6px);
}

.sg__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: flex-end;
}
</style>
