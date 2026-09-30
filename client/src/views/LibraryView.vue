<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import IconArrowsClockwise from "~icons/ph/arrows-clockwise";
import IconMagnifyingGlass from "~icons/ph/magnifying-glass";
import IconMusicNotes from "~icons/ph/music-notes";
import IconWarningCircle from "~icons/ph/warning-circle";
import EmptyState from "@/components/EmptyState.vue";
import TrackRow from "@/components/TrackRow.vue";
import { useAuthStore } from "@/stores/auth";
import { useLibraryStore } from "@/stores/library";
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
const player = usePlayerStore();
const keyword = ref("");

onMounted(() => void library.load());

const tracks = computed(() => filterSongs(library.songs, keyword.value).map(songToTrack));
const isSearching = computed(() => keyword.value.trim().length > 0);
const summary = computed(() => `云端曲库 · ${library.songs.length} 首 · ${formatSize(library.totalSize)}`);
const showEmptyState = computed(() => library.status === "ready" && library.songs.length === 0);
const showErrorPanel = computed(() => library.status === "error" && library.songs.length === 0);

function playAt(index: number): void {
  const target = tracks.value[index];
  if (!target) return;
  if (target.id === player.currentTrack?.id) {
    player.toggle();
    return;
  }
  player.clear();
  player.addTracks(tracks.value);
  player.playAt(index);
}
</script>

<template>
  <section>
    <div class="page-head">
      <h1>
        音乐库
        <div class="sub">{{ summary }}</div>
      </h1>
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

    <p v-if="library.status === 'loading' && library.songs.length === 0" class="note">正在读取曲库…</p>

    <div v-else-if="showErrorPanel" class="fail card">
      <span class="fail__badge"><IconWarningCircle class="icon" /></span>
      <div class="fail__title">曲库没能读出来</div>
      <p class="fail__desc">{{ library.error }}</p>
      <button class="btn btn-primary" @click="library.load(true)">重试</button>
    </div>

    <EmptyState
      v-else-if="showEmptyState"
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

    <template v-else>
      <!-- 刷新失败但手上还有列表：保留列表，只在上面给一条提示（不要白屏） -->
      <div v-if="library.status === 'error'" class="strip">
        <IconWarningCircle class="icon" />
        <span>{{ library.error }}</span>
        <button class="btn btn-quiet" @click="library.load(true)">重试</button>
      </div>

      <div class="toolbar">
        <label class="search">
          <IconMagnifyingGlass class="icon" />
          <input v-model="keyword" type="search" placeholder="搜索歌名、歌手或专辑" />
        </label>
        <span class="toolbar__spacer count">
          {{ isSearching ? `找到 ${tracks.length} 首` : `共 ${library.songs.length} 首` }}
        </span>
      </div>

      <p v-if="isSearching && tracks.length === 0" class="note">没有匹配的歌曲，换个关键词试试。</p>

      <div v-else class="library">
        <TrackRow
          v-for="(track, index) in tracks"
          :key="track.id"
          :track="track"
          :index="index"
          :active="player.currentTrack?.id === track.id"
          :playing="player.playing"
          :removable="false"
          @play="playAt"
        />
      </div>
    </template>
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

/* 读不出来时的整块提示：说清原因 + 给一个重试入口，不要只留一片空白 */
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

/* 列表仍在时的轻提示条 */
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

.library {
  max-width: 1080px;
}
</style>

