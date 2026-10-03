<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import IconClockCounterClockwise from "~icons/ph/clock-counter-clockwise";
import IconHeartStraight from "~icons/ph/heart-straight";
import IconPlay from "~icons/ph/play";
import IconTrash from "~icons/ph/trash";
import { playlistItemKey, type PlaylistItem, type Track } from "@qingting/shared";
import EmptyState from "@/components/EmptyState.vue";
import NavToggle from "@/components/NavToggle.vue";
import TrackListHead from "@/components/TrackListHead.vue";
import TrackRow from "@/components/TrackRow.vue";
import { useVirtualList } from "@/composables/useVirtualList";
import { useLibraryStore } from "@/stores/library";
import { useListeningStore } from "@/stores/listening";
import { usePlayerStore } from "@/stores/player";
import { confirmAction } from "@/utils/confirm";
import { songToTrackCached } from "@/utils/library";

/**
 * 我的收藏 / 最近播放（PS-05）：同一份数据的两个入口，各占一个一级导航位。
 *
 * 曾经合成一页「我的音乐」+ 两个页签，需求方反馈“这种布局让你迷惑” —— 两个页签装的
 * 是两件不同的事（我收下的 / 我听过什么），塞在一页里既没有共同标题、也让侧栏少了一个
 * 入口。所以拆成两页（`/favorites`、`/recent`），组件共用一份、由路由给 `mode`
 * （两边只有标题、一处动作与数据源不同），列表骨架与音乐库完全一致。
 *
 * 数据在服务器端（`data/listening.json`）—— 收藏与播放记录跟着服务器走，
 * 不跟着某个浏览器走（手机上收藏的、电脑上看得见）。
 *
 * 列表行复用 `TrackRow`（与音乐库同一套行视觉），多一枚收藏键：收藏页里要能取消收藏，
 * 最近播放里也要能顺手收下。**只列现在还能播的**（云端引用要能在曲库里对上），
 * 对不上的那些不静默消失 —— 用一行小字说清楚有几首、为什么。
 */
const props = defineProps<{ mode: "favorites" | "recent" }>();

const listening = useListeningStore();
const library = useLibraryStore();
const player = usePlayerStore();

const isRecent = computed(() => props.mode === "recent");
const title = computed(() => (isRecent.value ? "最近播放" : "我的收藏"));
const busy = ref(false);

const items = computed<readonly PlaylistItem[]>(() =>
  isRecent.value ? listening.recent : listening.favorites,
);

/** 能播的那些：云端引用 + 曲库里还有这一首（本地引用不带地址、在线音源还没接） */
const rows = computed(() => {
  const songs = new Map(library.songs.map((song) => [song.id, song]));
  return items.value.flatMap((item) => {
    if (item.source !== "server" || !item.refId) return [];
    const song = songs.get(item.refId);
    if (!song) return [];
    return [{ item, key: playlistItemKey(item), track: songToTrackCached(song) }];
  });
});

/** 列不出来的条数（本地引用 / 已不在曲库） */
const hidden = computed(() => items.value.length - rows.value.length);

/* 长列表虚拟滚动（LB-08 / v6.27）：与音乐库、控制台同一套（收藏也可能攒到几百首）。
   这一份列表**没有行间细线**，所以行距是“行高 + 行距”—— 由 composable 量出来，不用管。 */
const listEl = ref<HTMLElement | null>(null);
const { start, end, padTop, padBottom } = useVirtualList({
  list: listEl,
  rowSelector: ".row",
  count: () => rows.value.length,
});
/** 只渲染窗口里那几行；行上的下标仍是全量列表里的（`start + index`） */
const windowRows = computed(() => rows.value.slice(start.value, end.value));

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
        <h1>{{ title }}</h1>
        <p class="sub">
          {{
            isRecent
              ? `最近 ${listening.recent.length} 条`
              : `收藏 ${listening.favorites.length} 首`
          }}
        </p>
      </div>
      <div class="page-head__actions">
        <button class="btn btn-primary" :disabled="queue.length === 0" @click="playAll">
          <IconPlay class="icon" />
          播放全部
        </button>
        <button
          v-if="isRecent && listening.recent.length > 0"
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
        :icon="isRecent ? IconClockCounterClockwise : IconHeartStraight"
        title="正在读取…"
        desc="收藏与播放记录都在服务器上，稍等一下。"
      />

      <EmptyState
        v-else-if="items.length === 0 && isRecent"
        class="page-frame__fill"
        :icon="IconClockCounterClockwise"
        title="还没有播放记录"
        desc="听过一首歌之后，这里会留下最近播放的 100 条。"
      />

      <EmptyState
        v-else-if="items.length === 0"
        class="page-frame__fill"
        :icon="IconHeartStraight"
        title="还没有收藏"
        desc="播放条上那颗心，或在音乐库里点一下 —— 喜欢的歌就会收在这里。"
      />

      <div v-else-if="rows.length === 0" class="page-frame__fill">
        <p class="my-note">这一批现在都没有能播的。</p>
      </div>

      <div v-else ref="listEl" class="row-list">
        <div
          v-if="padTop > 0"
          class="row-pad"
          :style="{ height: `${padTop}px` }"
          aria-hidden="true"
        />
        <TrackRow
          v-for="(row, index) in windowRows"
          :key="row.key"
          :track="row.track"
          :index="start + index"
          :active="currentId === row.track.id"
          :removable="false"
          show-favorite
          :favorite="listening.isFavorite(row.item)"
          @play="playAt"
          @toggle-favorite="toggleFavorite"
        />
        <div
          v-if="padBottom > 0"
          class="row-pad"
          :style="{ height: `${padBottom}px` }"
          aria-hidden="true"
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

/* 列不出来的那些：用一句小字说清楚，不静默消失 */
.my-note {
  padding: 4px 2px 10px;
  font-size: 12.5px;
  color: var(--text-3);
}
</style>
