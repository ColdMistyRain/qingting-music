<script setup lang="ts">
import NavToggle from "@/components/NavToggle.vue";
import { computed, nextTick, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from "reka-ui";
import IconSignIn from "~icons/ph/sign-in";
import IconSignOut from "~icons/ph/sign-out";
import IconWarningCircle from "~icons/ph/warning-circle";
import SegmentedControl from "@/components/SegmentedControl.vue";
import EqualizerPanel from "@/components/EqualizerPanel.vue";
import OnlineQrDialog from "@/components/OnlineQrDialog.vue";
import { useActiveIndicator } from "@/composables/useActiveIndicator";
import { useAuthStore } from "@/stores/auth";
import { useConfigStore } from "@/stores/config";
import { useOnlineStore } from "@/stores/online";
import { useThemeStore, type ImLayout, type MaterialMode, type ThemeMode } from "@/stores/theme";
import { tabSlideDirection } from "@/utils/tabs";

/** 设置页（PRD 3.8）：顶部 Tab 形态，管理 Tab 仅管理员可见 */
const auth = useAuthStore();
const config = useConfigStore();
const theme = useThemeStore();
const online = useOnlineStore();
const router = useRouter();

/* ---------- 网易云账号（ON-10）：扫码登录 / 退出 ---------- */
const qrOpen = ref(false);

function openQr(): void {
  qrOpen.value = true;
}

async function logoutNetease(): Promise<void> {
  await online.logout();
}

interface SettingsTab {
  key: string;
  label: string;
}

const tabs = computed<SettingsTab[]>(() => {
  const list: SettingsTab[] = [
    { key: "appearance", label: "外观" },
    { key: "account", label: "账户" },
  ];
  // 在线音源是**服务端**的事：未登录（仅本地播放，AC-01）时这个分组没有意义，直接不出现
  if (auth.canUseServer) list.push({ key: "online", label: "在线音源" });
  list.push({ key: "keys", label: "快捷键" }, { key: "fx", label: "音效" });
  if (auth.isAdmin) list.push({ key: "admin", label: "管理" });
  list.push({ key: "about", label: "关于" });
  return list;
});

const active = ref("appearance");

// 身份变化会把分组抽走（退出登录后“在线音源”／“管理”消失）：
// 当前选中的分组如果没了，退回“外观”—— 否则面板会停在一个不存在的值上（白屏）。
watch(tabs, () => {
  if (!tabs.value.some((t) => t.key === active.value)) active.value = "appearance";
});

/* 下划线指示条（v5.6）：“会滑过去”靠的是一条共享元素，所以得知道当前 Tab 在哪、多宽。
   量坐标这件事抽成了 `useActiveIndicator`（v5.9）—— 分段控件的选中底板干的是同一件事，
   两处共用一份实现；这里只把量到的两个原始值写成 CSS 变量，怎么滑留在 CSS。 */
const {
  setRoot: setTabsWrap,
  rect: inkRect,
  ready: inkReady,
  sync: syncInk,
} = useActiveIndicator('[role="tab"][data-state="active"]', { keepInView: true });

const inkStyle = computed(() => ({
  "--ink-x": `${inkRect.value.x}px`,
  "--ink-w": `${inkRect.value.w}px`,
}));

// 切换时内容往哪边滑（v5.7）：与下划线“往哪边滑”同一个方向——
// 选中项在列表里向后移就是从右边进来，向前移就从左边进来。
// 写成 CSS 变量挂在 TabsRoot 上（只写原始值 ±1，具体滑多少在 CSS）。
const dir = ref(1);

/** 面板滑入只在**真的切过 Tab** 之后才挂（v5.29）。
 *  动画是挂在面板内容上的（Reka 面板懒挂载，内容每次切换都重新创建），但这也意味着
 *  **整页重挂时会白播一次**：从沉浸页退回设置页就是这种情况 —— 一进去就看到内容从右边
 *  滑进来，像刚切过 Tab 一样。所以用持久标记闸住（与下划线那条 is-ready 同一个思路）。 */
const switched = ref(false);

// 点／键盘切换、以及“管理”Tab 因身份变化而出现时，都要重量一次
watch(active, (to, from) => {
  switched.value = true;
  dir.value = tabSlideDirection(
    tabs.value.map((t) => t.key),
    to,
    from,
  );
  void nextTick(syncInk);
});
watch(tabs, () => void nextTick(syncInk));

/* 分段控件（v5.9）：选项与绑定
   两个控件都走 `SegmentedControl`（Reka RadioGroup 行为 + 我们自绘的滑动底板）。 */
const modeOptions = [
  { value: "dark", label: "深色" },
  { value: "light", label: "浅色" },
] as const;

const materialOptions = [
  { value: "islands", label: "玻璃浮岛" },
  { value: "flat", label: "实心面板" },
] as const;

// v-model 需要可写计算属性：store 的 setter 要的类型比组件传出来的 string 窄，这里收口一次
const themeMode = computed({
  get: () => theme.mode,
  set: (value: string) => theme.setTheme(value as ThemeMode),
});

const themeMaterial = computed({
  get: () => theme.material,
  set: (value: string) => theme.setMaterial(value as MaterialMode),
});

/** VS-09：三种沉浸页布局，设置页用**缩略图卡片**让需求方先看到版式再选（不是只给个名字） */
const layouts: { key: ImLayout; label: string }[] = [
  { key: "duo", label: "经典双栏" },
  { key: "center", label: "沉浸歌词" },
  { key: "poster", label: "彩胶唱片" },
];

/** 光晕跟随节奏（v5.90）：布尔设置也用分段控件，与上面模式 / 材质同一套交互语言 */
const beatOptions = [
  { value: "on", label: "开" },
  { value: "off", label: "关" },
] as const;

const glowBeat = computed({
  get: () => (theme.glowBeat ? "on" : "off"),
  set: (value: string) => theme.setGlowBeat(value === "on"),
});

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
      <NavToggle />
      <h1>设置</h1>
    </div>

    <!-- 顶栏 Tab：行为层用 Reka（v4.60）——role=tablist/tab、aria-selected、
         左右方向键在选项间移动、Home/End 跳到首尾，都是它自带的；
         面板必须一起包进 TabsContent，否则 aria-controls 会指向不存在的面板。
         样式仍然全是我们自己的（global.css 的 .tabs/.tab，选中态挂 data-state="active"）。
         aria-label 得自己给：Reka 会给 tablist 角色，但不会替你起名字（v5.4 实测补上）——
         没有名字时屏幕阅读器只会念“标签列表”，不知道这组标签是干什么的。 -->
    <TabsRoot
      v-model="active"
      :class="{ 'is-switching': switched }"
      :style="{ '--panel-dir': dir }"
    >
      <div :ref="setTabsWrap" class="tabs-wrap" :class="{ 'is-ready': inkReady }">
        <TabsList class="tabs" aria-label="设置分组">
          <TabsTrigger v-for="tab in tabs" :key="tab.key" :value="tab.key" class="tab">
            {{ tab.label }}
          </TabsTrigger>
        </TabsList>
        <!-- 下划线指示条：位置/宽度由 JS 写原始值（v5.6），装饰物所以 aria-hidden -->
        <span class="tabs__ink" aria-hidden="true" :style="inkStyle" />
      </div>

      <!-- 外观 -->
      <TabsContent value="appearance">
        <div class="set-card card">
          <b>主题</b>
          <div class="set-row">
            <span>模式</span>
            <SegmentedControl v-model="themeMode" :options="modeOptions" />
          </div>
          <div class="set-row">
            <span>材质</span>
            <SegmentedControl v-model="themeMaterial" :options="materialOptions" />
          </div>
          <div class="set-note">
            模式默认跟随系统，手动切换后记住选择。<br />
            <b>玻璃浮岛</b>＝半透明玻璃面板，页面底色与光晕会透上来；<b>实心面板</b>＝中性底色 +
            全实心面，层级用投影表示。
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
                <span class="lay-thumb" :class="`lay-thumb--${item.key}`" aria-hidden="true">
                  <span class="lay-thumb__arm" />
                </span>
                <b>{{ item.label }}</b>
              </button>
            </div>
          </div>
          <div class="set-row">
            <span>光晕跟随节奏</span>
            <SegmentedControl v-model="glowBeat" :options="beatOptions" />
          </div>
          <div class="set-note">
            点播放条左侧的封面即可展开，选择按设备记忆。<br />
            <b>光晕跟随节奏</b
            >＝「彩胶唱片」布局下，外圈柔光跟着低频鼓点起伏（另两个布局用不上）；开了系统「减弱动效」时它也会自动关掉。
          </div>
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
            {{
              auth.canUseServer
                ? "未登录时只能播放本地文件；访客密码可听云端曲库与在线音源；管理员密码额外解锁管理控制台。"
                : "未登录：只能用本地文件。登录后可听云端曲库与在线音源，管理员还会解锁管理控制台。"
            }}
          </div>
          <div v-if="auth.authEnabled" class="set-actions">
            <button v-if="auth.canUseServer" class="btn" @click="signOut">
              <IconSignOut class="icon" />
              退出登录
            </button>
            <!-- 未登录时给一个入口，登录后回到这一页（否则要自己去翻侧栏） -->
            <RouterLink
              v-else
              class="btn btn-primary"
              :to="{ name: 'login', query: { redirect: '/settings' } }"
            >
              <IconSignIn class="icon" />
              去登录
            </RouterLink>
          </div>
        </div>
      </TabsContent>

      <!-- 在线音源 -->
      <TabsContent value="online">
        <!-- 读失败与“真的没配”是两件事（v6.10）：前者重试就行，后者才要去改环境变量 -->
        <div v-if="config.status === 'error'" class="strip">
          <IconWarningCircle class="icon" />
          <span>{{ config.error }}</span>
          <button class="btn btn-quiet" @click="config.load(true)">重试</button>
        </div>
        <div class="set-card card">
          <b>网易云</b>
          <div class="set-row">
            <span>音源状态</span>
            <span class="badge" :class="{ 'badge--accent': config.onlineEnabled }">
              {{ config.onlineEnabled ? "可用" : "不可用" }}
            </span>
          </div>
          <div class="set-note">
            音源随服务端内置（v6.29），开箱可用；部署者也可以用环境变量
            NETEASE_API_BASE 改接自己部署的音源服务。
          </div>
        </div>
        <div class="set-card card">
          <b>网易云账号</b>
          <div class="set-row">
            <span>登录状态</span>
            <span v-if="online.loggedIn" class="badge badge--accent">
              已登录 · {{ online.profile?.nickname ?? "网易云账号" }}
            </span>
            <span v-else class="badge">未登录</span>
          </div>
          <div class="set-row">
            <span>收藏的歌单</span>
            <button v-if="!online.loggedIn" class="btn btn-primary" @click="openQr">
              <IconSignIn class="icon" />
              扫码登录
            </button>
            <button v-else class="btn" @click="logoutNetease">
              <IconSignOut class="icon" />
              退出登录
            </button>
          </div>
          <div class="set-note">
            登录后可以在「在线搜索」里打开这个账号收藏的歌单（含 VIP
            曲目）。登录是这个服务器共享的一份，会话只存在部署者自己的服务器上。
          </div>
        </div>
        <div class="set-card card">
          <b>QQ 音乐 / 酷狗</b>
          <div class="set-note">还在计划中，接入后同样在这里扫码登录。</div>
        </div>
      </TabsContent>

      <!-- 快捷键 -->
      <TabsContent value="keys">
        <div class="set-card card">
          <b>播放快捷键</b>
          <div class="set-row">
            <span>播放 / 暂停</span><span class="keys"><kbd>空格</kbd></span>
          </div>
          <div class="set-row">
            <span>快退 / 快进 5 秒</span><span class="keys"><kbd>←</kbd><kbd>→</kbd></span>
          </div>
          <div class="set-row">
            <span>音量 ±5%</span><span class="keys"><kbd>↑</kbd><kbd>↓</kbd></span>
          </div>
          <div class="set-note">
            随时随地可用（沉浸页也一样）。焦点在输入框里时不生效——那些键要留给输入框。
          </div>
        </div>
      </TabsContent>

      <!-- 音效（均衡器，PL-13） -->
      <TabsContent value="fx">
        <EqualizerPanel />
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

    <!-- 扫码登录弹窗（页面级一份；成功后把歌单缓存刷掉，下次进在线页重新拉） -->
    <OnlineQrDialog
      :open="qrOpen"
      @close="qrOpen = false"
      @logged-in="void online.loadPlaylists(true)"
    />
  </section>
</template>

<style scoped>
/* 键帽本体的配方在 global.css（v5.8：全站共用一份，别在这里再抄一次）；
   这里只管一组键之间的间距。 */
.keys {
  display: inline-flex;
  gap: 6px;
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

/* 海报背景：左歌词 + 右**整张**彩胶 + 唱臂（v5.85 起盘不再溢出画面 ——
   缩略图从前画的是“右上一角被框边裁掉的盘”，那是旧版式） */
.lay-thumb--poster::before {
  content: "";
  position: absolute;
  right: 7px;
  top: 12px;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  /* 盘体漩涡 + 中心封面标（两种色源都跟着封面走） */
  background:
    radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.55) 0 24%, transparent 24%),
    conic-gradient(from 140deg, var(--cv1), var(--cv2), var(--cv1));
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.3);
}

.lay-thumb--poster::after {
  left: 8px;
  right: 44px;
  top: 17px;
}

/* 唱臂（只给海报布局）：支点落在盘的 90% / 5%（盘在 right 7px / top 12px、径 30px
   时 = 81,13），落针态几乎竖直地搭在盘面外圈上 —— 与实况同一套几何，只是等比缩小 */
.lay-thumb__arm {
  display: none;
}

.lay-thumb--poster .lay-thumb__arm {
  display: block;
  position: absolute;
  left: 81px;
  top: 13px;
  width: 1.5px;
  height: 19px;
  border-radius: 1px;
  background: var(--text-2);
  transform-origin: top center;
  transform: rotate(5deg);
}

/* 支点底盘 */
.lay-thumb--poster .lay-thumb__arm::before {
  content: "";
  position: absolute;
  left: 50%;
  top: -2px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--text-2);
  transform: translateX(-50%);
}

/* 唱头 */
.lay-thumb--poster .lay-thumb__arm::after {
  content: "";
  position: absolute;
  left: 50%;
  bottom: -2px;
  width: 4px;
  height: 4.5px;
  border-radius: 1.5px;
  background: var(--text-2);
  transform: translateX(-50%);
}
</style>
