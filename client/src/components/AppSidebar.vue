<script setup lang="ts">
import type { Component } from "vue";
import { computed } from "vue";
import { RouterLink } from "vue-router";
import IconCaretDoubleLeft from "~icons/ph/caret-double-left";
import IconGearSix from "~icons/ph/gear-six";
import IconGlobe from "~icons/ph/globe";
import IconHouse from "~icons/ph/house";
import IconListPlus from "~icons/ph/list-plus";
import IconMusicNotes from "~icons/ph/music-notes";
import { useAuthStore } from "@/stores/auth";
import { useConfigStore } from "@/stores/config";

defineProps<{ collapsed: boolean }>();
defineEmits<{ toggle: [] }>();

const auth = useAuthStore();
const config = useConfigStore();

interface NavItem {
  name: string;
  label: string;
  icon: Component;
}

/** 导航项按身份与音源配置裁剪（AC-01：未登录只留本地播放；ON-04：音源未配置隐藏在线搜索） */
const navItems = computed<NavItem[]>(() => {
  const items: NavItem[] = [{ name: "local", label: "本地播放", icon: IconHouse }];
  if (auth.canUseServer) {
    items.push({ name: "library", label: "音乐库", icon: IconMusicNotes });
    if (config.onlineEnabled) items.push({ name: "online", label: "在线搜索", icon: IconGlobe });
  }
  return items;
});
</script>

<template>
  <aside class="sidebar glass">
    <!-- 内层内容固定“展开时的宽度”（.sb-inner），折叠/展开时由外层 .sidebar 裁切 ——
         参考 shadcn-vue 的 sidebar（v5.10）：面板宽度动画，内容不跟着回流，
         否则展开的那 0.25s 里文字会被挤成竖排（实测标签高度一度 67px = 四行）。 -->
    <div class="sb-inner">
      <div class="sb-logo"><span class="note">♫</span><span class="lbl">轻听音乐</span></div>

      <!-- 主导航：包一层 nav（顺便拿到 navigation 地标），并且**项与项之间留 4px** ——
           不加间距时，悬浮/选中的圆角底色会上下贴成一块（需求方：“又挤在一起了”）。
           4px 是 shadcn 的 sidebar 里 `SidebarMenu` 的 `gap-1`，页脚那两枚也用同一个值（v5.11）。 -->
      <nav class="sb-nav">
        <RouterLink
          v-for="item in navItems"
          :key="item.name"
          class="nav-item"
          active-class="active"
          :title="item.label"
          :to="{ name: item.name }"
        >
          <component :is="item.icon" class="icon" />
          <span class="lbl">{{ item.label }}</span>
        </RouterLink>
      </nav>

      <!-- 歌单分区（PRD 3.6 / 原型 v2.6）：数据接入在 M2（PS-01） -->
      <div class="sb-sep" />
      <div class="sb-section">
        <div class="sb-section-head">
          <span class="lbl">歌 单</span>
          <button class="sb-add" disabled title="新建歌单（开发中）">
            <IconListPlus class="icon" />
          </button>
        </div>
        <p class="sb-hint lbl">暂无歌单</p>
      </div>

      <div class="sb-foot">
        <RouterLink class="nav-item" active-class="active" title="设置" :to="{ name: 'settings' }">
          <IconGearSix class="icon" />
          <span class="lbl">设置</span>
        </RouterLink>
        <button class="nav-item" title="折叠侧边栏" @click="$emit('toggle')">
          <IconCaretDoubleLeft class="icon icon--collapse" />
          <span class="lbl">折叠侧边栏</span>
        </button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  grid-row: 1;
  grid-column: 1;
  /* 内层管滚动与内边距，外层只负责**裁切**：列宽动画期间多出来的内容被裁掉，
     而不是撑出横向滚动条（原来 overflow-y: auto 会把 overflow-x 也算成 auto，
     于是展开动画里 logo 一超宽就出现横向滚动）。
     ⚠️ 这里**不要写 display**：移动端靠 global.css 的 `.sidebar { display: none }`
     把它收掉，而 scoped 规则的特异性更高（.sidebar[data-v-x]），写上去会让窄屏又冒出来。 */
  overflow: hidden;
}

/* 内容固定“展开时的宽度”，折叠态再改成窄栏宽度。两档都**跟着网格列一起动画**：
   这样选中高亮（项自己的底色）是**跟着面板一起缩**，而不是在点击那一帧从 200px 瞬变 44px
   （需求方：“高亮的背景会前后动”）。
   文字不会因为宽度动画回流：标签 `nowrap` + 外层 `overflow: hidden`，多出来的部分被裁。
   ⚠️ 宽度必须等于**列宽本身**（224 / 68），不能减掉内边距：全局是 border-box，
   内边距已包含在宽度里；再减一次就会在右侧多出 24px 空条。 */
.sb-inner {
  display: flex;
  flex-direction: column;
  width: 224px;
  height: 100%;
  padding: 18px 12px 12px;
  /* ⚠️ 横向必须显式 `hidden`（v5.14）：只写 `overflow-y: auto` 时，按规范 `overflow-x`
     会被算成 `auto` —— 展开动画里有那么两三帧，内层还只有 81px 宽，而标签/品牌文字已经
     瞬时显形（nowrap，宽 117px），于是**底部冒出一条横向滚动条**（实测 10px 高，两帧后消失）。
     需求方看到的就是“侧边栏底部在收起/展开时跳一下”。这里要的是裁切而不是滚动。 */
  overflow-x: hidden;
  overflow-y: auto;
  transition:
    width 0.25s ease,
    padding 0.25s ease;
}

/* 折叠态：**只改宽度**（+ 藏标签、折叠箭头转 180°）。
   原来还改了 nav-item 的 padding/justify-center、分隔线外边距、分组标题的 justify ——
   那些都是“点一下就地换布局”，每一项都会跳一下（图标、分隔线、加号按钮）。
   现在折叠态几何与展开态一致：图标停在 12+12=24（恰好也是窄栏的居中位置，
   因为 68/2 − 19/2 = 24.5），高亮与分隔线跟着面板宽度滑。 */
.app.collapsed .sb-inner {
  width: 68px;
}

/* 文字永不换行：容器还窄的时候只能被裁，不能挤成竖排 */
.lbl {
  white-space: nowrap;
}

.sb-logo {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 1px;
  /* ⚠️ 行高必须**写死**（v5.12）：折叠态把字号提到 20px 是为了 ♫ 在窄栏里更有存在感，
     但字号一变行高就跟着变 → logo 盒子从 44 变 48，**下面所有图标瞬跳 4px**
     （实测：收起/展开的瞬间 86.4 → 90.4，就是需求方看到的“图标在跳动”）。
     固定 22px 行高后，两态盒子都是 44，图标一动不动。 */
  line-height: 22px;
  padding: 4px 12px 18px;
  white-space: nowrap;
}

/* 导航列表与页脚用同一个“项间距”（v5.11）：4px。
   贴在一起时，悬浮/选中的圆角底色会上下连成一块；页脚原本是 2px、主体是 0，
   两种节奏并存只会让人以为是 bug。 */
.sb-nav,
.sb-foot {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sb-logo .note {
  color: var(--accent);
  margin-right: 6px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
  border-radius: var(--radius-control);
  color: var(--text-2);
  font-size: 13.5px;
  text-align: left;
  position: relative;
  /* text-decoration 已由全局 reset 统一处理（global.css 的 a 规则） */
  transition:
    background 0.15s,
    color 0.15s;
}

.nav-item:hover {
  background: var(--hover);
  color: var(--text-1);
}

.nav-item.active {
  background: var(--accent-soft);
  color: var(--text-1);
}

.nav-item.active::before {
  content: "";
  position: absolute;
  left: 0;
  top: 22%;
  height: 56%;
  width: 3px;
  border-radius: 3px;
  background: var(--accent);
}

.nav-item .icon {
  width: 19px;
  height: 19px;
}

.sb-sep {
  height: 1px;
  background: var(--glass-border);
  margin: 10px 12px;
}

.sb-section {
  padding: 0 12px 8px;
}

.sb-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--text-3);
  font-size: 11px;
  letter-spacing: 2px;
  padding: 6px 0;
}

.sb-add {
  color: var(--text-3);
  display: grid;
  place-items: center;
}

.sb-add:disabled {
  opacity: 0.5;
}

.sb-add .icon {
  width: 15px;
  height: 15px;
}

.sb-hint {
  font-size: 12px;
  color: var(--text-3);
  padding: 4px 0;
}

.sb-foot {
  /* flex 列与 4px 间距见上面 .sb-nav/.sb-foot 的共用规则，这里只管“贴底” */
  margin-top: auto;
}

.sb-foot .nav-item {
  font-size: 12.5px;
  color: var(--text-3);
}

.icon--collapse {
  transition: transform 0.25s;
}

.app.collapsed .icon--collapse {
  transform: rotate(180deg);
}

/* 折叠态：纯图标窄栏，状态由 PlayerLayout 记忆（原型 v2.7） */
.app.collapsed .sb-logo {
  /* 字号可以变大（行高已写死，不会推布局），但**不能改 text-align/padding** ——
     那会让 ♫ 在点击那一帧横移。 */
  font-size: 20px;
}

.app.collapsed .lbl {
  display: none;
}

/* 折叠态藏掉「歌单」分组右上角的新建按钮（v5.13）：
   它的位置由 `.sb-section-head` 的 space-between 决定 —— 标签一藏，它就只剩一个孩子、
   被推到最左边，于是在点击那一帧横跳 161px（实测 199 → 38）。
   shadcn 的 SidebarGroupAction 在 icon 态也是直接 hidden；何况它现在还是 disabled 的。 */
.app.collapsed .sb-add {
  display: none;
}
</style>
