<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import IconHeartStraight from "~icons/ph/heart-straight";
import IconPlay from "~icons/ph/play";
import IconTrash from "~icons/ph/trash";
import { playlistItemKey, type PlaylistItem, type Track } from "@qingting/shared";
import EmptyState from "@/components/EmptyState.vue";
import NavToggle from "@/components/NavToggle.vue";
import SegmentedControl from "@/components/SegmentedControl.vue";
import TrackListHead from "@/components/TrackListHead.vue";
import TrackRow from "@/components/TrackRow.vue";
import { useLibraryStore } from "@/stores/library";
import { useListeningStore } from "@/stores/listening";
import { usePlayerStore } from "@/stores/player";
import { confirmAction } from "@/utils/confirm";
import { songToTrack } from "@/utils/library";

/**
 * 我的音乐（PS-05）：收藏 / 最近播放两个页签。
 *
 * 数据在服务器端（`data/listening.json`）—— 收藏与播放记录跟着服务器走，
 * 不跟着某个浏览器走（手机上收藏的、电脑上看得见）。
 *
 * 列表行复用 `TrackRow`（与音乐库同一套行视觉），多一枚收藏键：收藏页里要能取消收藏，
 * 最近播放里也要能顺手收下。**只列现在还能播的**（云端引用要能在曲库里对上），
 * 对不上的那些不静默消失 —— 下面用一行小字说清楚有几首、为什么。
 */
const listening = useListeningStore();
const library = useLibraryStore();
const player = usePlayerStore();

const tab = ref<"favorites" | "recent">("favorites");
const busy = ref(false);

const TAB_OPTIONS = [
  { value: "favorites", label: "收藏" },
  { value: "recent", label: "最近播放" },
];

const items = computed<readonly PlaylistItem[]>(() =>
  tab.value === "favorites" ? listening.favorites : listening.recent,
);

/** 能播的那些：云端引用 + 曲库里还有这一首（本地引用不带地址、在线音源还没接） */
const rows = computed(() => {
  const songs = new Map(library.songs.map((song) => [song.id, song]));
  return items.value.flatMap((item) => {
    if (item.source !== "server" || !item.refId) return [];
    const song = songs.get(item.refId);
    if (!song) return [];
    return [{ item, key: playlistItemKey(item), track: songToTrack(song) }];
  });
});

/** 列不出来的条数（本地引用 / 已不在曲库） */
const hidden = computed(() => items.value.length - rows.value.length);

const queue = computed<Track[]>(() => rows.value.map((row) => row.track));
const currentId = computed(() => player.currentTrack?.id ?? null);

onMounted(async () => {
  await listening.load();
  await library.load();
});

function playAt(index: number): void {
  if (queue.value.length === 0) return;
  player.setQueue(queue.value, index);
}

function playAll(): void {
  if (queue.value.length === 0) return;
  player.setQueue(queue.value, 0);
}

function toggleFavorite(index: number): void {
  const row = rows.value[index];
  if (row) void listening.toggleFavorite(row.item);
}

async function clearRecent(): Promise<void> {
  const count = listening.recent.length;
  if (count === 0) return;
  const ok = await confirmAction({
    title: `清空最近播放的 ${count} 条？`,
    description: "只清这份播放记录，收藏与歌单都不受影响。",
  });
  if (!ok) return;
  busy.value = true;
  await listening.clearRecent();
  busy.value = false;
}
</script>

<template>
  <section class="page-frame">
    <div class="page-head">
      <div class="page-head__title">
        <NavToggle />
        <h1>我的音乐</h1>
        <p class="sub">
          收藏 {{ listening.favorites.length }} 首 · 最近播放 {{ listening.recent.length }} 条
        </p>
      </div>
      <div class="page-head__actions">
        <button class="btn btn-primary" :disabled="queue.length === 0" @click="playAll">
          <IconPlay class="icon" />
          播放全部
        </button>
        <button
          v-if="tab === 'recent' && listening.recent.length > 0"
          class="btn"
          :disabled="busy"
          @click="clearRecent"
        >
          <IconTrash class="icon" />
          清空记录
        </button>
      </div>
    </div>

    <p v-if="listening.error" class="my-error" role="alert">{{ listening.error }}</p>

    <div class="my-tabs">
      <SegmentedControl v-model="tab" :options="TAB_OPTIONS" />
    </div>

    <!-- 列不出来的那些：一句小字说清楚，不静默消失。它说明的是这份列表，所以钉在帧上、不跟着滚 -->
    <p v-if="hidden > 0" class="my-note">
      有 {{ hidden }} 条暂时列不出来（本地文件不在当前列表里，或云端那首已经不在曲库）。
    </p>

    <!-- 表头 = “说明”：与音乐库同一套骨架 —— 在滚动区外面，不吸顶、不加底色（v4.41） -->
    <TrackListHead v-if="rows.length > 0" />

    <!-- 只有列表滚动（与音乐库同一套骨架）：状态撑满帧并居中，列表才是滚动内容 -->
    <div class="page-frame__scroll">
      <EmptyState
        v-if="listening.status === 'loading' && items.length === 0"
        class="page-frame__fill"
        :icon="IconHeartStraight"
        title="正在读取…"
        desc="收藏与播放记录都在服务器上，稍等一下。"
      />

      <EmptyState
        v-else-if="items.length === 0 && tab === 'favorites'"
        class="page-frame__fill"
        :icon="IconHeartStraight"
        title="还没有收藏"
        desc="播放条上那颗心，或在音乐库里点一下 —— 喜欢的歌就会收在这里。"
      />

      <EmptyState
        v-else-if="items.length === 0"
        class="page-frame__fill"
        :icon="IconTrash"
        title="还没有播放记录"
        desc="听过一首歌之后，这里会留下最近播放的 100 条。"
      />

      <div v-else-if="rows.length === 0" class="page-frame__fill">
        <p class="my-note">这一批现在都没有能播的。</p>
      </div>

      <div v-else class="row-list">
        <TrackRow
          v-for="(row, index) in rows"
          :key="row.key"
          :track="row.track"
          :index="index"
          :active="currentId === row.track.id"
          :playing="player.playing"
          :removable="false"
          show-favorite
          :favorite="listening.isFavorite(row.item)"
          @play="playAt"
          @toggle-favorite="toggleFavorite"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.my-error {
  margin: 10px 0;
  font-size: 13px;
  color: var(--danger);
}

.my-tabs {
  margin: 4px 0 12px;
}

/* 列不出来的那些：用一句小字说清楚，不静默消失 */
.my-note {
  padding: 4px 2px 10px;
  font-size: 12.5px;
  color: var(--text-3);
}
</style>
