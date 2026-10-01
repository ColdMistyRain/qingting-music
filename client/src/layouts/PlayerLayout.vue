<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import AppSidebar from "@/components/AppSidebar.vue";
import MobileTabBar from "@/components/MobileTabBar.vue";
import PlayerBar from "@/components/PlayerBar.vue";
import { useConfigStore } from "@/stores/config";
import { usePlayerStore } from "@/stores/player";
import { handleShortcut } from "@/utils/shortcuts";

const STORAGE_KEY = "qt-sidebar-collapsed";

const collapsed = ref(localStorage.getItem(STORAGE_KEY) === "1");
watch(collapsed, (value) => localStorage.setItem(STORAGE_KEY, value ? "1" : "0"));

const player = usePlayerStore();

/** PL-01 / PL-08：空格切播放、左右方向键快退快进 5 秒、上下方向键调音量。
    键位判定在 utils/shortcuts（沉浸页共用同一套，避免两处各写一份漂掉）。 */
const shortcuts = {
  toggle: () => player.toggle(),
  seekBy: (seconds: number) => player.seekTo(player.progress + seconds),
  adjustVolume: (delta: number) => player.setVolume(player.volume + delta),
};

function onKeydown(event: KeyboardEvent): void {
  if (handleShortcut(event, shortcuts)) event.preventDefault();
}

onMounted(() => {
  // 功能开关（在线音源是否配置）拉一次；播放存档已由 main.ts 在首屏前恢复
  void useConfigStore().load();
  window.addEventListener("keydown", onKeydown);
});

onUnmounted(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div class="app" :class="{ collapsed }">
    <AppSidebar :collapsed="collapsed" @toggle="collapsed = !collapsed" />
    <main class="content glass">
      <RouterView v-slot="{ Component }">
        <Transition name="page">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>
    <PlayerBar />
    <!-- 手机导航（RT-02）：≥768px 自身 display:none，桌面不受影响 -->
    <MobileTabBar />
  </div>
</template>
