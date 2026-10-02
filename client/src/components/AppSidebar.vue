<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import IconCaretDoubleLeft from "~icons/ph/caret-double-left";
import IconGearSix from "~icons/ph/gear-six";
import IconListPlus from "~icons/ph/list-plus";
import IconPlaylist from "~icons/ph/playlist";
import AppTooltip from "@/components/AppTooltip.vue";
import InlineNameInput from "@/components/InlineNameInput.vue";
import { useNavItems } from "@/composables/useNavItems";
import { playlistErrorMessage } from "@/api/playlists";
import { useAuthStore } from "@/stores/auth";
import { usePlaylistsStore } from "@/stores/playlists";

const props = withDefaults(defineProps<{ collapsed: boolean; toggleLabel?: string }>(), {
  toggleLabel: "折叠侧边栏",
});
defineEmits<{ toggle: [] }>();

/** 一级导航与手机底栏共用一份（RT-02）：按身份与音源配置裁剪的逻辑在 useNavItems 里 */
const navItems = useNavItems();

const auth = useAuthStore();
const playlists = usePlaylistsStore();
const router = useRouter();

/** 歌单存在服务器端（PS-01），且是访客级（AC-03）—— 未登录时看不到也建不了（AC-01） */
const canUsePlaylists = computed(() => auth.role !== "anonymous");
const creating = ref(false);

onMounted(() => {
  if (canUsePlaylists.value) void playlists.load();
});

/** 新建：建完直接跳进新歌单，省得再去列表里找一遍 */
async function submitCreate(name: string): Promise<void> {
  creating.value = false;
  try {
    const created = await playlists.create(name);
    await router.push({ name: "playlist", params: { id: created.id } });
  } catch (error) {
    playlists.error = playlistErrorMessage(error);
  }
}

function dismissPlaylistError(): void {
  playlists.clearError();
}
</script>

<template>
  <aside class="sidebar glass">
    <!-- 内层内容固定“展开时的宽度”（.sb-inner），折叠/展开时由外层 .sidebar 裁切 ——
         参考 shadcn-vue 的 sidebar（v5.10）：面板宽度动画，内容不跟着回流，
         否则展开的那 0.25s 里文字会被挤成竖排（实测标签高度一度 67px = 四行）。 -->
    <div class="sb-inner">
      <div class="sb-logo"><span class="brand-mark" /><span class="lbl">轻听音乐</span></div>

      <!-- 中段（导航 + 歌单）是**唯一**的滚动区，品牌与页脚固定（v5.15）：
           原来整个 .sb-inner 都在滚，窗口一矮就把「设置 / 折叠侧边栏」推出去滚不见了；
           两者是外壳控件，任何内容都不该把它们挤走（shadcn 的 SidebarHeader/Content/Footer 同样分工）。 -->
      <div class="sb-scroll">
        <!-- 主导航：包一层 nav（顺便拿到 navigation 地标），并且**项与项之间留 4px** ——
             不加间距时，悬浮/选中的圆角底色会上下贴成一块（需求方：“又挤在一起了”）。
             4px 是 shadcn 的 sidebar 里 `SidebarMenu` 的 `gap-1`，页脚那两枚也用同一个值（v5.11）。 -->
        <nav class="sb-nav">
          <AppTooltip
            v-for="item in navItems"
            :key="item.name"
            :label="item.label"
            :disabled="!props.collapsed"
            side="right"
            :side-offset="10"
          >
            <RouterLink class="nav-item" active-class="active" :to="{ name: item.name }">
              <component :is="item.icon" class="icon" />
              <span class="lbl">{{ item.label }}</span>
            </RouterLink>
          </AppTooltip>
        </nav>

        <!-- 歌单分区（PRD 3.6 / PS-01）：侧栏只放「列表 + 新建」，详情在内容区 -->
        <div class="sb-sep" />
        <div class="sb-section">
          <div class="sb-section-head">
            <span class="lbl">歌 单</span>
            <AppTooltip
              :label="canUsePlaylists ? '新建歌单' : '登录后可用'"
              side="right"
              :side-offset="10"
            >
              <button class="sb-add" :disabled="!canUsePlaylists" @click="creating = true">
                <IconListPlus class="icon" />
              </button>
            </AppTooltip>
          </div>

          <InlineNameInput
            v-if="creating"
            class="sb-new"
            placeholder="歌单名"
            @submit="submitCreate"
            @cancel="creating = false"
          />

          <p v-if="!canUsePlaylists" class="sb-hint lbl">登录后可用</p>
          <p
            v-else-if="playlists.error"
            class="sb-hint lbl"
            role="alert"
            @click="dismissPlaylistError"
          >
            {{ playlists.error }}
          </p>
          <p v-else-if="playlists.count === 0 && !creating" class="sb-hint lbl">暂无歌单</p>

          <ul v-else-if="playlists.count > 0" class="sb-lists">
            <li v-for="playlist in playlists.playlists" :key="playlist.id">
              <RouterLink
                class="nav-item"
                exact-active-class="active"
                :title="playlist.name"
                :to="{ name: 'playlist', params: { id: playlist.id } }"
              >
                <IconPlaylist class="icon" />
                <span class="lbl">{{ playlist.name }}</span>
                <span class="sb-count lbl">{{ playlist.items.length }}</span>
              </RouterLink>
            </li>
          </ul>
        </div>
      </div>

      <div class="sb-foot">
        <RouterLink class="nav-item" active-class="active" title="设置" :to="{ name: 'settings' }">
          <IconGearSix class="icon" />
          <span class="lbl">设置</span>
        </RouterLink>
        <button class="nav-item" :title="props.toggleLabel" @click="$emit('toggle')">
          <IconCaretDoubleLeft class="icon icon--collapse" />
          <span class="lbl">{{ props.toggleLabel }}</span>
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
  /* 滚动全部交给中间的 .sb-scroll（品牌与页脚固定），这一层只做**裁切**：
     ① 折叠动画里多出来的文字被裁掉，而不是撑出横向滚动条（v5.14）；
     ② 两个轴都不能是 auto，否则这里会再冒一条滚动条、把页脚又推走。 */
  overflow: hidden;
  transition:
    width 0.25s ease,
    padding 0.25s ease;
}

/* 中段滚动区（导航 + 歌单）。两个要点：
   ① **滚动条槽常留**（`scrollbar-gutter: stable`）：列表长到需要滚动、或窗口变矮时，
      滚动条的出现/消失不再把项与高亮挤窄 10px（这正是需求方说的“侧栏的滚动条问题”）。
   ② 负的右外边距把这条槽**挪进 .sb-inner 的内边距里**：滚动区的内容盒宽度因此
      与不滚动时**完全一致**（展开 200 / 折叠 44），滚动条落在面板边缘 2px 处、
      永远不压住项，也不改变 12px 的左右对称（与 .page-frame 的“负边距铺到岛边”同源）。
   没有这条负边距，稳定槽会把内容永久缩窄 10px，右边距变成 22px、左 12px，一眼就歪。 */
.sb-scroll {
  flex: 1 1 auto;
  min-height: 0;
  margin-right: calc(var(--scrollbar-size, 0px) * -1);
  padding-bottom: 6px;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

/* 折叠态：**只改宽度**（+ 藏标签、折叠箭头转 180°）。
   原来还改了 nav-item 的 padding/justify-center、分隔线外边距、分组标题的 justify ——
   那些都是“点一下就地换布局”，每一项都会跳一下（图标、分隔线、加号按钮）。
   现在折叠态几何与展开态一致：图标停在 12+12=24（恰好也是窄栏的居中位置，
   因为 68/2 − 19/2 = 24.5），高亮与分隔线跟着面板宽度滑。
   ⚠️ 四条折叠态规则都带 `> .sidebar`：外壳可能是折叠态，而**手机上抽屉里渲染的是同一个
   AppSidebar** —— 不加这一层限定，“外壳折叠”就会跨进去把抽屉里的标签/新建按钮也藏了
   （与 global.css 里 `.app > .sidebar` 同一条教训，v5.43）。 */
.app.collapsed > .sidebar .sb-inner {
  width: 68px;
}

/* 文字永不换行：容器还窄的时候只能被裁，不能挤成竖排 */
.lbl {
  white-space: nowrap;
}

.sb-logo {
  flex: none;
  /* 标记给 26px（默认 22px）：这个图形内部有四条渐细笔画 + 耳机弧，22px 下会糊成一团。
     行高/盒子高度两态一致（标记是定高图片，两边都是 26 + 4 + 18 = 48），所以不会跳。 */
  --brand-mark-size: 26px;
  /* 用 flex 而不是“字形 + margin”：标记是定高图片元素，行盒基线对齐会把它自己的高度
     算进行盒（盒子就比 26px 高），而这里的盒子高度一变就会带动下面所有图标跳（v5.12 的坑）。
     flex 对齐后行高恒为 26px（+ 4/18 内边距 = 48，两态一致）。 */
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 1px;
  /* ⚠️ 行高必须**写死**（v5.12）：字号或行高一变，logo 盒子就变，下面所有图标瞬跳。 */
  line-height: 26px;
  /* ⚠️ 左内边距要把标记按**中轴**对齐导航图标（v5.17）。
     图标列宽 19px，标记盒 26px —— 两者都从同一个左内边距开始的话，标记的中轴会比图标的
     中轴偏右 (26−19)/2 = 3.5px，窄栏（只有图标）里一眼就看出“logo 没居中”。
     所以左内边距改成 12 − (标记宽 − 19)/2：标记中轴正好落在图标列的中轴上，
     而且顺带让品牌文字与导航文字对齐（都从 69 开始）。右内边距不变。 */
  padding: 4px 12px 18px calc(12px - (var(--brand-mark-size) - 19px) / 2);
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

/* 歌单列表：节奏与 .sb-nav 一致（4px 间距），折叠态只留图标 */
.sb-lists {
  display: flex;
  flex-direction: column;
  gap: 4px;
  list-style: none;
}

.sb-new {
  margin: 2px 0 6px;
}

/* 曲目数徽标（原型 v2.6）：弱一档，不与歌单名抢注意力 */
.sb-count {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

.sb-foot {
  /* flex 列与 4px 间距见上面 .sb-nav/.sb-foot 的共用规则；
     这里只用 `flex: none` 把它钉在底部 —— 贴底由上面那个会伸缩的 .sb-scroll 完成，
     不再需要 `margin-top: auto`（两个机制并存只会互相打架）。 */
  flex: none;
}

.sb-foot .nav-item {
  font-size: 12.5px;
  color: var(--text-3);
}

.icon--collapse {
  transition: transform 0.25s;
}

.app.collapsed > .sidebar .icon--collapse {
  transform: rotate(180deg);
}

/* 折叠态：纯图标窄栏，状态由 PlayerLayout 记忆（原型 v2.7）。
   改品牌标记后这里**不再改字号**了：标记是定高图片，字号只影响已被藏起来的标签
   （原来把字号提到 20px 是为了让 ♫ 在窄栏里更有存在感）。 */
.app.collapsed > .sidebar .lbl {
  display: none;
}

/* 折叠态藏掉「歌单」分组右上角的新建按钮（v5.13）：
   它的位置由 `.sb-section-head` 的 space-between 决定 —— 标签一藏，它就只剩一个孩子、
   被推到最左边，于是在点击那一帧横跳 161px（实测 199 → 38）。
   shadcn 的 SidebarGroupAction 在 icon 态也是直接 hidden；何况它现在还是 disabled 的。 */
.app.collapsed > .sidebar .sb-add {
  display: none;
}
</style>
