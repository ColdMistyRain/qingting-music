<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from "reka-ui";
import IconArrowClockwise from "~icons/ph/arrows-clockwise";
import IconCheckCircle from "~icons/ph/check-circle-fill";
import IconQrCode from "~icons/ph/qr-code";
import { useOnlineStore } from "@/stores/online";
import { showToast } from "@/utils/toast";
import { isTopLayer, popTopLayer, pushTopLayer } from "@/utils/topLayer";

/**
 * 网易云扫码登录弹窗（ON-10 / v6.30）。
 *
 * 流程：打开 → 取二维码（key + data URL 图片）→ 每 2.5 秒轮询一次状态 →
 * 「等待扫码 → 已扫码待确认 → 成功（会话已在服务端落盘）」。二维码约 3 分钟会过期：
 * 过期后停在「已过期 + 重新取码」上，不自动重取 —— 用户看得见发生了什么。
 *
 * 组件约定与 ConfirmDialog 完全同一套（Reka Dialog 行为层 + 自绘外衣）：
 * 样式写在**非 scoped** 的 `<style>`（Teleport 后 scoped 属性不跟过去，坑 6）、
 * `force-mount` 常驻 DOM 播收起动画（关闭态必须 `visibility: hidden`，坑 18；visibility
 * 的过渡两个方向分开写，坑 19）、Esc 归 topLayer 最上层（坑 14/24）、过渡**只做透明度**
 * （面板带 blur，动 transform 每帧重算模糊，真机上“卡一下”，v5.54）。
 */
const props = withDefaults(defineProps<{ open: boolean; provider?: "netease" | "qq" }>(), {
  provider: "netease",
});
const emit = defineEmits<{ close: []; loggedIn: [] }>();

const online = useOnlineStore();

/** 文案随音源走（QQ 走微信通道扫码） */
const PROVIDER_TEXT: Record<"netease" | "qq", { title: string; scan: string; app: string }> = {
  netease: { title: "登录网易云账号", scan: "用网易云音乐 App 扫一扫", app: "网易云账号" },
  qq: { title: "登录 QQ 音乐", scan: "用微信扫一扫", app: "QQ 音乐账号" },
};
const providerText = () => PROVIDER_TEXT[props.provider];

type Phase = "loading" | "ready" | "expired" | "success" | "error";
const phase = ref<Phase>("loading");
const scanned = ref(false);
const errorText = ref("");
/** 正在展示的那份二维码：关闭动画期间内容不能塌（与 ConfirmDialog 同款副本，坑 18③） */
const shownQr = shallowRef("");
const key = ref("");
/** 登录通道（仅 QQ 卡有：wechat 微信扫 / qq QQ App 扫 —— 需求方参考外部案例定的双通道切换） */
const channel = ref<"wechat" | "qq">("wechat");
let pollTimer: ReturnType<typeof setInterval> | null = null;

function scanHint(): string {
  if (props.provider === "qq") return channel.value === "qq" ? "用 QQ 音乐 App 扫一扫" : "用微信扫一扫";
  return "用网易云音乐 App 扫一扫";
}

const PHASE_TEXT: Record<Phase, string> = {
  loading: "正在取二维码…",
  ready: "",
  expired: "二维码已过期",
  success: "登录成功",
  error: "出了点问题",
};

function stopPolling(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/** 取一次二维码并开始轮询（打开与「重新取码」都走这里） */
async function start(): Promise<void> {
  stopPolling();
  phase.value = "loading";
  scanned.value = false;
  errorText.value = "";
  try {
    const login = await online.startQrLogin(
      props.provider,
      props.provider === "qq" ? channel.value : undefined,
    );
    key.value = login.key;
    shownQr.value = login.qrDataUrl;
    phase.value = "ready";
    pollTimer = setInterval(() => void poll(), 2500);
  } catch (error) {
    phase.value = "error";
    errorText.value = error instanceof Error ? error.message : "二维码没能取到";
  }
}

async function poll(): Promise<void> {
  if (!key.value) return;
  try {
    const result = await online.checkQrLogin(props.provider, key.value);
    if (result.state === "scanned") scanned.value = true;
    if (result.state === "expired") {
      stopPolling();
      phase.value = "expired";
      return;
    }
    if (result.state === "success") {
      stopPolling();
      phase.value = "success";
      emit("loggedIn");
      // 让「登录成功」被看见再收起；此刻用户大概率正看着手机
      setTimeout(() => emit("close"), 900);
    }
  } catch {
    // 单次轮询失败（网络抖动）不打断流程，下一轮再试
  }
}

/** 上面那层是谁由 topLayer 登记处说了算：它决定 Esc 该不该由我们吃掉 */
let layerId: number | null = null;

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      if (layerId === null) layerId = pushTopLayer();
      channel.value = "wechat";
      void start();
      return;
    }
    stopPolling();
    key.value = "";
    if (layerId !== null) {
      popTopLayer(layerId);
      layerId = null;
    }
  },
);

// 切通道 = 换二维码：重新取码（unikey 里密封着通道，create/check 自动跟随）
watch(channel, () => {
  if (props.open) void start();
});

function onKeydown(event: KeyboardEvent): void {
  if (!props.open || event.key !== "Escape") return;
  if (layerId === null || !isTopLayer(layerId)) return;
  event.stopPropagation();
  finish();
}

/** 默认焦点给「取消/完成」；挂 Reka 的 open-auto-focus：force-mount 下它每次打开都会补发 */
function onOpenAutoFocus(event: Event): void {
  event.preventDefault();
}

function finish(): void {
  if (phase.value === "success") {
    const nickname =
      props.provider === "qq"
        ? (online.qqSession?.profile?.nickname ?? "QQ 音乐账号")
        : (online.profile?.nickname ?? "网易云账号");
    showToast({ title: `已登录 ${nickname}` });
  }
  emit("close");
}

onMounted(() => window.addEventListener("keydown", onKeydown, true));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown, true);
  stopPolling();
  if (layerId !== null) {
    popTopLayer(layerId);
    layerId = null;
  }
});
</script>

<template>
  <DialogRoot :open="props.open" @update:open="(value) => { if (!value) finish(); }">
    <DialogPortal>
      <!-- force-mount：常驻 DOM 才能播收起动画；关闭态的可见性与点击全由 CSS 拿走 -->
      <DialogOverlay class="qr-scrim" force-mount />
      <DialogContent class="qr-card" force-mount @open-auto-focus="onOpenAutoFocus">
        <DialogTitle class="qr-title">{{ providerText().title }}</DialogTitle>
        <DialogDescription class="qr-desc">
          登录后可以听这个账号能听的歌。登录保存在这台浏览器里，换浏览器需要重新扫码。
        </DialogDescription>

        <!-- 登录通道双卡（仅 QQ，v6.57：需求方给的参考案例即此形态）；
             微信单通道的网易云不出现 -->
        <div v-if="props.provider === 'qq'" class="qr-chans" role="radiogroup" aria-label="登录方式">
          <button
            type="button"
            class="qr-chan"
            :class="{ 'is-on': channel === 'qq' }"
            role="radio"
            :aria-checked="channel === 'qq'"
            @click="channel = 'qq'"
          >
            <span class="qr-chan__name">QQ 扫码</span>
            <IconCheckCircle v-if="channel === 'qq'" class="qr-chan__check" />
          </button>
          <button
            type="button"
            class="qr-chan"
            :class="{ 'is-on': channel === 'wechat' }"
            role="radio"
            :aria-checked="channel === 'wechat'"
            @click="channel = 'wechat'"
          >
            <span class="qr-chan__name">微信扫码</span>
            <IconCheckCircle v-if="channel === 'wechat'" class="qr-chan__check" />
          </button>
        </div>

        <div class="qr-stage">
          <img
            v-if="phase === 'ready' || phase === 'success'"
            class="qr-img"
            :class="{ 'qr-img--done': phase === 'success' }"
            :src="shownQr"
            :alt="`${providerText().title}二维码`"
          />
          <div v-else-if="phase === 'loading'" class="qr-holding">
            <IconQrCode class="icon" />
          </div>
          <div v-else class="qr-holding">
            <span>{{ phase === "expired" ? "二维码已过期" : errorText || "出了点问题" }}</span>
            <button class="btn" @click="start">
              <IconArrowClockwise class="icon" />
              重新取码
            </button>
          </div>
        </div>

        <p class="qr-state" aria-live="polite">
          {{
            scanned && phase === "ready"
              ? "已扫码，请在手机上确认"
              : phase === "ready"
                ? scanHint()
                : PHASE_TEXT[phase]
          }}
        </p>

        <div class="qr-actions">
          <button type="button" class="btn" @click="finish">
            {{ phase === "success" ? "完成" : "取消" }}
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style>
/* ⚠️ 非 scoped：内容被 Teleport 到 body，scoped 的 [data-v-x] 不会跟过去（v4.60）。前缀 qr- 隔离。 */
.qr-scrim {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: var(--scrim);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  /* visibility 是离散属性，“过渡过半才翻转”：隐藏等淡出播完（延迟 = 时长）、显示立即生效（坑 19） */
  transition:
    opacity 0.2s ease,
    visibility 0s 0.2s;
}

.qr-scrim[data-state="open"] {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transition:
    opacity 0.2s var(--ease-ios),
    visibility 0s;
}

/* 登录通道双卡（仅 QQ）：两枚等宽按钮，选中 = 主题色描边 + 对勾（参考需求方给的案例形态） */
.qr-chans {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}

.qr-chan {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 9px 10px;
  border-radius: var(--radius-control);
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  color: var(--text-2);
  font-size: 12.5px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}

.qr-chan.is-on {
  border-color: var(--accent-line);
  color: var(--accent);
}

.qr-chan__check {
  width: 15px;
  height: 15px;
}

/* 居中不用 transform（与入场动画打架，也与 blur 的重栅格化代价有关）：inset + margin auto */
.qr-card {
  position: fixed;
  inset: 0;
  margin: auto;
  z-index: 101;
  display: flex;
  flex-direction: column;
  width: min(320px, 92vw);
  height: fit-content;
  padding: 20px 22px 18px;
  border-radius: var(--radius-panel);
  border: 1px solid var(--glass-border);
  /* 材质取「大面」档（--tray-*，与确认框同一档）：弹窗背后常是成片的正文 */
  background: var(--tray-bg);
  backdrop-filter: var(--tray-blur);
  -webkit-backdrop-filter: var(--tray-blur);
  box-shadow: var(--panel-sheen), var(--panel-shadow);
  opacity: 0;
  visibility: hidden;
  /* 只做透明度：面板带 blur，动 transform 每帧重算模糊区域（v5.54） */
  transition:
    opacity 0.2s ease,
    visibility 0s 0.2s;
}

.qr-card[data-state="open"] {
  opacity: 1;
  visibility: visible;
  transition:
    opacity 0.2s var(--ease-ios),
    visibility 0s;
}

.qr-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-1);
}

.qr-desc {
  margin-top: 4px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text-3);
}

.qr-stage {
  display: grid;
  place-items: center;
  margin: 16px auto 0;
  width: 176px;
  height: 176px;
  border-radius: var(--radius-md);
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
}

.qr-img {
  width: 160px;
  height: 160px;
}

.qr-img--done {
  opacity: 0.45;
}

.qr-holding {
  display: grid;
  place-items: center;
  gap: 10px;
  color: var(--text-3);
  font-size: 12.5px;
  text-align: center;
}

.qr-holding .icon {
  width: 40px;
  height: 40px;
}

.qr-state {
  margin-top: 12px;
  text-align: center;
  font-size: 12.5px;
  color: var(--text-2);
}

.qr-actions {
  display: flex;
  justify-content: center;
  margin-top: 16px;
}
</style>
