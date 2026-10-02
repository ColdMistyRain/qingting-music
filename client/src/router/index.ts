import { defineComponent, h } from "vue";
import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import { useAuthStore } from "@/stores/auth";

/** 根路径占位：实际落地页由守卫按角色决定（访客/管理员进音乐库，未登录进本地播放） */
const Blank = defineComponent({ name: "BlankView", render: () => h("div") });

const routes: RouteRecordRaw[] = [
  {
    // 沉浸式播放页（VS-03）：从播放条点开，整页覆盖主布局；只用本地播放能力，不需服务端权限
    path: "/now",
    name: "now",
    component: () => import("@/views/ImmersiveView.vue"),
    meta: { anonymous: true },
  },
  {
    path: "/login",
    name: "login",
    component: () => import("@/views/LoginView.vue"),
    meta: { public: true },
  },
  {
    path: "/",
    component: () => import("@/layouts/PlayerLayout.vue"),
    children: [
      { path: "", name: "home", component: Blank },
      // 未登录唯一可用入口（AC-01）
      {
        path: "local",
        name: "local",
        component: () => import("@/views/LocalView.vue"),
        meta: { anonymous: true },
      },
      { path: "library", name: "library", component: () => import("@/views/LibraryView.vue") },
      {
        path: "favorites",
        name: "favorites",
        component: () => import("@/views/ListeningView.vue"),
        props: { mode: "favorites" },
      },
      {
        path: "recent",
        name: "recent",
        component: () => import("@/views/ListeningView.vue"),
        props: { mode: "recent" },
      },
      { path: "online", name: "online", component: () => import("@/views/OnlineView.vue") },
      {
        path: "playlist/:id",
        name: "playlist",
        component: () => import("@/views/PlaylistView.vue"),
        props: true,
      },
      {
        path: "settings",
        name: "settings",
        component: () => import("@/views/SettingsView.vue"),
        // 设置页在**未登录**下也要能进（v5.20）：主题 / 沉浸页布局 / 快捷键 / 音效
        // 都是纯本地偏好，而侧栏在未登录时同样会显示「设置」—— 以前点它会被守卫扔回登录页要
        // 密码（需求方：“为什么点击设置需要密码？”）。服务端相关的分组（在线音源）
        // 在页面里按角色隐藏；管理台仍由下面的 meta.admin 挡住。
        meta: { anonymous: true },
      },
    ],
  },
  {
    path: "/admin",
    component: () => import("@/layouts/ConsoleLayout.vue"),
    meta: { admin: true },
    children: [
      { path: "", redirect: { name: "console-songs" } },
      {
        path: "overview",
        name: "console-overview",
        component: () => import("@/views/console/ConsoleOverviewView.vue"),
      },
      {
        path: "songs",
        name: "console-songs",
        component: () => import("@/views/console/ConsoleSongsView.vue"),
      },
      {
        path: "upload",
        name: "console-upload",
        component: () => import("@/views/console/ConsoleUploadView.vue"),
      },
    ],
  },
  { path: "/:pathMatch(.*)*", redirect: { name: "home" } },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  await auth.ensureLoaded();

  // 门禁关闭的环境直接跳过登录页（AC-07）
  if (to.name === "login") {
    return auth.authEnabled ? true : { name: auth.isAdmin ? "library" : "local" };
  }

  // 根路径：按身份落到各自的落地页
  if (to.name === "home") {
    return { name: auth.canUseServer ? "library" : "local" };
  }

  // 未登录：仅可进入本地播放（AC-01）
  const anonymousAllowed = to.matched.some((record) => record.meta.anonymous);
  if (auth.authEnabled && !auth.canUseServer && !anonymousAllowed) {
    return { name: "login", query: { redirect: to.fullPath } };
  }

  // 管理台：仅 admin（AD-04）。未登录去登录页；已登录但角色不足（visitor）回音乐库，
  // 对应接口侧的 401 / 403 两级语义（AC-03）
  if (to.matched.some((record) => record.meta.admin) && !auth.isAdmin) {
    return auth.canUseServer
      ? { name: "library" }
      : { name: "login", query: { redirect: to.fullPath } };
  }

  return true;
});
