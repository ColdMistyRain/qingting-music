<script setup lang="ts">
import NavToggle from "@/components/NavToggle.vue";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { toPlaylistItem, type Track } from "@qingting/shared";
import IconArrowsClockwise from "~icons/ph/arrows-clockwise";
import IconArrowLeft from "~icons/ph/arrow-left";
import IconListBullets from "~icons/ph/list-bullets";
import IconMagnifyingGlass from "~icons/ph/magnifying-glass";
import IconMusicNotes from "~icons/ph/music-notes";
import IconSquaresFour from "~icons/ph/squares-four";
import IconWarningCircle from "~icons/ph/warning-circle";
import EmptyState from "@/components/EmptyState.vue";
import TrackList from "@/components/TrackList.vue";
import TrackListHead from "@/components/TrackListHead.vue";
import { useAuthStore } from "@/stores/auth";
import { useLibraryStore } from "@/stores/library";
import { useListeningStore } from "@/stores/listening";
import { usePlayerStore } from "@/stores/player";
import { formatSize } from "@/utils/format";
import { debounce } from "@/utils/debounce";
import { filterSongs, groupAlbums, songToTrackCached } from "@/utils/library";

/**
 * 音乐库（PRD 3.4 / LB-04）：登录用户都能浏览与播放，上传与删除在控制台（3.12）。
 * 关键词过滤是本地纯函数（LB-07）；点播时把"当前搜索结果"整段作为播放队列，
 * 这样"下一首"符合眼前看到的顺序。
 */
const auth = useAuthStore();
const library = useLibraryStore();
const listening = useListeningStore();
const player = usePlayerStore();
const keyword = ref("");
/* 关键词拆两份（v6.9）：`keyword` 绑输入框（**即时回显**，不防抖免得光标乱跳），
   `query` 才是过滤用的那一份（停 150ms 才跟上）。369 首每次按键都要全量 filter + map，
   连打几个字就是几十毫秒的主线程工作。 */
const query = ref("");
const applyQuery = debounce((value: string) => {
  query.value = value;
}, 150);
watch(keyword, (value) => applyQuery.call(value));

onMounted(() => {
  void library.load();
  // 行尾那枚收藏键要知道“收没收藏”，而收藏数据在服务端（PS-05）
  void listening.load();
});

onBeforeUnmount(() => applyQuery.cancel());

const tracks = computed(() => filterSongs(library.songs, query.value).map(songToTrackCached));
const isSearching = computed(() => query.value.trim().length > 0);

/** 视图模式（VS-06 专辑网格）：list = 曲目列表（默认），albums = 专辑网格 */
const viewMode = ref<"list" | "albums">("list");
/** 专辑模式下点选中的专辑：进入"这张专辑"的曲目视图 */
const selectedAlbumKey = ref<string | null>(null);

const albums = computed(() => groupAlbums(library.songs));
const selectedAlbum = computed(
  () => albums.value.find((g) => g.key === selectedAlbumKey.value) ?? null,
);
/** 专辑详情态（页头换标题、正文换曲目列表） */
const albumDetail = computed(() => selectedAlbum.value !== null);
/** 专辑详情视图的曲目（选中专辑 → 该专辑全部曲目；搜索词同样过滤专辑内） */
const albumTracks = computed(() =>
  selectedAlbum.value
    ? filterSongs(selectedAlbum.value.tracks, query.value).map(songToTrackCached)
    : [],
);

/** 当前列表该显示哪份曲目（v6.51 修：详情态此前没接到列表分支上，点卡片只换了页头）：
    专辑详情 = 这张专辑，否则 = 全库。点播/收藏/计数都用它 —— "眼前这段整份当队列"。 */
const displayTracks = computed(() => (albumDetail.value ? albumTracks.value : tracks.value));

function openAlbum(key: string): void {
  selectedAlbumKey.value = key;
}
function closeAlbum(): void {
  selectedAlbumKey.value = null;
}
function setViewMode(mode: "list" | "albums"): void {
  viewMode.value = mode;
  // 切视图一律退出专辑详情（回到该视图的顶层：列表或全部专辑网格）
  closeAlbum();
}

const pageTitle = computed(() =>
  albumDetail.value ? (selectedAlbum.value?.name ?? "专辑") : "音乐库",
);
const pageSubtitle = computed(() => {
  if (albumDetail.value && selectedAlbum.value) {
    return `专辑 · ${selectedAlbum.value.tracks.length} 首 · ${selectedAlbum.value.artist}`;
  }
  return summary.value;
});
const summary = computed(
  () => `云端曲库 · ${library.songs.length} 首 · ${formatSize(library.totalSize)}`,
);
const showEmptyState = computed(() => library.status === "ready" && library.songs.length === 0);
const showErrorPanel = computed(() => library.status === "error" && library.songs.length === 0);

function playAt(index: number): void {
  // 队列 = 眼前这段（专辑详情下就是这张专辑）
  const target = displayTracks.value[index];
  if (!target) return;
  player.clear();
  player.addTracks(displayTracks.value);
  player.playAt(index);
}

/* 行尾那枚收藏键（v5.96）：列表行不再放播放/暂停键之后，“最右那列”放的是**对这首歌的动作**
   —— 音乐库这一档只有收藏（删除在控制台，LB-05）。行只给“收没收藏”，存取全在 store。 */
function isFavorite(track: Track): boolean {
  return listening.isFavorite(toPlaylistItem(track));
}

function toggleFavorite(index: number): void {
  // index 对应眼前这段列表（专辑详情下就是这张专辑）
  const target = displayTracks.value[index];
  if (target) void listening.toggleFavorite(toPlaylistItem(target));
}
</script>

<template>
  <section class="page-frame">
    <div class="page-head">
      <div class="page-head__title">
        <NavToggle />
        <h1>{{ pageTitle }}</h1>
        <div class="sub">{{ pageSubtitle }}</div>
      </div>
      <button v-if="albumDetail" class="btn" @click="closeAlbum">
        <IconArrowLeft class="icon" />
        全部专辑
      </button>
      <button
        v-if="library.songs.length > 0 || library.status === 'error'"
        class="btn"
        :disabled="library.status === 'loading'"
        @click="library.load(true)"
      >
        <IconArrowsClockwise class="icon" />
        刷新
      </button>
    </div>

    <!-- 刷新失败但手上还有列表：保留列表，只在上面给一条提示（不要白屏） -->
    <div v-if="library.status === 'error' && library.songs.length > 0" class="strip">
      <IconWarningCircle class="icon" />
      <span>{{ library.error }}</span>
      <button class="btn btn-quiet" @click="library.load(true)">重试</button>
    </div>

    <!-- 收藏状态没读出来（v6.11）：行尾那些心这时**全是假的**（一律显示未收藏），
         而它们看着就像“这首歌没收藏过”——与其静默撒谎，不如明说并给重试 -->
    <div v-if="listening.status === 'error'" class="strip">
      <IconWarningCircle class="icon" />
      <span>收藏状态没读出来，行尾的收藏键暂时不准</span>
      <button class="btn btn-quiet" @click="listening.load(true)">重试</button>
    </div>

    <div v-if="library.songs.length > 0" class="toolbar">
      <label class="search">
        <IconMagnifyingGlass class="icon" />
        <input v-model="keyword" type="search" placeholder="搜索歌名、歌手或专辑" />
      </label>
      <!-- 视图切换（VS-06 专辑网格）：列表 / 专辑 -->
      <div class="view-toggle" role="group" aria-label="视图">
        <button
          type="button"
          :class="{ active: viewMode === 'list' }"
          title="列表视图"
          @click="setViewMode('list')"
        >
          <IconListBullets class="icon" />
        </button>
        <button
          type="button"
          :class="{ active: viewMode === 'albums' }"
          title="专辑网格"
          @click="setViewMode('albums')"
        >
          <IconSquaresFour class="icon" />
        </button>
      </div>
      <!-- 总数只在**页头**说一次（v5.97）：这里只负责**筛选结果**，没搜就不说 -->
      <span v-if="isSearching" class="toolbar__spacer count">找到 {{ displayTracks.length }} 首</span>
    </div>

    <!-- 表头 = “说明”：放在滚动区外面（固定层），所以既不用吸顶、也不用底色，
         标签常驻而列表在它下面滚（v4.41）；专辑网格模式下没有表头（网格即说明），
         专辑详情态有表头（它就是一份曲目列表，v6.51） -->
    <TrackListHead
      v-if="(viewMode === 'list' || albumDetail) && displayTracks.length > 0"
    />

    <!-- 只有列表滚动：页头与工具条固定在上部（方案 A） -->
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
          :icon="IconMusicNotes"
          title="音乐库还是空的"
          desc="上传的音乐会出现在这里，可以搜索、排序、播放。"
          fill
        >
          <RouterLink v-if="auth.isAdmin" class="btn btn-primary" :to="{ name: 'console-upload' }">
            去管理台上传音乐
          </RouterLink>
          <p v-else class="hint">等管理员上传后，这里就会出现曲库列表。</p>
        </EmptyState>
      </div>

      <p v-else-if="isSearching && displayTracks.length === 0" class="note">
        没有匹配的歌曲，换个关键词试试。
      </p>

      <!-- 专辑网格（VS-06）：封面卡 + 专辑名 + 歌手 + 曲目数；点卡片进该专辑曲目。
           详情态（v6.51 修）不再渲染网格 —— 此前点卡片只换了页头、正文还是网格 -->
      <div
        v-else-if="viewMode === 'albums' && !albumDetail"
        class="album-grid"
      >
        <button v-for="group in albums" :key="group.key" class="album-card" @click="openAlbum(group.key)">
          <img v-if="group.cover" class="album-card__cover" :src="group.cover" alt="" />
          <span v-else class="album-card__cover album-card__cover--ph">
            <IconMusicNotes class="icon" />
          </span>
          <span class="album-card__name" :title="group.name">{{ group.name }}</span>
          <span class="album-card__meta">{{ group.artist }} · {{ group.tracks.length }} 首</span>
        </button>
      </div>

      <TrackList
        v-else
        :tracks="displayTracks"
        :active-id="player.currentTrack?.id ?? null"
        :removable="false"
        show-favorite
        :favorite-of="isFavorite"
        @play="playAt"
        @toggle-favorite="toggleFavorite"
      />
    </div>
  </section>
</template>

<style scoped>
/* 视图切换（VS-06）：两枚小图标钮，亮 = 当前视图 */
.view-toggle {
  display: flex;
  gap: 4px;
}

.view-toggle button {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 7px;
  border: 1px solid transparent;
  background: none;
  color: var(--text-3);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}

.view-toggle button:hover {
  color: var(--text-1);
}

.view-toggle button.active {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 45%, transparent);
}

/* 专辑网格（VS-06）：封面卡栅格 */
.album-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
  gap: 18px;
  padding-bottom: 24px;
}

.album-card {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  padding: 0;
  border: none;
  background: none;
  text-align: left;
  cursor: pointer;
}

.album-card__cover {
  width: 100%;
  aspect-ratio: 1;
  border-radius: var(--radius-panel);
  object-fit: cover;
  display: block;
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.18);
}

.album-card__cover--ph {
  display: grid;
  place-items: center;
  color: var(--text-3);
  background: var(--glass-bg);
}

.album-card__cover--ph .icon {
  width: 34px;
  height: 34px;
}

.album-card__name {
  font-size: 13px;
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.album-card__meta {
  font-size: 11.5px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.note {
  padding: 24px 0;
  text-align: center;
  font-size: 12.5px;
  color: var(--text-3);
}

.hint {
  font-size: 12.5px;
  color: var(--text-3);
}

.count {
  font-size: 12px;
  color: var(--text-3);
}
</style>
