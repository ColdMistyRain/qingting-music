/* ============================================================
   轻听音乐 · 高保真原型交互脚本
   模拟：页面切换 / 双主题（VS-08）/ 封面取色（VS-02 模拟）/
        模拟播放与进度 / Apple Music 风格歌词（3.7）/ 管理台交互（3.12）
   仅为原型：无真实音频与后端，一切均为静态模拟
   ============================================================ */
"use strict";

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/* ---------- 数据 ---------- */
const SONGS = [
  { id: "s1", title: "夜行", artist: "林晚", album: "城市霓虹", dur: 225,
    c1: "#5b7cfa", c2: "#8b5cf6", accent: "#7c8cff", soft: "rgba(124,140,255,.14)",
    glow1: "rgba(91,124,250,.26)", glow2: "rgba(139,92,246,.2)",
    lyrics: ["路灯次第亮起 像谁打翻了星斗", "我把耳机音量 调到刚好盖过世界", "夜色是温柔的兽 吞掉了所有喧嚣", "而我趴在它背上 轻轻哼这一首歌", "霓虹淌进眼里 碎成一片晃动的海", "你说过的方式 我至今还在练习", "夜行的人不说话 心里都有各自的答案", "天亮之前 先把自己交给旋律"] },
  { id: "s2", title: "夏日终结", artist: "陈屿", album: "蝉鸣", dur: 252,
    c1: "#ff6b3d", c2: "#fbbf24", accent: "#ff7a45", soft: "rgba(255,122,69,.14)",
    glow1: "rgba(255,107,61,.24)", glow2: "rgba(251,191,36,.18)",
    lyrics: ["蝉声漫过七月的尽头", "单车碾过晒烫的柏油", "你把冰镇汽水 递到我手中", "气泡涌上来 像没说出口的挽留", "黄昏把影子拉得好长好长", "我们假装 还有很多个夏天", "可风已经开始 转身了", "再见的话 就留到站台再说"] },
  { id: "s3", title: "深海信笺", artist: "蓝溪", album: "潮汐", dur: 303,
    c1: "#0ea5e9", c2: "#22d3ee", accent: "#38bdf8", soft: "rgba(56,189,248,.14)",
    glow1: "rgba(14,165,233,.24)", glow2: "rgba(34,211,238,.18)",
    lyrics: ["把想说的话 写进气泡里", "让它慢慢沉进 深蓝色的海底", "潮汐每天来回 读取又抹去", "有些心事 只适合交给鱼群", "月光落在海面 折出一条银路", "我沿着它走 走进你的梦里", "如果梦醒时 眼角有一点湿", "那是海 替我保守过的秘密"] },
  { id: "s4", title: "落日公路", artist: "野橘", album: "公共汽车", dur: 201,
    c1: "#f97316", c2: "#ef4444", accent: "#fb923c", soft: "rgba(251,146,60,.14)",
    glow1: "rgba(249,115,22,.24)", glow2: "rgba(239,68,68,.18)",
    lyrics: ["后视镜里的落日 熄了又亮", "公路把黄昏 拉成一条长长的糖", "收音机沙沙响 唱着老情歌", "我们摇下车窗 喊一整个夏天的名字", "加油站的风 带着汽油和橘子味", "下一站去哪 其实无所谓", "只要车轮还在转 夜色还在退", "落日公路 就永远没有终点"] },
  { id: "s5", title: "绿野信", artist: "青禾", album: "原野", dur: 284,
    c1: "#22c55e", c2: "#84cc16", accent: "#4ade80", soft: "rgba(74,222,128,.14)",
    glow1: "rgba(34,197,94,.22)", glow2: "rgba(132,204,22,.18)",
    lyrics: ["风吹过原野 信就写好了", "每一株草 都是绿色的标点", "云的邮差 走得很慢很慢", "它要把春天 送到最后一户人家", "溪水念着信的落款", "山岗盖了一个 云朵的邮戳", "如果你在远处 看见一片起伏的绿", "那是大地 在朗读我的信"] },
  { id: "s6", title: "紫罗兰", artist: "Violet", album: "花期", dur: 217,
    c1: "#a855f7", c2: "#6366f1", accent: "#c084fc", soft: "rgba(192,132,252,.14)",
    glow1: "rgba(168,85,247,.24)", glow2: "rgba(99,102,241,.2)",
    lyrics: ["紫罗兰在四月 熬了一整夜", "把香气酿成 一小瓶银河", "路过的人啊 请轻一点走", "别惊动花瓣上 打盹的光", "花期短得 像一句没说完的话", "可记忆偏偏 又臭又长", "多年后你闻到 类似的香", "还是会停下来 想起这个晚上"] },
  { id: "s7", title: "晨雾", artist: "白屿", album: "山间", dur: 178,
    c1: "#64748b", c2: "#94a3b8", accent: "#a5b4cf", soft: "rgba(165,180,207,.14)",
    glow1: "rgba(100,116,139,.24)", glow2: "rgba(148,163,184,.2)",
    lyrics: ["晨雾把山 折成一页页宣纸", "鸟鸣是未干的 墨", "石阶向上 通向没有名字的寺", "钟声撞进雾里 半天散不去", "我放慢呼吸 学树的样子站着", "让露水 顺着袖口滴落", "雾散的那一刻 山忽然很近", "近得能听见它 缓缓的呼吸"] },
  { id: "s8", title: "焰火", artist: "星野", album: "夜空", dur: 284,
    c1: "#f43f5e", c2: "#fb923c", accent: "#fb7185", soft: "rgba(251,113,133,.14)",
    glow1: "rgba(244,63,94,.24)", glow2: "rgba(251,146,60,.2)",
    lyrics: ["倒数三二一 别眨眼", "夜空被撕开 一道金色的边", "焰火落下来 像谁的愿望碎掉", "碎掉也好 碎了才发光", "人群欢呼着 拥抱又告别", "我把这一秒 悄悄存进左胸膛", "以后每个平淡的夜里", "拿出来 都能照亮一小段路"] },
];

const byId = (id) => SONGS.find((s) => s.id === id);
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/* ---------- 状态 ---------- */
const state = {
  role: "admin", page: "library",
  playingId: "s1", playing: true, progress: 42,
  modeIdx: 1,
  queue: SONGS.map((s) => s.id),
  lyricIdx: -1, charTimer: null,
};
let muted = false;

/* ---------- 播放模式（PL-05：单按钮循环切换四种模式） ---------- */
const MODE_ICONS = {
  seq: '<path d="M4 12h13"/><path d="M14 8l4 4-4 4"/><path d="M20 5v14"/>',
  list: '<path d="M4 12V9a3 3 0 0 1 3-3h13"/><path d="M17.5 3.5 20 6l-2.5 2.5"/><path d="M20 12v3a3 3 0 0 1-3 3H4"/><path d="M6.5 20.5 4 18l2.5-2.5"/>',
  one: '<path d="M4 12V9a3 3 0 0 1 3-3h13"/><path d="M17.5 3.5 20 6l-2.5 2.5"/><path d="M20 12v3a3 3 0 0 1-3 3H4"/><path d="M6.5 20.5 4 18l2.5-2.5"/><text x="12" y="15.5" font-size="8.5" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none">1</text>',
  random: '<path d="M3 7h3.5c3 0 4.6 4.5 7.5 10 1 2 2.4 0 3.5 0H21"/><path d="M18.5 4.5 21 7l-2.5 2.5"/><path d="M3 17h3.5c1.2 0 2.2-2 3.2-3.5"/><path d="M14.6 9.9c.9-1.6 1.9-2.9 3.4-2.9H21"/><path d="M18.5 14.5 21 17l-2.5 2.5"/>',
};
const MODES = [
  { key: "seq", label: "顺序播放" },
  { key: "list", label: "列表循环" },
  { key: "one", label: "单曲循环" },
  { key: "random", label: "随机播放" },
];

function setModeUI() {
  const m = MODES[state.modeIdx];
  $$("#c-mode, #i-mode").forEach((el) => {
    el.title = "播放模式：" + m.label;
    el.classList.toggle("dim", m.key === "seq");
    el.querySelector("svg").innerHTML = MODE_ICONS[m.key];
  });
}

function cycleMode() {
  state.modeIdx = (state.modeIdx + 1) % MODES.length;
  setModeUI();
}

/* ---------- 主题（VS-08） ---------- */
const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
const MOON = '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>';
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem("qt-theme", t);
  $("#ico-theme").innerHTML = t === "dark" ? MOON : SUN;
  $("#btn-theme-label").textContent = t === "dark" ? "浅色模式" : "深色模式";
}

/* ---------- 取色模拟（VS-02）：切换歌曲 → 全站换色 ---------- */
function applyPalette(song) {
  const r = document.documentElement.style;
  r.setProperty("--accent", song.accent);
  r.setProperty("--accent-2", song.c2);
  r.setProperty("--accent-soft", song.soft);
  r.setProperty("--glow1", song.glow1);
  r.setProperty("--glow2", song.glow2);
  r.setProperty("--cv1", song.c1);
  r.setProperty("--cv2", song.c2);
}

/* ---------- 模拟播放引擎 ---------- */
function markPlayingRows() {
  $$(".songrow").forEach((row) =>
    row.classList.toggle("playing", row.dataset.id === state.playingId));
}

function playSong(id, autoplay = true) {
  const song = byId(id);
  state.playingId = id;
  state.progress = 0;
  state.playing = autoplay;
  state.lyricIdx = -1;
  applyPalette(song);
  $("#pb-title").textContent = song.title;
  $("#pb-artist").textContent = `${song.artist} · ${song.album}`;
  $("#im-title-b").textContent = song.title;
  $("#im-title-s").textContent = `${song.artist} · ${song.album}`;
  $("#pb-t2").textContent = $("#im-t2").textContent = fmt(song.dur);
  $("#im-cover").style.background = `radial-gradient(circle at 32% 30%, ${song.c1}, ${song.c2} 75%)`;
  renderLyrics(song);
  markPlayingRows();
  renderQueue();
  updatePlayIcon();
  updateProgressUI();
  document.body.classList.toggle("paused", !state.playing);
}

function updatePlayIcon() {
  const path = state.playing
    ? '<path d="M7.5 5h3v14h-3zM13.5 5h3v14h-3z"/>'
    : '<path d="M8 5.5v13l11-6.5z"/>';
  $("#ico-play").innerHTML = path;
  $("#i-play").querySelector("svg").innerHTML = path;
  document.body.classList.toggle("paused", !state.playing);
}

function togglePlay() {
  state.playing = !state.playing;
  updatePlayIcon();
}

function nextSong() {
  const m = MODES[state.modeIdx].key;
  if (m === "random") return playSong(SONGS[Math.floor(Math.random() * SONGS.length)].id, state.playing);
  const q = state.queue.length ? state.queue : SONGS.map((s) => s.id);
  const i = q.indexOf(state.playingId);
  const n = q[(i + 1) % q.length] ?? SONGS[0].id;
  playSong(n, state.playing);
}

function prevSong() {
  if (state.progress > 3) { state.progress = 0; return; } // PL-02 规则
  const m = MODES[state.modeIdx].key;
  if (m === "random") return playSong(SONGS[Math.floor(Math.random() * SONGS.length)].id, state.playing);
  const q = state.queue.length ? state.queue : SONGS.map((s) => s.id);
  const i = q.indexOf(state.playingId);
  const n = q[(i - 1 + q.length) % q.length] ?? SONGS[0].id;
  playSong(n, state.playing);
}

function updateProgressUI() {
  const song = byId(state.playingId);
  const pct = (state.progress / song.dur) * 100 + "%";
  $$(".progress").forEach((p) => {
    p.querySelector(".fill").style.width = pct;
    p.querySelector(".knob").style.left = pct;
  });
  $("#pb-t1").textContent = $("#im-t1").textContent = fmt(state.progress);
}

/* ---------- Apple Music 风格歌词（3.7 / LR-04~06） ---------- */
function lyricTimes(song) {
  const n = song.lyrics.length;
  const step = (song.dur - 8) / n;
  return song.lyrics.map((text, i) => ({ t: 3 + i * step, text }));
}

function renderLyrics(song) {
  const box = $("#im-lyrics");
  box.innerHTML = '<div class="ly-list" id="ly-list"></div>';
  const list = $("#ly-list");
  state.lyricIdx = -1;
  lyricTimes(song).forEach((l, i) => {
    const div = document.createElement("div");
    div.className = "lyline";
    div.textContent = l.text;
    div.addEventListener("click", () => { state.progress = l.t; }); // LR-06 点击行跳转
    list.appendChild(div);
  });
  updateLyrics(song, true);
}

function updateLyrics(song, force) {
  const lines = lyricTimes(song);
  let idx = 0;
  lines.forEach((l, i) => { if (state.progress >= l.t) idx = i; });
  const box = $("#im-lyrics");
  const list = $("#ly-list");
  if (!list) return;
  if (idx !== state.lyricIdx || force) {
    state.lyricIdx = idx;
    box.querySelectorAll(".lyline").forEach((el, i) => {
      el.classList.toggle("current", i === idx);
      el.classList.toggle("past", i < idx);
      if (i === idx) {
        el.innerHTML = Array.from(lines[idx].text)
          .map((c) => `<span class="ch">${esc(c)}</span>`).join("");
      }
    });
    // AMLL 风格弹簧滚动：列表整体位移，当前句居中
    const cur = list.children[idx];
    if (cur) {
      const target = Math.max(0, cur.offsetTop - box.clientHeight / 2 + cur.offsetHeight / 2);
      list.style.transform = `translateY(${-target}px)`;
    }
  }
  // 逐字填充（LR-05）
  const cur = list.children[idx];
  if (cur) {
    const line = lines[idx];
    const ratio = Math.min(1, Math.max(0, (state.progress - line.t) / ((lines[idx + 1]?.t ?? song.dur) - line.t)));
    const chars = cur.querySelectorAll(".ch");
    const done = Math.floor(ratio * chars.length);
    chars.forEach((c, i) => c.classList.toggle("done", i < done));
  }
}

/* ---------- 模拟心跳 ---------- */
setInterval(() => {
  if (!state.playing) return;
  const song = byId(state.playingId);
  state.progress += 0.25;
  if (state.progress >= song.dur) {
    const m = MODES[state.modeIdx].key;
    if (m === "one") {
      state.progress = 0; // 单曲循环：重唱
    } else if (m === "seq" && SONGS.findIndex((x) => x.id === song.id) === SONGS.length - 1) {
      state.progress = song.dur;
      togglePlay(); // 顺序播放：末曲停止
    } else {
      nextSong();
    }
  }
  updateProgressUI();
  updateLyrics(byId(state.playingId));
}, 250);

/* ---------- 列表渲染 ---------- */
const coverStyle = (s) => `background:linear-gradient(135deg,${s.c1},${s.c2})`;
const noteSVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 18V6l10-2v11"/><circle cx="7" cy="18" r="2.5"/><circle cx="17" cy="15" r="2.5"/></svg>';

function songRowHTML(s, extra = "", locked = false) {
  const playing = s.id === state.playingId ? " playing" : "";
  return `<div class="songrow${playing}${locked ? " locked" : ""}" data-id="${s.id}">
    <div class="cover" style="${coverStyle(s)}">${playing ? '<div class="eq"><i></i><i></i><i></i></div>' : noteSVG}</div>
    <div class="s-meta"><div class="s-title">${s.title}${extra}</div><div class="s-artist">${s.artist}</div></div>
    <div class="s-album">${s.album}</div>
    <div class="s-dur">${fmt(s.dur)}</div>
    <div class="s-act">⋯</div>
  </div>`;
}

function renderLibrary(filter = "") {
  const f = filter.trim().toLowerCase();
  $("#list-library").innerHTML = SONGS
    .filter((s) => !f || (s.title + s.artist + s.album).toLowerCase().includes(f))
    .map((s) => songRowHTML(s)).join("");
  bindSongRows("#list-library");
}

function renderLocal() {
  const local = ["s5", "s7", "s3"];
  $("#list-local").innerHTML = local
    .map((id) => songRowHTML(byId(id), '<span class="badge local">本地</span>')).join("");
  bindSongRows("#list-local");
}

function renderOnline() {
  const vip = new Set(["s2", "s6"]);
  $("#list-online").innerHTML = SONGS.slice(0, 6)
    .map((s) => songRowHTML(s, vip.has(s.id) ? '<span class="badge vip">VIP</span>' : "", vip.has(s.id))).join("");
  bindSongRows("#list-online");
}

function renderAdmin() {
  const sizes = ["8.2MB", "5.1MB", "12.4MB", "7.8MB", "9.6MB", "4.3MB"];
  const dates = ["2026-09-28", "2026-09-27", "2026-09-26", "2026-09-25", "2026-09-24", "2026-09-23"];
  $("#list-admin").innerHTML = SONGS.slice(0, 6).map((s, i) => `
    <div class="adminrow" data-id="${s.id}">
      <input type="checkbox" aria-label="选择">
      <div class="cover" style="${coverStyle(s)}">${noteSVG}</div>
      <div class="s-meta"><div class="s-title">${s.title}.mp3</div><div class="s-artist">${s.artist}</div></div>
      <div class="s-dur">${sizes[i]}</div>
      <div class="s-dur">${dates[i]}</div>
      <div style="text-align:right"><button class="btn btn-danger btn-sm">删除</button></div>
    </div>`).join("");
  $("#list-admin").addEventListener("change", updateSelCount);
  $("#list-admin").addEventListener("click", (e) => {
    if (e.target.classList.contains("btn-danger")) e.target.closest(".adminrow").remove();
  });
}

/* ---------- 播放队列（PL-06） ---------- */
function renderQueue() {
  $("#q-count").textContent = state.queue.length + " 首";
  $("#q-list").innerHTML = state.queue.length
    ? state.queue.map((id) => {
        const s = byId(id);
        return `
        <div class="q-row${id === state.playingId ? " playing" : ""}" data-id="${id}">
          <div class="cover" style="${coverStyle(s)}">${noteSVG}</div>
          <div class="s-meta"><div class="s-title">${s.title}</div><div class="s-artist">${s.artist}</div></div>
          <button class="q-del" title="从队列移除">✕</button>
        </div>`;
      }).join("")
    : '<div class="q-empty">播放队列已清空，从曲库或歌单里选首歌吧</div>';
  $$("#q-list .q-row").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.classList.contains("q-del")) return;
      playSong(row.dataset.id, true);
      renderQueue();
    });
  });
  $$("#q-list .q-del").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      state.queue = state.queue.filter((x) => x !== btn.closest(".q-row").dataset.id);
      renderQueue();
    });
  });
}

function updateSelCount() {
  $("#sel-n").textContent = $$('#list-admin input[type="checkbox"]:checked').length;
}

function bindSongRows(sel) {
  $(sel).onclick = (e) => {
    const row = e.target.closest(".songrow");
    if (!row || row.classList.contains("locked")) return;
    if (state.playingId === row.dataset.id) togglePlay();
    else playSong(row.dataset.id, true);
  };
}

/* ---------- 页面切换 ---------- */
function setPage(name) {
  state.page = name;
  $$(".page").forEach((p) => p.classList.add("hidden"));
  $("#page-" + name).classList.remove("hidden");
  $$(".sidebar .nav-item[data-page]").forEach((n) =>
    n.classList.toggle("active", n.dataset.page === name));
  $$(".sb-pl").forEach((el) => el.classList.remove("active"));
}

function applyRole() {
  const guest = state.role === "guest";
  ["nav-library", "nav-online", "nav-admin", "sb-playlists"].forEach((id) => {
    $("#" + id).classList.toggle("hidden", guest);
  });
  if (guest && ["library", "online", "playlist", "admin"].includes(state.page)) setPage("local");
}

/* ---------- 歌单：侧栏分区 + 详情页（2026-09-29 原型改版） ---------- */
const PLAYLISTS = [
  { id: "p1", name: "夜间飞行", c1: "#5b7cfa", c2: "#8b5cf6", songs: ["s1", "s3", "s6"] },
  { id: "p2", name: "夏日公路", c1: "#ff6b3d", c2: "#f97316", songs: ["s4", "s2"] },
  { id: "p3", name: "深海专注", c1: "#0ea5e9", c2: "#22d3ee", songs: ["s3", "s5", "s7"] },
  { id: "p4", name: "原野漫步", c1: "#22c55e", c2: "#84cc16", songs: ["s5"] },
  { id: "p5", name: "紫色午夜", c1: "#a855f7", c2: "#6366f1", songs: ["s6", "s1", "s8"] },
];
let activePl = "p1";

function renderSidebarPlaylists() {
  $("#sb-pl-list").innerHTML = PLAYLISTS.map((p) => `
    <button class="sb-pl${p.id === activePl ? " active" : ""}" data-pl="${p.id}">
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 6h10M4 11h10M4 16h6"/><circle cx="17" cy="16" r="2.6"/><path d="M19.6 16V7l2.4-.8"/></svg>
      <span class="sb-pl-name">${esc(p.name)}</span>
      <span class="sb-pl-count">${p.songs.length}</span>
    </button>`).join("");
  $$("#sb-pl-list .sb-pl").forEach((el) =>
    el.addEventListener("click", () => openPlaylist(el.dataset.pl)));
}

function openPlaylist(id) {
  const p = PLAYLISTS.find((x) => x.id === id);
  if (!p) return;
  activePl = id;
  setPage("playlist");
  renderSidebarPlaylists();
  const songs = p.songs.map(byId);
  const total = songs.reduce((a, s) => a + s.dur, 0);
  const totalStr = total >= 3600
    ? `${Math.floor(total / 3600)} 小时 ${Math.round((total % 3600) / 60)} 分`
    : `${Math.round(total / 60)} 分钟`;
  const playIcon = '<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>';
  const renameIcon = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l4 4L8 20H4v-4z"/></svg>';
  const exportIcon = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v10M8 10l4 4 4-4"/><path d="M5 20h14"/></svg>';
  const trashIcon = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 7l1 12a1 1 0 0 0 1 .9h7a1 1 0 0 0 1-.9l1-12"/></svg>';
  $("#pl-detail").innerHTML = `
    <div class="plh">
      <div class="plh-cover" style="background:linear-gradient(135deg,${p.c1},${p.c2})"><svg class="icon" style="width:46px;height:46px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M9 18V6l10-2v11"/><circle cx="7" cy="18" r="2.5"/><circle cx="17" cy="15" r="2.5"/></svg></div>
      <div class="plh-info">
        <div class="plh-label">歌 单</div>
        <div class="plh-name" id="plh-name">${esc(p.name)}</div>
        <div class="plh-meta">${p.songs.length} 首 · ${totalStr}</div>
        <div class="plh-actions">
          <button class="btn btn-primary" id="plh-play">${playIcon}播放全部</button>
          <button class="btn" id="plh-rename">${renameIcon}重命名</button>
          <button class="btn" id="plh-export">${exportIcon}导出</button>
          <button class="btn btn-danger" id="plh-del">${trashIcon}删除</button>
        </div>
      </div>
    </div>
    <div class="pl-tracks">
      ${songs.map((s, i) => `
      <div class="trow${s.id === state.playingId ? " playing" : ""}" data-id="${s.id}">
        <span class="t-num">${i + 1}</span>
        <div class="cover" style="${coverStyle(s)}">${noteSVG}</div>
        <div class="s-meta"><div class="s-title">${s.title}</div><div class="s-artist">${s.artist}</div></div>
        <div class="s-album">${s.album}</div>
        <div class="s-dur">${fmt(s.dur)}</div>
        <div class="s-act">⋯</div>
      </div>`).join("")}
    </div>`;
  $("#plh-play").addEventListener("click", () => playSong(songs[0].id, true));
  $("#plh-export").addEventListener("click", function () {
    const orig = this.innerHTML;
    this.textContent = "已导出 ✓";
    setTimeout(() => { this.innerHTML = orig; }, 1200);
  });
  $("#plh-rename").addEventListener("click", () => {
    const nameEl = $("#plh-name");
    const input = document.createElement("input");
    input.className = "input";
    input.value = p.name;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    const commit = () => {
      p.name = input.value.trim() || p.name;
      renderSidebarPlaylists();
      openPlaylist(p.id);
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
  });
  $("#plh-del").addEventListener("click", () => {
    const i = PLAYLISTS.findIndex((x) => x.id === id);
    PLAYLISTS.splice(i, 1);
    renderSidebarPlaylists();
    if (PLAYLISTS.length) openPlaylist(PLAYLISTS[Math.max(0, i - 1)].id);
    else $("#pl-detail").innerHTML = '<div class="plh-empty">还没有歌单，点侧栏「＋」新建一个</div>';
  });
  bindSongRows(".pl-tracks");
}

/* ---------- 事件绑定 ---------- */
function bind() {
  $$(".sidebar .nav-item[data-page]").forEach((n) =>
    n.addEventListener("click", () => setPage(n.dataset.page)));

  $("#btn-theme").addEventListener("click", () =>
    setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));

  $("#btn-logout").addEventListener("click", () => {
    $("#immersive").classList.add("hidden");
    $("#app").classList.add("hidden");
    $("#page-login").classList.remove("hidden");
  });

  $("#login-form").addEventListener("submit", (e) => {
    e.preventDefault();
    state.role = "admin";
    $("#page-login").classList.add("hidden");
    $("#app").classList.remove("hidden");
    applyRole(); setPage("library");
  });

  $("#login-guest").addEventListener("click", () => {
    state.role = "guest";
    $("#page-login").classList.add("hidden");
    $("#app").classList.remove("hidden");
    applyRole(); setPage("local");
  });

  // 防御式绑定：元素可能不存在（如沉浸页无循环按钮）
  const on = (sel, fn) => { const el = $(sel); if (el) el.addEventListener("click", fn); };
  on("#c-play", togglePlay);
  on("#i-play", togglePlay);
  on("#c-prev", prevSong);
  on("#i-prev", prevSong);
  on("#c-next", nextSong);
  on("#i-next", nextSong);
  on("#c-mode", cycleMode);
  on("#i-mode", cycleMode);
  on("#c-vol", function () {
    muted = !muted;
    const f = $(".vol-fill");
    if (f) f.style.width = muted ? "0%" : "65%";
    this.title = muted ? "取消静音" : "静音";
  });

  $$(".progress").forEach((p) => p.addEventListener("click", (e) => {
    const r = p.getBoundingClientRect();
    state.progress = ((e.clientX - r.left) / r.width) * byId(state.playingId).dur;
    updateProgressUI();
    updateLyrics(byId(state.playingId), true);
  }));

  const openIm = () => $("#immersive").classList.remove("hidden");
  $("#pb-open").addEventListener("click", openIm);
  $("#im-close").addEventListener("click", () => $("#immersive").classList.add("hidden"));
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && e.target.tagName !== "INPUT") { e.preventDefault(); togglePlay(); }
    if (e.code === "Escape") $("#immersive").classList.add("hidden");
  });

  const libInput = $("#page-library .input");
  libInput.addEventListener("input", () => renderLibrary(libInput.value));
  $("#online-go").addEventListener("click", renderOnline);
  $("#online-kw").addEventListener("keydown", (e) => { if (e.key === "Enter") renderOnline(); });

  // 管理台：模拟上传（AD-01）
  $("#btn-fake-upload").addEventListener("click", () => {
    const name = `新歌曲 ${String(Math.floor(Math.random() * 90) + 10)}.mp3`;
    const item = document.createElement("div");
    item.className = "up-item";
    item.innerHTML = `<span class="up-name">${name}</span><div class="up-bar"><div class="up-fill"></div></div><span class="up-pct">0%</span>`;
    $("#up-list").prepend(item);
    let p = 0;
    const t = setInterval(() => {
      p = Math.min(100, p + Math.random() * 14);
      item.querySelector(".up-fill").style.width = p + "%";
      item.querySelector(".up-pct").textContent = Math.floor(p) + "%";
      if (p >= 100) {
        clearInterval(t);
        item.classList.add("done");
        item.querySelector(".up-pct").textContent = "✓";
      }
    }, 160);
  });

  $("#btn-reindex").addEventListener("click", function () {
    this.textContent = "⟳ 重建中…";
    setTimeout(() => { this.textContent = "⟳ 重建索引（AD-05）✓"; }, 1200);
  });

  $("#btn-batchdel").addEventListener("click", () => {
    $$('#list-admin input[type="checkbox"]:checked').forEach((c) => c.closest(".adminrow").remove());
    updateSelCount();
  });

  // 歌单：侧栏「＋」新建并进入重命名（PS-01）
  $("#pl-add").addEventListener("click", () => {
    const p = { id: "p" + Date.now(), name: "新建歌单", c1: "#64748b", c2: "#94a3b8", songs: [] };
    PLAYLISTS.push(p);
    openPlaylist(p.id);
    setTimeout(() => $("#plh-rename").click(), 60);
  });

  // 侧栏折叠（图标窄栏，状态记忆）
  const applyCollapsed = (c) => {
    $("#app").classList.toggle("collapsed", c);
    $("#btn-collapse").title = c ? "展开侧边栏" : "折叠侧边栏";
  };
  applyCollapsed(localStorage.getItem("qt-sb-collapsed") === "1");
  $("#btn-collapse").addEventListener("click", () => {
    const collapsed = $("#app").classList.toggle("collapsed");
    localStorage.setItem("qt-sb-collapsed", collapsed ? "1" : "0");
    $("#btn-collapse").title = collapsed ? "展开侧边栏" : "折叠侧边栏";
  });

  // 播放队列弹层（PL-06）
  $("#pb-queue").addEventListener("click", () => {
    renderQueue();
    $("#queue-pop").classList.toggle("hidden");
  });
  $("#q-clear").addEventListener("click", () => {
    state.queue = [];
    renderQueue();
  });
}

/* ---------- 启动 ---------- */
setTheme(localStorage.getItem("qt-theme") || "dark");
renderLibrary();
renderLocal();
renderOnline();
renderAdmin();
renderSidebarPlaylists();
bind();
setModeUI();
playSong("s1", true);
state.progress = 42;
updateProgressUI();
updateLyrics(byId("s1"), true);
setPage("library");
