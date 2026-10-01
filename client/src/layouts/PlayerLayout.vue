<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import AppSidebar from "@/components/AppSidebar.vue";
import PlayerBar from "@/components/PlayerBar.vue";
import { useConfigStore } from "@/stores/config";
import { usePlayerStore } from "@/stores/player";
import { isEditableTarget, type EditableLike } from "@/utils/keyboard";

const STORAGE_KEY = "qt-sidebar-collapsed";

const collapsed = ref(localStorage.getItem(STORAGE_KEY) === "1");
watch(collapsed, (value) => localStorage.setItem(STORAGE_KEY, value ? "1" : "0"));

const player = usePlayerStore();

/** PL-01：空格键切换播放/暂停；焦点在输入类控件内时不拦截（否则打字打不了空格） */
function onKeydown(event: KeyboardEvent): void {
  if (event.code !== "Space" || event.repeat) return;
  if (isEditableTarget(event.target as unknown as EditableLike | null)) return;
  event.preventDefault();
  player.toggle();
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
      <RouterView />
    </main>
    <PlayerBar />
  </div>
</template>
