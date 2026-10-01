<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import IconLockSimple from "~icons/ph/lock-simple";
import { ApiError } from "@/api/http";
import { useAuthStore } from "@/stores/auth";

/** 登录页（AC-07）：玻璃拟态卡片 + 单密码输入，后端自动识别角色 */
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const password = ref("");
const error = ref("");
const busy = ref(false);

async function submit(): Promise<void> {
  if (busy.value) return;
  error.value = "";
  busy.value = true;
  try {
    await auth.login(password.value);
    const redirect = typeof route.query.redirect === "string" ? route.query.redirect : "";
    await router.replace(redirect || { name: "library" });
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "登录失败，请稍后再试";
  } finally {
    busy.value = false;
  }
}

/** 未登录入口：只使用本地播放，不经服务器（AC-01） */
function listenLocal(): void {
  void router.push({ name: "local" });
}
</script>

<template>
  <section class="login">
    <div class="login-card glass">
      <div class="login-logo"><span class="note">♫</span>轻听音乐</div>
      <div class="login-sub">QING TING · 私有云音乐中心</div>

      <form @submit.prevent="submit">
        <label class="sr-only" for="login-pwd">访问密码</label>
        <input
          id="login-pwd"
          v-model="password"
          class="input"
          type="password"
          placeholder="请输入访问密码"
          autocomplete="current-password"
        />
        <button class="btn btn-primary login-submit" type="submit" :disabled="busy">
          {{ busy ? "登录中…" : "登录" }}
        </button>
      </form>

      <p v-if="error" class="login-error">{{ error }}</p>

      <div class="login-div" />

      <button class="login-guest" type="button" @click="listenLocal">
        <IconLockSimple class="icon" />
        先听听本地歌（未登录）
      </button>

      <p class="login-note">
        访问密码由部署者在环境变量中设置（USER_PASSWORD /
        ADMIN_PASSWORD）；两把都未配置时门禁关闭，不会出现本页（AC-05）
      </p>
    </div>
  </section>
</template>

<style scoped>
.login {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  height: 100vh;
  padding: 24px;
}

.login-card {
  width: 100%;
  max-width: 380px;
  padding: 34px 32px 26px;
  text-align: center;
}

.login-logo {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 1px;
}

.login-logo .note {
  color: var(--accent);
  margin-right: 6px;
}

.login-sub {
  font-size: 10.5px;
  letter-spacing: 2.5px;
  color: var(--text-3);
  margin: 8px 0 26px;
}

.login-submit {
  width: 100%;
  justify-content: center;
  margin-top: 12px;
}

.login-error {
  margin-top: 12px;
  font-size: 12.5px;
  color: var(--danger);
}

.login-div {
  height: 1px;
  background: var(--glass-border);
  margin: 22px 0 16px;
}

.login-guest {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  color: var(--text-2);
}

.login-guest:hover {
  color: var(--text-1);
}

.login-guest .icon {
  width: 15px;
  height: 15px;
}

.login-note {
  margin-top: 18px;
  font-size: 11px;
  line-height: 1.7;
  color: var(--text-3);
}
</style>
