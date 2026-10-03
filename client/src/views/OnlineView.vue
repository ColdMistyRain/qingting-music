<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { OnlineTrack } from "@qingting/shared";
import { toPlaylistItem, type Track } from "@qingting/shared";
import NavToggle from "@/components/NavToggle.vue";
import IconGlobe from "~icons/ph/globe";
import IconMagnifyingGlass from "~icons/ph/magnifying-glass";
import IconPlugsConnected from "~icons/ph/plugs-connected";
import IconWarningCircle from "~icons/ph/warning-circle";
import EmptyState from "@/components/EmptyState.vue";
import TrackList from "@/components/TrackList.vue";
import TrackListHead from "@/components/TrackListHead.vue";
import { fetchOnlineSearch } from "@/api/online";
import { toOnlineTrack } from "@/utils/onlineTracks";
import { debounce } from "@/utils/debounce";
import { useConfigStore } from "@/stores/config";
import { useListeningStore } from "@/stores/listening";
import { usePlayerStore } from "@/stores/player";

/**
 * 在线搜索（PRD 3.5，ON-02/03）：关键词搜索在线音源，点行即播。
 * 结果整份当队列（与音乐库同一交互），点播时由 player store 现解析播放直链。
 *
 * 输入即时回显、搜索防抖 500ms（每次搜索都是一次上游请求，比本地过滤贵）；
 * 连续输入只认最后一次（序号判 stale，慢的旧响应不覆盖新结果）。
 */
const config = useConfigStore();
const listening = useListeningStore();
const player = usePlayerStore();

onMounted(() => {
  // 行尾那枚收藏键要知道“收没收藏”，而收藏数据在服务端（PS-05）
  void listening.load();
});

const keyword = ref("");
const status = ref<"idle" | "loading" | "ready" | "error">("idle");
const errorMessage = ref("");
const tracks = ref<Track[]>([]);
const lastKeyword = ref("");

/** 每次搜索自增；响应回来时序号对不上就丢掉（请求本身没法中断，也不必中断） */
let searchSeq = 0;

async function search(raw: string): Promise<void> {
  const text = raw.trim();
  if (!text) return;
  const seq = ++searchSeq;
  status.value = "loading";
  errorMessage.value = "";
  lastKeyword.value = text;

  try {
    const result = await fetchOnlineSearch("netease", text);
    if (seq !== searchSeq) return;
    tracks.value = result.tracks.map((info: OnlineTrack) => toOnlineTrack(result.provider, info));
    status.value = "ready";
  } catch (error) {
    if (seq !== searchSeq) return;
    status.value = "error";
    errorMessage.value = error instanceof Error ? error.message : "搜索出了点问题";
  }
}

/** 输入停 500ms 才搜；回车立即搜 */
const applyKeyword = debounce((value: string) => {
  if (value.trim()) void search(value);
}, 500);
watch(keyword, (value) => applyKeyword.call(value));
onBeforeUnmount(() => applyKeyword.cancel());

function submit(): void {
  applyKeyword.cancel();
  void search(keyword.value);
}

const hasResults = computed(() => status.value === "ready" && tracks.value.length > 0);
const noResults = computed(() => status.value === "ready" && tracks.value.length === 0);

function playAt(index: number): void {
  const target = tracks.value[index];
  if (!target) return;
  player.clear();
  player.addTracks(tracks.value);
  player.playAt(index);
}

/* 行尾的收藏键与音乐库同一套：收没收藏看服务端数据（PS-05），在线曲目用 provider:id 引用 */
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
        <h1>在线搜索</h1>
        <div class="sub">音源：网易云</div>
      </div>
    </div>

    <EmptyState
      v-if="config.status === 'error'"
      :icon="IconPlugsConnected"
      title="配置没能读出来"
      desc="后端可能刚重启还没就绪。稍后重试一下就好，本地播放与云端曲库不受影响。"
      fill
    >
      <button class="btn btn-primary" @click="config.load(true)">重试</button>
    </EmptyState>

    <EmptyState
      v-else-if="!config.onlineEnabled"
      :icon="IconPlugsConnected"
      title="在线音源未配置"
      desc="在服务端的配置里填入音源地址并重启即可启用，前端无需改动。未配置时，本地播放与云端曲库不受任何影响。"
      fill
    />

    <template v-else>
      <div class="toolbar">
        <label class="search">
          <IconMagnifyingGlass class="icon" />
          <!-- enterkeyhint：手机键盘回车键显示成“搜索”（RT-05 触屏可达性同一件事） -->
          <input
            v-model="keyword"
            type="search"
            enterkeyhint="search"
            placeholder="搜索在线歌曲，回车搜索"
            @keydown.enter="submit"
          />
        </label>
        <button class="btn btn-primary" :disabled="status === 'loading'" @click="submit">
          搜索
        </button>
        <span v-if="status === 'loading'" class="toolbar__spacer count">搜索中…</span>
        <span v-else-if="hasResults" class="toolbar__spacer count">
          找到 {{ tracks.length }} 首
        </span>
      </div>

      <!-- 刷新失败但手上还有上一份结果：保留列表，只在上面给一条提示（不要白屏） -->
      <div v-if="status === 'error' && tracks.length > 0" class="strip">
        <IconWarningCircle class="icon" />
        <span>{{ errorMessage }}</span>
        <button class="btn btn-quiet" @click="search(lastKeyword)">重试</button>
      </div>

      <TrackListHead v-if="hasResults" />

      <div class="page-frame__scroll">
        <div v-if="status === 'loading' && tracks.length === 0" class="page-frame__fill">
          <p class="note">正在搜索「{{ lastKeyword }}」…</p>
        </div>

        <div v-else-if="status === 'error' && tracks.length === 0" class="page-frame__fill">
          <div class="fail card">
            <span class="fail__badge"><IconWarningCircle class="icon" /></span>
            <div class="fail__title">搜索没能完成</div>
            <p class="fail__desc">{{ errorMessage }}</p>
            <button class="btn btn-primary" @click="search(lastKeyword)">重试</button>
          </div>
        </div>

        <div v-else-if="noResults" class="page-frame__fill">
          <EmptyState
            :icon="IconGlobe"
            title="没有找到相关的歌曲"
            :desc="`换个关键词试试。想找「${lastKeyword}」的翻唱或现场版，可以在关键词里加上这些词。`"
            fill
          />
        </div>

        <TrackList
          v-else-if="hasResults"
          :tracks="tracks"
          :active-id="player.currentTrack?.id ?? null"
          :removable="false"
          show-favorite
          :favorite-of="isFavorite"
          @play="playAt"
          @toggle-favorite="toggleFavorite"
        />

        <div v-else class="page-frame__fill">
          <EmptyState
            :icon="IconGlobe"
            title="搜一首想听的歌"
            desc="支持歌名、歌手或两者一起。在线歌曲可以试听、收藏、加进歌单，与本地和云端曲目混着排队。"
            fill
          />
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.count {
  font-size: 12px;
  color: var(--text-3);
}
</style>
