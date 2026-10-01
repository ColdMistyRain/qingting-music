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
      { path: "local", name: "local", component: () => import("@/views/LocalView.vue"), meta: { anonymous: true } },
      { path: "library", name: "library", component: () => import("@/views/LibraryView.vue") },
      { path: "online", name: "online", component: () => import("@/views/OnlineView.vue") },
      {
        path: "playlist/:id",
        name: "playlist",
        component: () => import("@/views/PlaylistView.vue"),
        props: true,
      },
      { path: "settings", name: "settings", component: () => import("@/views/SettingsView.vue") },
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
    return auth.canUseServer ? { name: "library" } : { name: "login", query: { redirect: to.fullPath } };
  }

  return true;
});
