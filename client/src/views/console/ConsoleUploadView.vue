<script setup lang="ts">
import IconUploadSimple from "~icons/ph/upload-simple";

/** 控制台 · 上传导入（AD-01）：拖拽与进度队列依赖 POST /api/songs/upload（multer + music-metadata） */
</script>

<template>
  <section>
    <div class="page-head">
      <h1>
        上传导入
        <div class="sub">音乐会上传到你的服务器，手机浏览器也能听</div>
      </h1>
    </div>

    <div class="dropzone">
      <span class="dz-badge"><IconUploadSimple class="icon" /></span>
      <div class="dz-title">上传功能正在开发中</div>
      <div class="dz-sub">完成后可拖入音频文件 · 单文件最大 300MB · 重名文件提示跳过或覆盖</div>
    </div>

    <div class="queue card">
      <div class="queue__head">
        <b>上传队列</b>
        <span>0 个任务</span>
      </div>
      <p class="queue__empty">拖入文件后，这里会逐个显示上传进度与结果</p>
    </div>
  </section>
</template>

<style scoped>
.queue {
  margin-top: 14px;
  padding: 16px 20px 20px;
}

/* 控制台内容岛很宽，超宽卡片里的居中文字会显得空：正文区限宽 */
.dropzone,
.queue {
  max-width: 900px;
}

.queue__head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--glass-border);
}

.queue__head b {
  font-size: 14px;
  margin-right: auto;
}

.queue__head span {
  font-size: 12px;
  color: var(--text-3);
}

.queue__empty {
  padding: 22px 0 6px;
  text-align: center;
  font-size: 12.5px;
  color: var(--text-3);
}
</style>
