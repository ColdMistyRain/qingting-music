<script setup lang="ts">
import IconSkipBack from "~icons/ph/skip-back";
import IconSkipForward from "~icons/ph/skip-forward";
import AppTooltip from "@/components/AppTooltip.vue";
import ProgressBar from "@/components/ProgressBar.vue";
import QueuePopover from "@/components/QueuePopover.vue";
import VolumeControl from "@/components/VolumeControl.vue";
import { usePlayback } from "@/composables/usePlayback";
import { MOBILE_QUERY, useMediaQuery } from "@/composables/useMediaQuery";
import { formatTime } from "@/utils/format";

/**
 * 沉浸页底部控制与进度（VS-03：「底部居中控制与进度」；VS-09：三布局**共享**的子组件）。
 *
 * 状态与动作全部走 player store —— 与播放条是同一个来源，不存在"两套播放状态"。
 * 控件的**状态与交互**已经与播放条共用一份（`composables/usePlayback` 的模式/播放
 * 图标与总时长、`components/ProgressBar.vue` 的轨道与指针/键盘交互，v6.11）——
 * 这里只剩“这一排怎么排”，不再各写一套控件逻辑。
 *
 * ⚠️ **控件数要取奇数（v5.98）**：这一排是「模式 / 上一首 / 播放 / 下一首 / 音量」共 5 个
 * —— 奇数才有一枚落在正中，而它必须正是**播放键**（左右各两个、宽度也对称）。
 * 原先这里还有第六个（收藏），偶数时“正中”落在两组之间，需求方一眼就看出不对称。
 * 所以收藏键挪去了歌名旁边（`ImTitle`，歌曲强相关的动作归歌曲自己的位置）。
 */
const { player, modeIcon, playIcon, totalSeconds } = usePlayback();

/** 手机断点：走带键独占一排、其余控件收进次排（Salt Player 的控件分布），
 *  并且手机上多一枚**队列**入口 —— 迷你条为了留白把队列键收起了，
 *  这里是手机端唯一能打开播放队列的地方（Salt 的全屏播放页也有这一枚）。 */
const isMobile = useMediaQuery(MOBILE_QUERY);
</script>

<template>
  <div class="im-ctl">
    <div class="im-ctrls">
      <!-- 三组结构在桌面与手机共用，只是**排布**不同：
           桌面一行：模式 上一首 播放 下一首 音量（组间间距与键间距同为 20px，看不出分组）；
           手机也一行，但把队列换到最右：模式 上一首 播放 下一首 队列
           —— 需求方指定（模式在上一曲左侧、列表在下一首右侧），音量交给系统音量键，整枚收起。
           所以队列与音量放同一组、顺序相邻：桌面显音量（队列 v-if 不渲染）。 -->
      <div class="im-ctrls__row">
        <AppTooltip :label="`播放模式：${player.modeLabel}`">
          <button class="ctl mode" @click="player.cycleMode()">
            <component :is="modeIcon" class="icon" />
          </button>
        </AppTooltip>
      </div>

      <div class="im-ctrls__row im-ctrls__row--primary">
        <AppTooltip label="上一首">
          <button class="ctl prev" :disabled="!player.hasTrack" @click="player.prev()">
            <IconSkipBack class="icon" />
          </button>
        </AppTooltip>
        <AppTooltip :label="player.playing ? '暂停（空格）' : '播放（空格）'">
          <button class="ctl play" :disabled="!player.hasTrack" @click="player.toggle()">
            <component :is="playIcon" class="icon" />
          </button>
        </AppTooltip>
        <AppTooltip label="下一首">
          <button class="ctl next" :disabled="!player.hasTrack" @click="player.next()">
            <IconSkipForward class="icon" />
          </button>
        </AppTooltip>
      </div>

      <div class="im-ctrls__row">
        <!-- 队列入口只在手机上出现：迷你条把队列键收起了，这里是手机唯一入口 -->
        <QueuePopover v-if="isMobile" :label="`播放队列（${player.queue.length} 首）`" />

        <!-- 音量：与播放条共用同一个控件（components/VolumeControl.vue，v4.62）——
             两边不再各写一套，否则一定会走偏（这里原来是一条横条）。
             手机整枚收起（样式在下面），音量由系统音量键接管。 -->
        <VolumeControl />

        <!-- 收藏键不在这一排（v5.98）：它挪到了歌名旁边（ImTitle）—— ① 它是歌曲强相关的
             动作；② 这一排的控件数必须是奇数，加它就成了 6 个，正中那枚就不是播放键了。 -->
      </div>
    </div>

    <div class="im-progress">
      <span class="time">{{ formatTime(player.displaySeconds) }}</span>
      <!-- 轨道与播放条共用一份（`components/ProgressBar.vue`）：指针点/拖、键盘 ±5s、
           `role="slider"` 与 `aria-*` 都在那一处维护 -->
      <ProgressBar />
      <span class="time">{{ formatTime(totalSeconds) }}</span>
    </div>
  </div>
</template>

<style scoped>
.im-ctl {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  width: min(560px, 74vw);
}

/* 队列抽屉打开时会被淡出（规则在 QueuePopover 的非 scoped 样式里，靠 body:has(.q-sheet)）。
   这里有过渡，关抽屉那一刻才会淡回来而不是硬切。 */
.im-ctrls,
.im-progress {
  transition: opacity 0.2s;
}

.im-ctrls {
  display: flex;
  align-items: center;
  justify-content: center;
  /* 手机换行后两组次级键落到下一排；桌面 `nowrap` 时与下面各组的间距叠出视觉上的 20px */
  gap: 20px;
  flex-wrap: nowrap;
  /* 沉浸页的控件只是**尺寸**比播放条大一档；配方其余部分（图标/主按钮的软底、
     主题色、极淡描边、光晕、悬停光、禁用态、过渡）全在 global.css 的 .ctl 系列里，
     这里只写差异（v4.98 收口）。v4.95 的漂移就是因为两处各留一份实现：主按钮在这里
     写 48px / 图标 30px / 还有自己的一份 hover，播放条那边一改就只改了一半。
     --ctl-icon-size 同时管到共享的音量控件（它渲染在 .im-ctrls 里）。 */
  --ctl-icon-size: 22px;
  --ctl-play-size: 48px;
  --ctl-play-icon: 30px;
}

.im-ctrls__row {
  display: flex;
  align-items: center;
  gap: 20px;
}

/* ⚠ 基础规则必须写在媒体查询**之前**：两者特异性相同（都是 (0,1,0)），靠源码顺序分胜负。
   v5.94 踩过 —— 这两条原本写在文件末尾（媒体查询之后），结果手机档那句 `display: grid`
   被它压回 `flex`，而同一块里的 `grid-template-areas` 却生效了：**半套生效最难查**
   （量出来是 `display: flex` + `grid-template-areas: "bar bar" …` 这种不可能的组合）。 */
.im-progress {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.time {
  font-size: 11px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  min-width: 34px;
}

@media (max-width: 767px) {
  /* 手机上进度条与走带键**上下调换**（需求方：“播放按钮那一排和进度条调换位置”）：
     进度在上、走带键落在最下面 —— 屏幕底部是拇指最容易够到的区域，留给最常用的三个键，
     进度只是“看一眼”的信息，放它上面。（桌面不动：那里鼠标够得着，沿用原来的顺序。） */
  /* 时间退到**轨道底部两端**（v5.94，需求方给的参照是 QQ 手机版那张图：`00:03` 在轨道左下、
     `04:29` 在右下）。手机一整行的横向空间很紧 —— 时间挤在两侧时轨道只剩 250px 左右，
     挪到下面之后轨道独占整行（既能一眼看清进度，拖拽行程也变长）。
     用命名 grid 区域而不是 flex-wrap + order 那套：区域名直接说明“谁在哪”，
     将来多一个子元素也不会错位。`align-items` 沿用基础规则的 center。 */
  .im-progress {
    order: -1;
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-areas:
      "bar bar"
      "elapsed total";
    gap: 4px 12px;
  }

  .im-progress .progress {
    grid-area: bar;
  }

  /* 两端与**轨道**的两端对齐（轨道横跨整行，所以就是容器的内边距，与下面那排键同一条边界） */
  .im-progress .time:first-child {
    grid-area: elapsed;
    justify-self: start;
  }

  .im-progress .time:last-child {
    grid-area: total;
    justify-self: end;
  }

  /* 一排五个键：模式 / 上一曲 / 播放 / 下一曲 / 队列（需求方指定：模式在上一曲左侧、
     列表在下一首右侧）—— 靠 DOM 顺序就是对的（三组依次是 模式 / 走带键 / 队列+音量），
     不用 order 去搬。图标统一 22px（不存在“次级键”了）。
     ⚠️ 音量要抬到 (0,3,0)：组件 scoped 的 .vctl 是运行时注入的，同特异性压不过。 */
  /* 宽度交给容器（下方 .im-ctl 的 100%），这里只管“三组怎么摆”。
     v5.93 需求方：“底部的进度条和按钮组能否距离两边更近一点” ——
     原来那一簇只占 74vw（390px 的屏上两侧各空 51px，窄窗口下空得更多），
     现在模式贴左、队列贴右、走带键居中，可用宽度全用上。
     **用 grid 的 `1fr auto 1fr` 而不是 space-between**：后者中间那组会被两侧宽度差推偏
     （左组 22px vs 右组 66px，播放键会左偏 22px），而 `1fr auto 1fr` 的中间列永远是容器正中
     —— 播放键与进度条中心对齐这条（v5.70 定的）在手机上同样要成立。
     桌面不改：那里鼠标够得着，聚拢的一簇比铺满更好点。 */
  .im-ctrls {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 0 22px;
    /* 必须显式铺满：.im-ctl 是 `align-items: center` 的列，子项默认收成内容宽
       —— 实测只剩 324px（容器 362），模式键落在 33 而进度条左端在 14，
       两边对不齐；铺满后它才和进度条同一条边界。 */
    width: 100%;
    --ctl-icon-size: 22px;
  }

  .im-ctrls__row:first-child {
    justify-content: flex-start;
  }

  .im-ctrls__row:last-child {
    justify-content: flex-end;
  }

  /* 手机上两侧留白收窄：宽度只认一个来源（容器），
     “距两边多远”写在一处（.im-bottom 的 14px 侧内边距）—— 同“同源派生”那条规则的思路。
     桌面保留 min(560px, 74vw)：大屏上控制区铺满整屏会散掉。 */
  .im-ctl {
    width: min(560px, 100%);
  }

  /* 音量整枚收起（音量由系统音量键接管）。
     ⚠️ 必须用 :deep()：`.vctl` 是 VolumeControl 的根元素，**没有本组件的 data-v 属性** ——
     直接写 `.im-ctrls .vctl` 会被 scoped 编译成带 data-v 的选择器，永远匹配不上
     （实测没藏住，而且没有任何报错）。:deep 同时把特异性抬到 (0,3,0)，压过组件自己的 (0,2,0)。 */
  .im-ctrls :deep(.vctl) {
    display: none;
  }

  .im-ctrls__row--primary {
    gap: 26px;
    --ctl-play-size: 56px;
    --ctl-play-icon: 32px;
  }
}

/* 进度条本体（轨道 / 填充 / 手柄 / 播放时的柔光）与“手柄何时出现”全在 global.css 的共用规则里
   （v4.95 手柄配方、v4.96 悬停才出现、v4.97 填充柔光）——
   播放条与沉浸页是同一个控件，这里不再写第二份：v4.95 就是因为两边各留一份而漂过一次。 */
</style>
