<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { toPlaylistItem, type Track } from "@qingting/shared";
import NavToggle from "@/components/NavToggle.vue";
import IconArrowsClockwise from "~icons/ph/arrows-clockwise";
import IconGlobe from "~icons/ph/globe";
import IconMagnifyingGlass from "~icons/ph/magnifying-glass";
import IconPlugsConnected from "~icons/ph/plugs-connected";
import IconWarningCircle from "~icons/ph/warning-circle";
import EmptyState from "@/components/EmptyState.vue";
import AppSelect from "@/components/AppSelect.vue";
import IconQrCode from "~icons/ph/qr-code";
import TrackList from "@/components/TrackList.vue";
import TrackListHead from "@/components/TrackListHead.vue";
import { debounce } from "@/utils/debounce";
import { filterSongs } from "@/utils/library";
import { useConfigStore } from "@/stores/config";
import { useListeningStore } from "@/stores/listening";
import { useOnlineStore } from "@/stores/online";
import { usePlayerStore } from "@/stores/player";

/**
 * 在线搜索 / 网易云歌单（PRD 3.5，ON-02/03 + ON-10）—— 同一页面的两种形态：
 *
 * - **搜索态**（默认）：关键词搜在线音源，输入防抖 500ms、序号判 stale；
 * - **歌单态**（v6.35，需求方："应该显示实际歌单名称吧，还有这个搜索应该是搜索
 *   列表内的歌曲"）：从侧栏点开网易云歌单后，标题就是歌单名，搜索框变成
 *   **在这份歌单里过滤**（本地、即时、防抖 150ms —— 与音乐库同一节奏），
 *   页头给「返回搜索」出口；点侧栏的「在线搜索」同样回到搜索态。
 *
 * 两种态都是"结果整份当队列"（与音乐库同一交互），点播时由 player store 现解析播放直链。
 * 搜索与歌单的状态都放在 online store —— 跳去沉浸页再回来都还在
 * （v6.45 起搜索结果也跨页保留，此前是页面局部状态、切一次路由就得重搜）。
 */
const config = useConfigStore();
const listening = useListeningStore();
const player = usePlayerStore();
const online = useOnlineStore();

onMounted(() => {
  // 行尾那枚收藏键要知道“收没收藏”，而收藏数据在服务端（PS-05）
  void listening.load();
  void online.loadAccount();
  // QQ 会话验真（v6.57）：失效即清，界面回未登录
  void online.loadQqAccount();
});

/* ---------- 音源选择（v6.57，ON-06）---------- */
const sourceOptions = [
  { value: "netease", label: "网易云" },
  { value: "qq", label: "QQ 音乐" },
] as const;
/** QQ 的搜索必须带登录 Cookie（匿名上游直接拒绝，v6.57 实测）：
    未登录时不给搜索框，先引导扫码 */
const qqNeedsLogin = computed(() => online.provider === "qq" && !online.qqLoggedIn);

// 登录态就绪后把歌单列表备好（一次轻请求；未登录时这步自动失败、静默）
watch(
  () => online.loggedIn,
  (loggedIn) => {
    if (loggedIn) void online.loadPlaylists(true);
  },
  { immediate: true },
);

/** 输入框绑定 store 的搜索词（v6.45 起搜索状态跨页保留） */
const keyword = computed({
  get: () => online.searchKeyword,
  set: (value: string) => {
    online.searchKeyword = value;
  },
});
/** 歌单内的过滤词（防抖 150ms，与音乐库同一节奏：输入即时回显、过滤跟随） */
const query = ref("");

const collectionMode = computed(() => online.activePlaylistId !== null);
const activePlaylist = computed(() => online.activePlaylist);

// 切换歌单 / 收起歌单：清掉旧关键词（上一份的过滤词不该套在新列表上）
watch(
  () => online.activePlaylistId,
  () => {
    keyword.value = "";
    query.value = "";
  },
);

const applyKeyword = debounce((value: string) => {
  if (value.trim()) void online.search(value);
}, 500);
/** 歌单内过滤：本地纯函数，150ms 跟随（与音乐库的站内过滤同一节奏） */
const applyQuery = debounce((value: string) => {
  query.value = value;
}, 150);

watch(keyword, (value) => {
  if (collectionMode.value) applyQuery.call(value);
  else applyKeyword.call(value);
});
onBeforeUnmount(() => {
  applyKeyword.cancel();
  applyQuery.cancel();
});

function submit(): void {
  // 歌单态的过滤是本地的、即时的，回车/按钮不触发远程搜索
  if (collectionMode.value) return;
  applyKeyword.cancel();
  void online.search(online.searchKeyword);
}

const isFiltering = computed(() => collectionMode.value && query.value.trim().length > 0);

/** 展示给列表的曲目：歌单态用过滤后的歌单曲目，搜索态用搜索结果 */
const displayTracks = computed<Track[]>(() =>
  collectionMode.value ? filterSongs(online.collectionTracks, query.value) : online.searchTracks,
);

const listStatus = computed<"idle" | "loading" | "ready" | "error">(() =>
  collectionMode.value ? online.collectionStatus : online.searchStatus,
);
const listError = computed(() =>
  collectionMode.value ? online.collectionError : online.searchError,
);
const hasResults = computed(() => listStatus.value === "ready" && displayTracks.value.length > 0);
const noResults = computed(() => listStatus.value === "ready" && displayTracks.value.length === 0);

const pageTitle = computed(() =>
  collectionMode.value ? (activePlaylist.value?.name ?? "网易云歌单") : "在线搜索",
);
const pageSubtitle = computed(() => {
  if (!collectionMode.value) return online.provider === "qq" ? "音源：QQ 音乐" : "音源：网易云";
  const total = activePlaylist.value?.trackCount ?? online.collectionTracks.length;
  return `网易云歌单 · ${total} 首`;
});

function playAt(index: number): void {
  const target = displayTracks.value[index];
  if (!target) return;
  // 眼前这段整份当队列（与音乐库同一交互）
  player.clear();
  player.addTracks(displayTracks.value);
  player.playAt(index);
}

/* 行尾的收藏键与音乐库同一套：收没收藏看服务端数据（PS-05），在线曲目用 provider:id 引用 */
function isFavorite(track: Track): boolean {
  return listening.isFavorite(toPlaylistItem(track));
}

function toggleFavorite(index: number): void {
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
      <div v-if="collectionMode" class="page-head__actions">
        <!-- 刷新列表（v6.35 补，需求方："这按钮去掉，改成刷新列表"）：绕过缓存重新拉取；
             回搜索的出口在侧栏「在线搜索」（点它即收起歌单） -->
        <button
          class="btn"
          :disabled="listStatus === 'loading'"
          @click="online.activePlaylistId && void online.refreshPlaylist(online.activePlaylistId)"
        >
          <IconArrowsClockwise class="icon" />
          刷新列表
        </button>
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
      <div v-if="!qqNeedsLogin" class="toolbar">
        <!-- 坑 33：AppSelect 根是 fragment，class 透传不生效 —— 宿主包一层 div 承载版式 -->
        <div v-if="!collectionMode" class="source-select">
          <AppSelect
            :model-value="online.provider"
            :options="sourceOptions"
            label="音源"
            @update:model-value="(value) => online.setProvider(value as 'netease' | 'qq')"
          />
        </div>
        <label class="search">
          <IconMagnifyingGlass class="icon" />
          <!-- enterkeyhint：手机键盘回车键显示成“搜索”（RT-05 触屏可达性同一件事） -->
          <input
            v-model="keyword"
            type="search"
            enterkeyhint="search"
            :placeholder="collectionMode ? '在这份歌单里搜索' : '搜索在线歌曲，回车搜索'"
            @keydown.enter="submit"
          />
        </label>
        <button
          v-if="!collectionMode"
          class="btn btn-primary"
          :disabled="online.searchStatus === 'loading'"
          @click="submit"
        >
          搜索
        </button>
        <span v-if="isFiltering" class="toolbar__spacer count">
          找到 {{ displayTracks.length }} 首
        </span>
        <span
          v-else-if="!collectionMode && online.searchStatus === 'ready' && online.searchTracks.length > 0"
          class="toolbar__spacer count"
        >
          找到 {{ online.searchTracks.length }} 首
        </span>
      </div>

      <!-- QQ 未登录：搜索必须带登录态（v6.57 实测匿名全被拒），先引导扫码 -->
      <EmptyState
        v-if="qqNeedsLogin"
        :icon="IconQrCode"
        title="先扫码登录 QQ 音乐"
        desc="QQ 的搜索与播放都要登录态。登录保存在这台浏览器里，换浏览器需要重新扫码。"
        fill
      >
        <RouterLink class="btn btn-primary" to="/settings">
          <IconQrCode class="icon" />
          去 设置 › 在线音源 扫码登录
        </RouterLink>
      </EmptyState>

      <template v-else>
      <!-- 刷新失败但手上还有上一份结果：保留列表，只在上面给一条提示（不要白屏） -->
      <div v-if="listStatus === 'error' && hasResults === false && listError" class="strip">
        <IconWarningCircle class="icon" />
        <span>{{ listError }}</span>
        <button
          v-if="collectionMode && online.activePlaylistId"
          class="btn btn-quiet"
          @click="online.openPlaylist(online.activePlaylistId)"
        >
          重试
        </button>
        <button
          v-else-if="online.lastSearchKeyword"
          class="btn btn-quiet"
          @click="online.search(online.lastSearchKeyword)"
        >
          重试
        </button>
      </div>

      <TrackListHead v-if="hasResults" />

      <div class="page-frame__scroll">
        <!-- 加载中（v6.34）：提示与进度条放**页面中间** -->
        <div v-if="listStatus === 'loading' && displayTracks.length === 0" class="page-frame__fill">
          <div class="loading">
            <p class="loading__text">
              {{ collectionMode ? `正在读取「${online.activePlaylist?.name ?? "歌单"}」…` : `正在搜索「${online.lastSearchKeyword}」…` }}
            </p>
            <div
              class="loading__track"
              role="progressbar"
              :aria-label="collectionMode ? '正在读取歌单' : '正在搜索'"
            >
              <div class="loading__bar" />
            </div>
          </div>
        </div>

        <div v-else-if="listStatus === 'error' && displayTracks.length === 0" class="page-frame__fill">
          <div class="fail card">
            <span class="fail__badge"><IconWarningCircle class="icon" /></span>
            <div class="fail__title">
              {{ collectionMode ? "歌单没能读出来" : "搜索没能完成" }}
            </div>
            <p class="fail__desc">{{ listError }}</p>
            <button
              v-if="collectionMode && online.activePlaylistId"
              class="btn btn-primary"
              @click="online.openPlaylist(online.activePlaylistId)"
            >
              重试
            </button>
            <button
              v-else-if="online.lastSearchKeyword"
              class="btn btn-primary"
              @click="online.search(online.lastSearchKeyword)"
            >
              重试
            </button>
          </div>
        </div>

        <div v-else-if="noResults" class="page-frame__fill">
          <EmptyState
            :icon="IconGlobe"
            :title="collectionMode ? '这份歌单里没有匹配的歌曲' : '没有找到相关的歌曲'"
            :desc="
              collectionMode
                ? '换个关键词试试；点页头的「返回搜索」可以去搜全网歌曲。'
                : `换个关键词试试。想找「${online.lastSearchKeyword}」的翻唱或现场版，可以在关键词里加上这些词。`
            "
            fill
          />
        </div>

        <TrackList
          v-else-if="hasResults"
          :tracks="displayTracks"
          :active-id="player.currentTrack?.id ?? null"
          :removable="false"
          show-favorite
          :favorite-of="isFavorite"
          @play="playAt"
          @toggle-favorite="toggleFavorite"
        />

        <div v-else-if="listStatus === 'idle'" class="page-frame__fill">
          <EmptyState
            :icon="IconGlobe"
            title="搜一首想听的歌"
            desc="支持歌名、歌手或两者一起。在线歌曲可以试听、收藏、加进歌单，与本地和云端曲目混着排队。"
            fill
          >
            <RouterLink v-if="!online.loggedIn" class="btn" :to="{ path: '/settings' }">
              登录网易云账号，听你收藏的歌
            </RouterLink>
          </EmptyState>
        </div>
      </div>
      </template>
    </template>
  </section>
</template>

<style scoped>
/* 音源选择器：窄一档（两个选项），与搜索框同一行 */
.source-select {
  flex: none;
  width: 128px;
  display: flex;
}

.count {
  font-size: 12px;
  color: var(--text-3);
}

/* 加载中（v6.34）：居中的文字 + 细进度条 */
.loading {
  display: grid;
  justify-items: center;
  gap: 14px;
}

.loading__text {
  font-size: 12.5px;
  color: var(--text-3);
}

.loading__track {
  width: 180px;
  height: 4px;
  border-radius: 2px;
  overflow: hidden;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
}

.loading__bar {
  width: 40%;
  height: 100%;
  border-radius: 2px;
  background: var(--accent);
  animation: online-loading-slide 1.1s ease-in-out infinite;
}

@keyframes online-loading-slide {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(250%);
  }
}

@media (prefers-reduced-motion: reduce) {
  /* 减动效：不滑动，静态停在中间（仍是"在加载"的视觉） */
  .loading__bar {
    animation: none;
    transform: translateX(80%);
  }
}
</style>
