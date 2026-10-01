<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";

// 应用根：只承载路由出口（登录页与播放器/控制台外壳由路由决定）
const route = useRoute();

/** 顶层「层」标识：取首个匹配记录的 path。
 *  主壳内部换页（库 ⇄ 设置 …）在同一层内，`:key` 不变 —— 侧栏与播放条不会被重挂。 */
const layer = computed(() => route.matched[0]?.path ?? route.path);

/** 这次换层是不是「沉浸页 ⇄ 别的层」？必须在**路由变化的那一刻**记下来：
 *  过渡名在离场那一侧同样要生效（`/now` → 主壳时 `layer` 已经是 `/` 了，只看当前 route 会把
 *  名字算成空字符串 —— 表现就是“升上去有动画、沉下去没有”，v5.27 实测踩到过）。 */
const sheetPair = ref(false);
watch(layer, (now, was) => {
  sheetPair.value = now === "/now" || was === "/now";
});

/** 只有沉浸页进出才做「从底部升起 / 反向沉下」；其它换层沿用各自页面内的入场动画，
 *  这里给空名字 = 不加任何过渡类，行为与从前一致。
 *  两个过渡类写在 `ImmersiveView` 的 scoped 样式里，所以两个方向都只有那张 sheet 在动。 */
const transitionName = computed(() => (sheetPair.value ? "im-sheet" : ""));

/** 过渡结束就清掉，免得把「上一次」当成这一次（否则主壳 ⇄ 管理台也会被套上 sheet 的时长） */
function clearPair(): void {
  sheetPair.value = false;
}
</script>

<template>
  <RouterView v-slot="{ Component }">
    <Transition :name="transitionName" @after-enter="clearPair" @after-leave="clearPair">
      <component :is="Component" :key="layer" />
    </Transition>
  </RouterView>
</template>
