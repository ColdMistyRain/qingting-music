<script setup lang="ts">
import NavToggle from "@/components/NavToggle.vue";
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { toPlaylistItem, type Track } from "@qingting/shared";
import IconArrowsClockwise from "~icons/ph/arrows-clockwise";
import IconMagnifyingGlass from "~icons/ph/magnifying-glass";
import IconMusicNotes from "~icons/ph/music-notes";
import IconWarningCircle from "~icons/ph/warning-circle";
import EmptyState from "@/components/EmptyState.vue";
import TrackList from "@/components/TrackList.vue";
import TrackListHead from "@/components/TrackListHead.vue";
import { useAuthStore } from "@/stores/auth";
import { useLibraryStore } from "@/stores/library";
import { useListeningStore } from "@/stores/listening";
import { usePlayerStore } from "@/stores/player";
import { formatSize } from "@/utils/format";
import { filterSongs, songToTrack } from "@/utils/library";

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

onMounted(() => {
  void library.load();
  // 行尾那枚收藏键要知道“收没收藏”，而收藏数据在服务端（PS-05）
  void listening.load();
});

const tracks = computed(() => filterSongs(library.songs, keyword.value).map(songToTrack));
const isSearching = computed(() => keyword.value.trim().length > 0);
const summary = computed(
  () => `云端曲库 · ${library.songs.length} 首 · ${formatSize(library.totalSize)}`,
);
const showEmptyState = computed(() => library.status === "ready" && library.songs.length === 0);
const showErrorPanel = computed(() => library.status === "error" && library.songs.length === 0);

function playAt(index: number): void {
  const target = tracks.value[index];
  if (!target) return;
  player.clear();
  player.addTracks(tracks.value);
  player.playAt(index);
}

/* 行尾那枚收藏键（v5.96）：列表行不再放播放/暂停键之后，“最右那列”放的是**对这首歌的动作**
   —— 音乐库这一档只有收藏（删除在控制台，LB-05）。行只给“收没收藏”，存取全在 store。 */
function isFavorite(track: Track): boolean {
  return listening.isFavorite(toPlaylistItem(track));
}

function toggleFavorite(index: number): void {
  const target = tracks.value[index];
  if (target) void listening.toggleFavorite(toPlaylistItem(target));
}
</script>

<template>
  <section class="page-frame">
    <div class="page-head">
      <div class="page-head__title">
        <NavToggle />
        <h1>音乐库</h1>
        <div class="sub">{{ summary }}</div>
      </div>
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

    <div v-if="library.songs.length > 0" class="toolbar">
      <label class="search">
        <IconMagnifyingGlass class="icon" />
        <input v-model="keyword" type="search" placeholder="搜索歌名、歌手或专辑" />
      </label>
      <!-- 总数只在**页头**说一次（v5.97）：这里原先不搜也报一遍“共 N 首”，
           与页头的“云端曲库 · 14 首”完全重复。这个位置只负责**筛选结果**，没搜就不说。 -->
      <span v-if="isSearching" class="toolbar__spacer count">找到 {{ tracks.length }} 首</span>
    </div>

    <!-- 表头 = “说明”：放在滚动区外面（固定层），所以既不用吸顶、也不用底色，
         标签常驻而列表在它下面滚（v4.41） -->
    <TrackListHead v-if="tracks.length > 0" />

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

      <p v-else-if="isSearching && tracks.length === 0" class="note">
        没有匹配的歌曲，换个关键词试试。
      </p>

      <TrackList
        v-else
        :tracks="tracks"
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
