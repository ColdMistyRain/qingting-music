<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from "reka-ui";
import IconSignOut from "~icons/ph/sign-out";
import { useAuthStore } from "@/stores/auth";
import { useConfigStore } from "@/stores/config";
import { useThemeStore, type ImLayout } from "@/stores/theme";
import { tabSlideDirection } from "@/utils/tabs";

/** 设置页（PRD 3.8）：顶部 Tab 形态，管理 Tab 仅管理员可见 */
const auth = useAuthStore();
const config = useConfigStore();
const theme = useThemeStore();
const router = useRouter();

interface SettingsTab {
  key: string;
  label: string;
}

const tabs = computed<SettingsTab[]>(() => {
  const list: SettingsTab[] = [
    { key: "appearance", label: "外观" },
    { key: "account", label: "账户" },
    { key: "online", label: "在线音源" },
    { key: "keys", label: "快捷键" },
    { key: "fx", label: "音效" },
  ];
  if (auth.isAdmin) list.push({ key: "admin", label: "管理" });
  list.push({ key: "about", label: "关于" });
  return list;
});

const active = ref("appearance");

/* 下划线指示条（v5.6）：“会滑过去”靠的是一条共享元素，所以得知道当前 Tab 在哪、多宽。
   这里只量两个原始值（x / w）写成 CSS 变量，滑动与宽度变化全交给 CSS 过渡
   （与取色管线同一条原则：JS 不写样式，只写原始值）。 */
const tabsWrapRef = ref<HTMLElement | null>(null);
const ink = ref({ x: 0, w: 0 });
const inkReady = ref(false);
let inkObserver: ResizeObserver | undefined;

function syncInk(): void {
  const activeEl = tabsWrapRef.value?.querySelector<HTMLElement>(
    '[role="tab"][data-state="active"]',
  );
  if (!activeEl) return;
  // offsetLeft/offsetWidth 是相对 offsetParent（就是 .tabs-wrap，它有 position: relative）
  ink.value = { x: activeEl.offsetLeft, w: activeEl.offsetWidth };
}

onMounted(async () => {
  await nextTick();
  syncInk();
  // 首帧量完再打开过渡，否则指示条会从 0 滑到第一格（开页时的假动画）
  requestAnimationFrame(() => {
    inkReady.value = true;
  });
  // 窗口缩放、侧栏折叠、字体替换都会改变标签宽度，跟着重量一次
  inkObserver = new ResizeObserver(() => syncInk());
  if (tabsWrapRef.value) inkObserver.observe(tabsWrapRef.value);
});

onBeforeUnmount(() => inkObserver?.disconnect());

// 切换时内容往哪边滑（v5.7）：与下划线“往哪边滑”同一个方向——
// 选中项在列表里向后移就是从右边进来，向前移就从左边进来。
// 写成 CSS 变量挂在 TabsRoot 上（只写原始值 ±1，具体滑多少在 CSS）。
const dir = ref(1);

// 点／键盘切换、以及“管理”Tab 因身份变化而出现时，都要重量一次
watch(active, (to, from) => {
  dir.value = tabSlideDirection(
    tabs.value.map((t) => t.key),
    to,
    from,
  );
  void nextTick(syncInk);
});
watch(tabs, () => void nextTick(syncInk));

/** VS-09：三种沉浸页布局，设置页用**缩略图卡片**让需求方先看到版式再选（不是只给个名字） */
const layouts: { key: ImLayout; label: string }[] = [
  { key: "duo", label: "经典双栏" },
  { key: "center", label: "沉浸歌词" },
  { key: "poster", label: "海报背景" },
];

const roleLabel = computed(() => {
  if (!auth.authEnabled) return "门禁关闭（全功能开放）";
  if (auth.isAdmin) return "管理员";
  if (auth.isVisitor) return "访客";
  return "未登录";
});

async function signOut(): Promise<void> {
  await auth.logout();
  await router.push({ name: "local" });
}
</script>

<template>
  <section>
    <div class="page-head">
      <h1>设置</h1>
    </div>

    <!-- 顶栏 Tab：行为层用 Reka（v4.60）——role=tablist/tab、aria-selected、
         左右方向键在选项间移动、Home/End 跳到首尾，都是它自带的；
         面板必须一起包进 TabsContent，否则 aria-controls 会指向不存在的面板。
         样式仍然全是我们自己的（global.css 的 .tabs/.tab，选中态挂 data-state="active"）。
         aria-label 得自己给：Reka 会给 tablist 角色，但不会替你起名字（v5.4 实测补上）——
         没有名字时屏幕阅读器只会念“标签列表”，不知道这组标签是干什么的。 -->
    <TabsRoot v-model="active" :style="{ '--panel-dir': dir }">
      <div ref="tabsWrapRef" class="tabs-wrap" :class="{ 'is-ready': inkReady }">
        <TabsList class="tabs" aria-label="设置分组">
          <TabsTrigger v-for="tab in tabs" :key="tab.key" :value="tab.key" class="tab">
            {{ tab.label }}
          </TabsTrigger>
        </TabsList>
        <!-- 下划线指示条：位置/宽度由 JS 写原始值（v5.6），装饰物所以 aria-hidden -->
        <span
          class="tabs__ink"
          aria-hidden="true"
          :style="{ '--ink-x': `${ink.x}px`, '--ink-w': `${ink.w}px` }"
        />
      </div>

      <!-- 外观 -->
      <TabsContent value="appearance">
        <div class="set-card card">
          <b>主题</b>
          <div class="set-row">
            <span>模式</span>
            <div class="seg">
              <button :class="{ active: theme.mode === 'dark' }" @click="theme.setTheme('dark')">
                深色
              </button>
              <button :class="{ active: theme.mode === 'light' }" @click="theme.setTheme('light')">
                浅色
              </button>
            </div>
          </div>
          <div class="set-row">
            <span>材质</span>
            <div class="seg">
              <button
                :class="{ active: theme.material === 'islands' }"
                @click="theme.setMaterial('islands')"
              >
                玻璃浮岛
              </button>
              <button
                :class="{ active: theme.material === 'flat' }"
                @click="theme.setMaterial('flat')"
              >
                实心面板
              </button>
            </div>
          </div>
          <div class="set-note">
            模式默认跟随系统，手动切换后记住选择。<br />
            <b>玻璃浮岛</b>＝半透明玻璃面板，页面底色与光晕会透上来；<b>实心面板</b>＝中性底色 +
            实心面板，玻璃只留给浮在内容之上的层（播放条、弹层等）。
          </div>
        </div>
        <div class="set-card card">
          <b>沉浸式播放页</b>
          <div class="set-row set-row--stack">
            <span>布局</span>
            <div class="lay-cards">
              <button
                v-for="item in layouts"
                :key="item.key"
                class="lay-card"
                :class="{ active: theme.layout === item.key }"
                :aria-pressed="theme.layout === item.key"
                @click="theme.setLayout(item.key)"
              >
                <span class="lay-thumb" :class="`lay-thumb--${item.key}`" aria-hidden="true" />
                <b>{{ item.label }}</b>
              </button>
            </div>
          </div>
          <div class="set-note">点播放条左侧的封面即可展开，选择按设备记忆。</div>
        </div>
      </TabsContent>

      <!-- 账户 -->
      <TabsContent value="account">
        <div class="set-card card">
          <b>账户</b>
          <div class="set-row">
            <span>当前身份</span>
            <span class="badge badge--accent">{{ roleLabel }}</span>
          </div>
          <div class="set-note">
            未登录时只能播放本地文件；访客密码可听云端曲库与在线音源；管理员密码额外解锁管理控制台。
          </div>
          <div v-if="auth.authEnabled" class="set-actions">
            <button class="btn" @click="signOut">
              <IconSignOut class="icon" />
              退出登录
            </button>
          </div>
        </div>
      </TabsContent>

      <!-- 在线音源 -->
      <TabsContent value="online">
        <div class="set-card card">
          <b>网易云</b>
          <div class="set-row">
            <span>连接状态</span>
            <span class="badge" :class="{ 'badge--accent': config.onlineEnabled }">
              {{ config.onlineEnabled ? "已配置" : "未配置" }}
            </span>
          </div>
          <div class="set-note">
            音源地址在部署时用环境变量 NETEASE_API_BASE
            配置；未配置时"在线搜索"入口隐藏，这里只作状态展示。
          </div>
        </div>
        <div class="set-card card">
          <b>QQ 音乐 / 酷狗</b>
          <div class="set-note">还在计划中，接入后会在这里显示连接状态。</div>
        </div>
      </TabsContent>

      <!-- 快捷键 -->
      <TabsContent value="keys">
        <div class="set-card card">
          <b>播放快捷键</b>
          <div class="set-row"><span>播放 / 暂停</span><kbd>空格</kbd></div>
          <div class="set-row">
            <span>快退 / 快进 5 秒</span><span><kbd>←</kbd><kbd>→</kbd></span>
          </div>
          <div class="set-row">
            <span>音量 ±5%</span><span><kbd>↑</kbd><kbd>↓</kbd></span>
          </div>
          <div class="set-note">
            随时随地可用（沉浸页也一样）。焦点在输入框里时不生效——那些键要留给输入框。
          </div>
        </div>
      </TabsContent>

      <!-- 音效 -->
      <TabsContent value="fx">
        <div class="set-card card">
          <b>均衡器与音效</b>
          <div class="set-note">
            10 段图形均衡器（31Hz~16kHz）、整体增益、预设与自定义曲线稍后上线，设置会存在本机。
          </div>
        </div>
      </TabsContent>

      <!-- 管理（仅管理员） -->
      <TabsContent value="admin">
        <div class="set-card card">
          <b>管理控制台</b>
          <div class="set-note">上传歌曲、曲库管理、存储统计与索引重建（3.12，仅管理员）。</div>
          <div class="set-actions">
            <RouterLink class="btn btn-primary" :to="{ name: 'console-songs' }"
              >打开管理控制台</RouterLink
            >
          </div>
        </div>
      </TabsContent>

      <!-- 关于 -->
      <TabsContent value="about">
        <div class="set-card card">
          <b>轻听音乐</b>
          <div class="set-row"><span>版本</span><span>v0.1.0 · 开发中</span></div>
          <div class="set-row"><span>形态</span><span>私有部署 · 仅供个人学习研究</span></div>
          <div class="set-note">本地 + 自有云端 + 在线聚合的个人音乐中心。</div>
        </div>
      </TabsContent>
    </TabsRoot>
  </section>
</template>

<style scoped>
kbd {
  display: inline-block;
  margin-left: 6px;
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-strong);
  font-family: inherit;
  font-size: 11.5px;
  color: var(--text-2);
}

/* ---------- 歌词页布局：缩略图卡片（VS-09） ----------
   卡片里画的是**版式本身**（封面/彩胶在哪、歌词在哪），不是装饰：
   需求方选的是“歌词摆在哪”，一张小图比一个名字信息量大得多。
   线条用一条重复渐变画（同一套行节奏），三种布局只换摆位。 */
.set-row--stack {
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
}

.lay-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.lay-card {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 8px 8px 6px;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-control);
  background: var(--glass-bg);
  transition:
    border-color 0.15s,
    background 0.15s;
}

.lay-card:hover {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--glass-border));
}

.lay-card.active {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.lay-card b {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
  text-align: center;
}

.lay-card.active b {
  color: var(--text-1);
}

.lay-thumb {
  position: relative;
  width: 92px;
  height: 54px;
  border-radius: 6px;
  /* 缩略图 = 一块“屏幕”，所以用页面底色，不用卡片色 */
  background: var(--bg-base);
  border: 1px solid var(--glass-border);
  overflow: hidden;
}

/* 歌词三行 */
.lay-thumb::after {
  content: "";
  position: absolute;
  height: 20px;
  background: repeating-linear-gradient(180deg, var(--text-3) 0 2px, transparent 2px 7px);
  opacity: 0.6;
}

/* 经典双栏：左封面 + 右三行 */
.lay-thumb--duo::before {
  content: "";
  position: absolute;
  left: 8px;
  top: 14px;
  width: 26px;
  height: 26px;
  border-radius: 5px;
  background: linear-gradient(135deg, var(--cv1), var(--cv2));
}

.lay-thumb--duo::after {
  left: 42px;
  right: 8px;
  top: 17px;
}

/* 沉浸歌词：只有居中的三行 */
.lay-thumb--center::after {
  left: 26px;
  right: 26px;
  top: 17px;
}

/* 海报背景：右上角一张**悬出画面**的彩胶 + 左边三行（彩胶被框边裁掉一角，正是它的版式） */
.lay-thumb--poster::before {
  content: "";
  position: absolute;
  right: -9px;
  top: -9px;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: conic-gradient(from 140deg, var(--cv1), var(--cv2), var(--cv1));
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.35);
}

.lay-thumb--poster::after {
  left: 8px;
  right: 46px;
  top: 17px;
}
</style>
