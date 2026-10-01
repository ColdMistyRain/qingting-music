<script setup lang="ts">
import { RouterLink } from "vue-router";
import IconGearSix from "~icons/ph/gear-six";
import { useNavItems } from "@/composables/useNavItems";

/** 手机底部标签栏（RT-02）。≥768px 不渲染样式（display:none），桌面观感不变。 */
const items = useNavItems();
</script>

<template>
  <nav class="tabbar glass" aria-label="主导航">
    <RouterLink
      v-for="item in items"
      :key="item.name"
      class="tab"
      active-class="active"
      :title="item.label"
      :to="{ name: item.name }"
    >
      <component :is="item.icon" class="icon" />
      <span class="lbl">{{ item.label }}</span>
    </RouterLink>

    <!-- 设置排最后一位：导航项本身不含它（见 composables/useNavItems.ts），
         侧栏把它放页脚、手机放这里，位置是各自布局的决定。 -->
    <RouterLink class="tab" active-class="active" title="设置" :to="{ name: 'settings' }">
      <IconGearSix class="icon" />
      <span class="lbl">设置</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
/* 桌面不出现：整个元素 display:none，比逐项隐藏干净（也不会占网格行） */
.tabbar {
  display: none;
}

@media (max-width: 767px) {
  .tabbar {
    display: flex;
    /* 外壳是 224px 侧栏 + 1fr + 84px 播放条的三行栅格（global.css）：
       手机上侧栏 display:none 变成非网格项，这里明写第三行，不靠自动放置去猜。 */
    grid-row: 3;
    grid-column: 1;
    /* 刘海屏/手势条：底部留出安全区，否则最后一行字被系统条压住 */
    padding-bottom: env(safe-area-inset-bottom);
    /* 只留一条上边界，靠 glass 自己的材质与内容分层（简约优先：不加装饰线） */
    border-top: 1px solid var(--glass-border);
  }
}

.tab {
  flex: 1 1 0;
  min-width: 0;
  /* 触摸目标 ≥44px（手指友好），图标在上、标签在下 */
  min-height: 52px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 6px 2px;
  color: var(--text-2);
  transition: color 0.15s;
}

/* 选中只改**文字色 + 字重**：颜色是状态、字重兜底（不只靠颜色区分状态，对色觉障碍友好）。
   不做底色胶囊 —— 底栏已经有材质层，再叠一块高亮会显得脏。 */
.tab.active {
  color: var(--accent);
  font-weight: 600;
}

.tab .icon {
  width: 22px;
  height: 22px;
}

.tab .lbl {
  font-size: 11px;
  line-height: 1.2;
  /* 标签过长（如“本地播放”）也不换行挤出格子 */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
</style>
