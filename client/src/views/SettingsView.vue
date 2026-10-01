<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from "reka-ui";
import IconSignOut from "~icons/ph/sign-out";
import { useAuthStore } from "@/stores/auth";
import { useConfigStore } from "@/stores/config";
import { useThemeStore } from "@/stores/theme";

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
         面板必须一起包进 TabsContent，否则 aria-controls 会指向不存在的面板。 -->
    <TabsRoot v-model="active">
      <TabsList class="tabs">
        <TabsTrigger v-for="tab in tabs" :key="tab.key" :value="tab.key" class="tab">
          {{ tab.label }}
        </TabsTrigger>
      </TabsList>

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
            默认跟随系统，手动切换后记忆选择（VS-08）。全部颜色走 CSS 变量，切换即时生效。<br />
            <b>材质</b>可切换比对：玻璃浮岛＝半透明玻璃岛 + 封面光晕 + 描边投影； 实心面板＝中性底色
            + 实心面板，玻璃只留给浮在内容之上的层（播放条等）。
          </div>
        </div>
        <div class="set-card card">
          <b>歌词页布局</b>
          <div class="set-row">
            <span>沉浸式播放页</span>
            <div class="seg">
              <button :class="{ active: theme.layout === 'duo' }" @click="theme.setLayout('duo')">
                经典双栏
              </button>
              <button
                :class="{ active: theme.layout === 'center' }"
                @click="theme.setLayout('center')"
              >
                沉浸歌词
              </button>
            </div>
          </div>
          <div class="set-note">
            在播放条点左侧展开沉浸页即可看到，选择按设备记忆。 经典双栏＝封面左 ·
            歌词右；沉浸歌词＝纯歌词居中。<br />
            海报背景（彩胶）随后续版本加入（VS-09）。
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
            未登录时仅可播放本地文件；访客密码可听云端曲库与在线音源；管理员密码额外解锁管理控制台（AC-01/03）。
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
            音源地址由部署者经环境变量 NETEASE_API_BASE
            配置（ON-04）；未配置时"在线搜索"入口隐藏，此处仅作状态展示。
          </div>
        </div>
        <div class="set-card card">
          <b>QQ 音乐 / 酷狗</b>
          <div class="set-note">计划后续接入，届时在此显示各自连接状态。</div>
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
            <span>音量调节</span><span><kbd>↑</kbd><kbd>↓</kbd></span>
          </div>
          <div class="set-note">
            空格键播放/暂停马上就可以用；快退与音量键随后续版本补上（PL-08）。
          </div>
        </div>
      </TabsContent>

      <!-- 音效 -->
      <TabsContent value="fx">
        <div class="set-card card">
          <b>均衡器与音效</b>
          <div class="set-note">
            10 段图形均衡器（31Hz~16kHz）、整体增益、预设与自定义曲线、A/B
            对比，随后续版本上线（PL-13）；设置按设备本地保存。
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
          <div class="set-row"><span>版本</span><span>v0.1.0 · M1 开发中</span></div>
          <div class="set-row"><span>形态</span><span>私有部署 · 仅供个人学习研究</span></div>
          <div class="set-note">
            本地 + 自有云端 + 在线聚合的个人音乐中心 · 需求文档见仓库根目录。
          </div>
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
</style>
