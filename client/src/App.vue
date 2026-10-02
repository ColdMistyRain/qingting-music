<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { TooltipProvider } from "reka-ui";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { useMediaSession } from "@/composables/useMediaSession";
import { usePlayHistory } from "@/composables/usePlayHistory";

// 应用根：只承载路由出口（登录页与播放器/控制台外壳由路由决定）
const route = useRoute();
const router = useRouter();

/** RT-04：锁屏 / 通知栏 / 耳机按键。挂在根组件而不是 PlayerLayout ——
 *  播放器是单例，控制台页面里音乐也在播，挂在布局里会一进控制台就解绑。 */
useMediaSession();
// 收藏与最近播放（PS-05）：同样是“全站跟着播放器走”的事，挂在 App 上
usePlayHistory();

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

/** 刷新 / 直达 URL 时**不播入场动画**（v5.51）。需求方：“在歌词界面如果这时刷新页面就会播放
 *  歌词界面从下往上的动画，这好像有点不合理。”
 *
 *  真因：`<Transition>` 本来不管首屏（默认没有 `appear`），但**路由组件是懒加载的** —— 首屏先渲染成
 *  空、拿到 chunk 之后再挂上，于是这一次“从无到有”被当成一次普通的 enter，连那段“从底部升起”也一并播了。
 *  而那段动画的语义是“从列表页进入沉浸页”，刷新时压根没有“上一页”。
 *
 *  做法：首个路由组件挂载之前不允许 CSS 过渡（`:css="false"` 让 Vue 跳过过渡类与等待，元素一帧到位），
 *  那一次 enter 走完之后再放开。
 *  ⚠️ 不能在 App 的 `onMounted` 里放开：路由组件是懒加载的，App 挂载时 RouterView 里还是空的，
 *     那一刻放开就盖不住首屏那一次 enter（v5.51 实测：照样从屏幕外升上来）。
 *  ⚠️ 也不能放在 `router.isReady()` 里：它与首屏渲染谁先谁后取决于微任务顺序，不可靠。
 *  于是用“首个 enter 的 after 钩子”作为释放点，另加一条导航次数兜底 —— 万一首个 enter 没触发，
 *  下一次导航后也放开，免得动画永久失效。 */
const allowTransition = ref(false);

/** 首个 enter 结束（`:css=false` 时它会立即回调）：清掉配对标记，并放开过渡 */
function onAfterEnter(): void {
  clearPair();
  allowTransition.value = true;
}

let navCount = 0;
router.afterEach(() => {
  navCount += 1;
  if (navCount > 1) allowTransition.value = true;
});
</script>

<template>
  <!-- 提示（Tooltip）的全局约定都放在这一个 Provider 上（v5.71）：
       - delay-duration 400ms：比系统 title 的 1s 跟手，又不会一划而过就弹一片；
       - skip-delay-duration 300ms：**连续移到下一枚键不再等延迟**（播放条那一排按键全靠它）——
         这正是必须用一个 Provider 全站包起来、而不能每处各包一个的原因；
       - ignore-non-keyboard-focus：只有键盘聚焦才开提示 —— 否则关掉对话框、焦点落回触发键时，
         提示会自己冒出来；
       - disable-hoverable-content：**指针离开触发器就收**。默认（false）是"指针可以移进提示里，
         靠一条 grace-area 多边形判定什么时候算离开"—— 那是给长文本提示准备的；我们的提示只有
         几个字，没有需要把指针移进去读的内容，少一条多边形判定就少一个出错面。
       它只提供 context、不渲染任何元素（Reka 的 Provider 就是 renderSlot），所以不影响布局。 -->
  <TooltipProvider
    :delay-duration="400"
    :skip-delay-duration="300"
    ignore-non-keyboard-focus
    disable-hoverable-content
  >
    <RouterView v-slot="{ Component }">
      <Transition
        :name="transitionName"
        :css="allowTransition"
        @after-enter="onAfterEnter"
        @after-leave="clearPair"
      >
        <component :is="Component" :key="layer" />
      </Transition>
    </RouterView>

    <!-- 破坏性 / 批量动作的二次确认（v5.53）：全站唯一一份，只改 utils/confirm.ts 那一个入口 -->
    <ConfirmDialog />
  </TooltipProvider>
</template>
