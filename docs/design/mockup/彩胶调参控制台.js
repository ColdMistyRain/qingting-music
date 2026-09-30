/* ============================================================
   轻听音乐 · 彩胶实时调参控制台
   用法：F12 打开 DevTools → Console → 粘贴本文件全部内容 → 回车
   面板出现在左上角，拖滑杆实时调彩胶的位置/大小/光晕。
   再粘贴一次同段代码 = 关闭面板。
   满意后把面板底部的参数值发给 AI 固化进 mockup.css。
   （刷新页面后面板消失，重新粘贴即可；不影响已调好的样式）
   ============================================================ */
(() => {
  "use strict";
  if (window.__qtVinylTuner) { window.__qtVinylTuner.el.remove(); delete window.__qtVinylTuner; return; }

  const disc = document.querySelector(".vinyl-assembly");
  const glow = document.querySelector(".v-glow");
  if (!disc) { console.warn("未找到 .vinyl-assembly（请确认当前为海报布局）"); return; }

  /* 初始值 = 当前 CSS 生效值 */
  const state = { d: 90, t: -27, r: -19, g: 75 };
  const unit = { d: "vh", t: "vh", r: "vw", g: "%" };

  const box = document.createElement("div");
  box.id = "__qtVinylTuner";
  box.style.cssText =
    "position:fixed;left:12px;top:64px;z-index:2147483647;" +
    "background:rgba(12,14,22,.92);color:#e8ebf2;" +
    "font:12px/1.9 system-ui,'Microsoft YaHei',sans-serif;" +
    "padding:12px 14px;border-radius:12px;" +
    "border:1px solid rgba(255,255,255,.16);width:240px;" +
    "backdrop-filter:blur(12px)";
  box.innerHTML =
    '<b style="display:block;margin-bottom:2px">🎛 彩胶实时调参</b>' +
    ["d|直径|30|110", "t|顶部|-45|10", "r|右侧|-30|10", "g|光晕|0|100"].map((cfg) => {
      const [k, name, min, max] = cfg.split("|");
      return `<label style="display:flex;align-items:center;gap:8px">${name}` +
        `<input data-k="${k}" type="range" min="${min}" max="${max}" value="${state[k]}" ` +
        `style="flex:1;accent-color:#7c8cff">` +
        `<span data-o="${k}" style="min-width:52px;text-align:right;font-variant-numeric:tabular-nums">${state[k]}${k === "g" ? "%" : "vh"}</span></label>`;
    }).join("") +
    '<div style="margin-top:8px;font-size:10.5px;color:#8a94a8">拖动滑杆实时生效；满意后把数值发给 AI 固化进 mockup.css</div>';
  document.body.appendChild(box);

  const apply = () => {
    disc.style.top = state.t + "vh";
    disc.style.right = state.r + "vw";
    disc.style.width = state.d + "vh";
    if (glow) glow.style.opacity = state.g / 100;
  };

  box.addEventListener("input", (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    state[k] = +e.target.value;
    box.querySelector(`[data-o="${k}"]`).textContent =
      k === "g" ? state[k] + "%" : state[k] + (k === "r" ? "vw" : "vh");
    apply();
  });

  console.log("%c彩胶调参面板已启动。state 对象挂在 window.__qtVinylTuner.state，可 console 里精调。", "color:#7c8cff");
  window.__qtVinylTuner = { el: box, state, apply };
})();
