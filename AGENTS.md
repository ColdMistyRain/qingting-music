# AGENTS.md —— 轻听音乐（qingting-music）

给所有 AI 编码助手/协作者的入口文档。**开工前请先读本文件，再读下面「文档索引」里的两份详细文档。**

## 项目是什么

一款**可私有部署的 Web 音乐播放器**：播放本地文件 + 自建服务器云端曲库（上传/流式播放）+ 在线音源（网易云等）搜索试听。产品形态是"本地 + 自有云端 + 在线聚合"三合一。

- 需求文档（唯一权威来源，含全部需求编号 PL/LB/LC/ON/PS/LR/VS/RT/AC/AD）：[`音乐软件需求文档.md`](./音乐软件需求文档.md)
- 高保真界面原型（**界面样式唯一事实来源**）：[`docs/design/mockup/`](./docs/design/mockup/)（`css/mockup.css` 定义了全部令牌与配方）
- 架构图 / 线框：[`docs/design/*.drawio`](./docs/design/)

需求文档里的编号（如 `LB-06`、`AC-03`、`VS-09`）是**通用语言**：代码注释、提交信息、文档都应引用它们。

## 铁律（不要擅自更改）

1. **技术选型已定稿**（PRD 5.1）：前端 Vue 3 + Vite + TS + Pinia + Vue Router；样式手写 CSS + CSS 变量，**不引入带样式的组件库**；复杂交互件用 Reka UI（无样式行为层）；图标只用 **Iconify + Phosphor**（`~icons/ph/xxx`，构建期打包）。**唯一例外：歌词的动效机制按 AMLL 的实现移植进我们自己的代码**（弹簧在 `client/src/utils/spring.ts`，署名保留；**不装它的包**——v4.84 曾直接接入，v4.85 按需求方澄清回退：“抄它们的代码，这样才能有我们的风格”）。界面风格、主题色、锦线策略仍是我们自己的。后端 Node + Express + TS，multer 上传，music-metadata 解析标签，JSON 文件存储。
2. **界面以"美观 + 易用"为准，需求方的感受是最终裁决权；原型是参考与素材库，不是教条。** `docs/design/mockup/` 提供令牌、配方与视觉语言（`css/mockup.css`）。改样式不必先改原型，但必须：① 保持单一视觉语言，不出现两套互相矛盾的样式；② 改动后同步更新原型与需求文档决策记录，避免下次有人照着旧原型改回去。**不要**照搬原型里的单页 CSS 类切换（已被证明会产生层叠逃逸 bug，见 v3.9 修订记录），沉浸页三布局必须拆成三个独立 Vue 组件（VS-09 / v4.0 决策）。
   **简约优先（v4.30 需求方定调）**：能用层级与间距说清的不加线、不加底、不加装饰图标；同一个页面的分隔方式只留一套；颜色只用于表达状态（播放中/失败/选中），不做装饰；每加一个元素都要能回答"它承载什么信息"，答不出就删掉。
3. **取色只注入原始色源**：JS 只写 `--cover-src` / `--cover-src-2`，一切调校在 CSS 用 OKLCH 相对颜色语法派生。**严禁 JS 写内联 background**（会覆盖多层图层，原型踩过两次）。
4. **全链路 camelCase**（API JSON、JSON 存储、未来 SQLite 列名）；时间用 ISO 8601 UTC 字符串；时长用秒；ID 用 nanoid（在线曲目引用用 `provider:id`）。
5. **API 响应结构**：成功 `{ code: 0, data }`；失败用正确 HTTP 状态码（400/401/403/404/429/500）+ `{ code, message }`。业务码只在前端需要分支时定义。
6. **每个基础函数必须有单元测试（正常 + 异常路径），实现与测试同次提交**；无用例的基础函数视为未完成（PRD 11.2）。测试框架统一 Vitest，HTTP 集成测试用 supertest。
7. **提交信息用 Conventional Commits**（feat/fix/docs/test/refactor/chore/style），与现有仓库历史一致。

## 与需求方协作的方式（AI 必读）

1. **需求方指出问题后，先想"最优解法"，再动手。** 不要只把表面症状按掉。拿到反馈后固定做三件事：
   - **先复现并定位真因**：能在浏览器/单测里复现就复现，不要凭猜改；
   - **自问"这是最优解吗"**：列出还有哪些解法、各自代价（实现复杂度 / 视觉一致性 / 无障碍 / 可维护性），选最优的落地；有明显取舍时（例如"更漂亮但更花哨"）**把选择权交回需求方**，别默默替他决定；
   - **说清"为什么这样最好"**，而不是只报"改好了"。
2. **同一个毛病在多处出现时顺着规则一起修**：先抽出统一实现（组件 / 纯函数 / 令牌），再改调用点，并把规则写进 [`docs/dev/开发约定.md`](./docs/dev/开发约定.md)，避免下一个人照着旧写法再错一遍。
3. **自己交付前先自评一遍"这里是最优解吗"**（布局、文案、状态、异常路径都算），发现问题主动改并附上理由——不要等需求方一处处指出来。

## 常用命令

> Windows PowerShell 下 `npm.ps1` 会被执行策略拦截 → **一律用 `npm.cmd`**；链接命令用 `;`，不要用 `&&`。

| 命令                                  | 说明                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `npm.cmd install`                     | 装齐三个包（workspace）                                                   |
| `npm.cmd run dev`                     | 前端 5173 + 后端 3000 同时启动                                            |
| `npm.cmd run test`                    | 全量单测（server 103 例 + client 275 例）                                 |
| `npm.cmd run typecheck`               | `tsc --noEmit` + `vue-tsc --noEmit`                                       |
| `npm.cmd run build`                   | 后端 tsup → `server/dist`，前端 vite → `client/dist`                      |
| `npm.cmd start`                       | **生产形态**：后端一并托管 `client/dist`（一个域名同时服务前端与 `/api`） |
| `npm.cmd run format`                  | Prettier 全量格式化                                                       |
| `npm.cmd run dev -w @qingting/server` | 只起后端                                                                  |

启用门禁（三档权限）本地调试：

```powershell
$env:USER_PASSWORD='guest123'; $env:ADMIN_PASSWORD='admin123'; npm.cmd run dev
```

## 代码地图（详情见 `docs/dev/架构与代码地图.md`）

```
shared/src/index.ts       前后端共享类型与纯函数（Track/Song/Playlist/Role、扩展名白名单、hasAccess）
server/src/config.ts      环境变量 → AppConfig（PRD 5.5 全量清单，含 parseSize/parseTtl）
server/src/http.ts        统一响应 sendOk/sendFail + errorHandler
server/src/static.ts      前端静态托管（生产）：SPA 兜底 + 缓存策略（入口/SW 不缓存，assets 长缓存）
server/src/services/auth.ts  签名 Cookie 签发/验签、密码比对、密钥持久化
server/src/services/storage（data/songs.json 原子读写）、metadata（标签解析 + 文件名回退 + 内嵌歌词）、lyrics（data/lyrics/<id>.lrc 按需读写）、range（Range 解析）
server/src/middleware/     attachRole（角色解析）、requireAccess（401/403）、createLoginLimiter（429）
server/src/routes/        auth、config、songs（列表/上传/删除/重建索引/内嵌歌词）、audio（/audio + /covers）、stats、playlists
server/src/app.ts         createApp(config)（可测试装配）→ index.ts 负责 listen
client/src/assets/        logo-mark.png（品牌标记：透明底单色，供 `.brand-mark` 遮罩上色；水印已裁掉）
client/public/            PWA 图标四张（192 / 512 / maskable 512 / apple-touch-icon）—— 由 logo-mark.png
                          在真实浏览器里合成（alpha 涂白 + 主题色圆角底），构建时原样拷进 dist（RT-07）
client/src/styles/        tokens.css（令牌 + OKLCH 取色核心）、global.css（外壳与共用类）、
                          material.css（材质双模式：islands 玻璃浮岛 / flat 实心面板，含 Apple 实测配方）
client/src/layouts/       PlayerLayout（侧栏+内容+播放条，含空格键快捷键）、ConsoleLayout（控制台独立布局）
client/src/router/        路由表 + 守卫（身份决定可达页面）
client/src/stores/        auth、config、theme、player（播放器单例：队列/模式/进度/音量/单例 audio）、
                          listening（收藏与最近播放：数据在服务端 data/listening.json - PS-05）、
                          library、transfer（本地列表→上传页的 File 交接 - LC-07）
client/src/utils/         playlistEntries（歌单条目解析：能不能播 / 实时元信息 / 排序下标）、playlistExport（歌单导出：M3U8 / JSON 两个纯函数 - PS-06）、player（模式状态机与选曲，纯函数）、localFiles（文件名解析/时长探测）、
                          fileSystem（拖入文件夹递归）、metadata（ID3 读取）、keyboard（焦点判定）、format、
                          equalizer（均衡器：10 段频段 / 预设 / 曲线清洗 - PL-13）、
                          slider（滑杆几何：值↔比例 / 步长对齐 / 填充几何 / 键盘步进 - PL-13）、
                          toast（应用内提示条：唯一入口 + 队列，纯函数可测 - v5.72）、
                          coverColor（封面取色：像素→两个原始色源；JS 只写变量，调校在 CSS - VS-02）、
                          audioReactive（节奏起伏：低频**峰值** → 包络 → 相对常态归一，纯函数 - v5.91）、
                          playerState（播放存档：只存刷新后能续上的曲目 - PL-07）、shortcuts（播放快捷键判定 - PL-08）、
                          lyrics（歌词解析：LRC / 增强型 LRC / yrc）、lyricEmphasis（逐字辉光爆发参数与关键帧）、
                          spring（弹簧：阻尼简谐振子的解析解）、lyricsLibrary（手动歌词库：按曲目存 + 来源优先级 + 编码回退 - LR-02）、
                          mediaSession（锁屏/通知栏元数据与进度：纯函数 + 浏览器薄封装 - RT-04）、
                          confirm（二次确认的唯一入口：队列 + 发答案 - v5.53）、topLayer（“Esc 只关最上面那层”登记处 - v5.53）、
                          themeColor（`<meta name=theme-color>`：状态栏颜色跟主题走 - RT-07）、
                          pointer（触摸点击判定：手机上“点一下就是播这首” - v5.32）、
client/src/views/         login/local/library/listening(favorites+recent)/online/playlist/settings + immersive(/now) + console/{overview,songs,upload}
client/src/composables/   usePlayHistory（切歌时记一条最近播放 - PS-05）、
                          useActiveIndicator（量选中项位置 → CSS 变量，供共享指示条滑动：Tab 下划线 / 分段底板共用）、
                          useMediaQuery（响应式断点：只在“同一处要显示不同内容”时用 - v5.33）、
                          useNavDrawer（手机抽屉开合状态：按钮在页头、面板在外壳，两处共享 - v5.35）
                          useNavItems（一级导航项：侧栏与手机底栏共用一份 - RT-02）、
                          useMediaSession（把播放器状态接到锁屏/通知栏，挂 App.vue - RT-04）、
                          useBeat（节奏起伏：把低频强度归一成“比常态重多少”，每帧写 CSS 变量 --beat，全局只跑一个 rAF - v5.91）
client/src/components/    AppSidebar、PlayerBar（受 store 驱动）、NavToggle（手机抽屉入口，渲染在页头里 - v5.35）、
                          NavDrawer（手机左侧导航抽屉的面板 - RT-02）、
                          QueuePopover（PL-06，两套壳层：桌面 Reka Popover 浮层 / 手机 Reka Dialog 半屏底部抽屉 - v5.40）、
                          QueuePanel（队列内容：标题行 + 清空 + 列表，两壳共用一份 - v5.40）、
                          ConfirmDialog（应用内二次确认：Reka Dialog + 自绘玻璃，挂 App.vue 全站一份 - v5.53）、
                          Slider（自绘滑杆：竖=音量条与均衡器十根竖杆、横=整体增益；几何在 utils/slider.ts - PL-13）、
                          AppTooltip（自绘玻璃提示：只有图标的键共用一份，label 同时是 aria-label - v5.71）、
                          AppToast（提示条宿主：Reka Toast + 自绘玻璃，挂 App.vue 全站一份 - v5.72）、
                          EqualizerPanel（均衡器面板：设置页「音效」Tab - PL-13）、
                          SongMetaDialog（元信息编辑弹窗：上传页与曲库管理共用一份 - AD-02 / v5.61）、
                          VolumeControl（PL-04，播放条与沉浸页共用）、SegmentedControl（Reka RadioGroup + 自绘滑动底板）、
                          TrackRow（通用曲目行）、EmptyState、
                          immersive/{LyricsView,ImTitle,ImControls,LyricsSourceMenu}（沉浸页三布局共享件：歌词壳层（自研）/ 标题 / 控制栏 / 歌词来源菜单）
                          + ImLayoutDuo / ImLayoutCenter / ImLayoutPoster（布局只管自己的版式与专属视觉层 - VS-09）
client/src/utils/format.ts  formatTime/formatSize/formatDateTime
```

## 当前进度

**已完成**：M1 工程骨架 + 双密码三档访问门禁（含登录页与路由守卫）+ **播放器核心（PL-01~05）与本地播放（LC-01~06）**（含 ID3 标签与内嵌封面）+ **云端曲库前后端（LB-01~06/10/11、AD-01~04）**（上传后服务端解析标签与内嵌封面、去重/覆盖、按 Range 流式播放 206/416、删除连同文件、索引重建、存储统计）+ **沉浸式播放页与歌词（3.7 / VS-03/09，三个布局全落地：经典双栏 / 沉浸歌词 / 海报彩胶；LR-04~06 + LR-07 手动滚动）** + **播放队列弹层（PL-06）** + **封面取色（VS-02：主题色 / 页面环境光 / 彩胶盘体 / 逐字发光全部跟着封面变，深浅主题分别夹取对比度）** + **曲目级持久化（PL-07：刷新后恢复队列与进度）** + **快捷转存到音乐库（LC-07）** + **播放快捷键（PL-08）** + **歌词弹簧（v4.86：按公式自行实现 `utils/spring.ts`，只参考思路不搬代码）** + **歌词来源打开与滚动键盘化（v4.87：支持增强型 LRC、可手动导入 `.lrc`/`.yrc`（按曲目记忆、GBK 回退）、歌词区键盘滚动；顺带修好开发环境封面一直没加载出来的代理缺陷）**；前后端类型检查、生产构建、**378 个单测**（server 103 + client 275）全绿；已用真实曲库（D:\Music，369 MP3 + 4 FLAC）与真实云端曲库浏览器实测播放、上传、歌词、彩胶、取色、刷新恢复、转存与快捷键。

**手机端（v5.32/5.33/5.34/5.35，RT-01/02/03/05/06）**：`<768px` 导航收进**左侧抽屉**（`NavDrawer` 面板 + 页头里的 `NavToggle` 按钮：与标题同一行、可从屏幕左缘右滑拉出，遮罩/左滑/选完自动收起）—— 桌面侧栏不变（收起 = 68px 图标条）；播放条变迷你条（**只剩 播放/暂停 + 下一首**，进度是**封面外圈的圆角矩形环** —— QQ 音乐那种，第二行显示**当前歌词**）；列表收起「专辑/来源」两列、删除键隐藏；管理台只给「请使用电脑访问」提示。手势：行单击即播（`utils/pointer.ts`）、迷你条与沉浸页左右滑切歌、沉浸页下滑收起 / 上滑歌词铺满、**长按播放键进沉浸**；均只认真实触摸。**队列（v5.40/5.41）**：手机上是**从底部升起的抽屉**（点沉浸页底部的列表键弹出，把手下滑 ≥40px 或点遮罩/Esc 收起；**最多半屏**：行多时正好盖住走带键那片——背后的东西不能透出来看，行少时贴着底部收短；点某首换曲后不自动收起）。**移动端参考对象＝Salt Player（椒盐音乐）**：无推荐流的简易首页、左侧抽屉、迷你条歌词、长按进沉浸、封面取色、横竖屏与平板、通知栏控制。**锁屏/通知栏（RT-04）**：锁屏显示封面+歌名+歌手+专辑，六个动作全接上（`utils/mediaSession.ts` + `useMediaSession`，挂在 `App.vue`）。

**曲目元信息可编辑（v5.61，AD-02）**：上传的音频可能压根没有标签（或写错了），所以“曲库索引里的显示信息”要能手动改 —— 改的是**索引**、不重写音频容器里的标签；改过的字段记在 `Song.editedFields` 里，**重建索引时保住它们**（没改过的照旧按标签重抽），客户端只提交**真正改过的字段**（`utils/songMeta.ts`，否则歌手/专辑会永久脱离标签）。一个弹窗（`SongMetaDialog.vue`）两处入口：上传队列「已完成」那一行给「编辑信息」（标签缺失时这枚键着色提示）、曲库管理每行给「编辑曲目信息」；保存后列表当场变名、队列里正在播的那一份也跟着变，歌单展示改用实时元信息。

**歌单（v5.58，PS-01~06）**：歌单存在服务器端（`data/playlists.json`，与曲库索引同一套原子写法）；接口 `GET / POST / PUT / DELETE /api/playlists` + `PUT /api/playlists/:id/items`（**整表替换**，添加/移除/排序都是一件事），权限按 AC-03 归**访客级**。前端：侧栏「歌 单」分区接上真数据（＋行内输入新建、曲目数徽标）+ 歌单详情页（头部/播放全部/重命名/删除/添加曲目选择器/移除单曲/**拖拽排序**）；“这条能不能播”收在 `utils/playlistEntries` 一处（云端被删 / 本地缺失 / 在线未接入三种情况各自有话说）。**排序（v5.63 / PS-04）**：序号格兼把手（平时是序号，hover / 聚焦 / 触屏是把手图标），指针事件跟手拖拽（落点线 + 边缘自滚 + `touch-action: none`），也支持键盘 ↑ ↓ 且挪完焦点归位；下标运算在 `movePlaylistItem`（纯函数、有单测），仍走整表替换。**导出（v5.64 / PS-06）**：「导出」下拉菜单（Reka DropdownMenu）两种格式 —— **M3U8** 给能播的写绝对地址、本地/在线/已删的写成注释行（不假装能播），**JSON** 带 `format`+`version` 可还原；整个导出在浏览器里生成文件，不走服务端（`utils/playlistExport`，纯函数 + 10 例单测）。**未做**：收藏/最近播放（PS-05），P2。

**PWA（v5.65，RT-07）**：`vite-plugin-pwa`（选型表指定）—— manifest（standalone、192/512/maskable 图标、`theme_color` 与页面底色一致）+ Service Worker **只预缓存应用外壳与构建产物**（93 项，音频不缓存）；`/api`、`/audio`、`/covers` 进 `navigateFallbackDenylist`（否则离线时被 SPA 兜底成一份 index.html）。图标由 `client/public/` 下的四张 PNG 提供，**用应用自己的 `logo-mark.png` 在真实浏览器里合成**（alpha 涂白 + 主题色圆角底），与界面里的 `.brand-mark` 同源；`theme-color` 跟手动主题走（`utils/themeColor.ts`）；iOS 另补 `apple-touch-icon` 与三个 `apple-mobile-web-app-*` meta。实测：断网重载外壳照旧打开，`/audio` 不被兜底。

**提示（Tooltip，v5.71）**：Reka 的 Tooltip 落地成共用的 `components/AppTooltip.vue`，`App.vue` 挂**一个** `TooltipProvider`（400ms 延迟；连续移到下一枚键不再等；只有键盘聚焦才开；指针离开即收）。**只有图标的按钮用它**（`label` 同时就是 `aria-label` —— 图标键没有可见文字，名字不能丢），有可见文字的控件仍写原生 `title`（截断时看全文）。队列键与歌词来源键的触发键收在壳层组件里（`QueuePopover` / `LyricsSourceMenu`，调用方只传 `label`）；提示挂在这两枚**按钮里面的图标**上（见坑 25）。

**提示条（Toast，v5.72）**：`utils/toast.ts`（唯一入口 `showToast` + 队列）+ `components/AppToast.vue`（Reka Toast，挂 App.vue）。**判据**：与当前操作无关、消失也不影响继续操作的消息走提示条（播放异常、后台任务结果）；绑在控件/表单项上的错误留在原地（表单校验、上传某一行失败、带“重试”的失败面板）。**PL-09 的播放提示已改走它**（`stores/player` 的 `notify()`，出错 `danger` + 10s），播放条里那行红字与 `notice` 状态都已移除。

**收藏与最近播放（v5.67，PS-05）**：数据在服务端 `data/listening.json`（手机上收藏的、电脑上看得见；清一次浏览器数据不会把它清掉）。接口 `GET /api/listening` + `POST/DELETE /api/listening/favorites` + `POST/DELETE /api/listening/recent`（均访客级，引用口径与歌单同一套身份键）——收藏幂等、最近播放去重置顶并截到 100 条。前端：`stores/listening`（不做乐观更新，一律用服务端返回的那一份回填）+ `composables/usePlayHistory`（挂在 App.vue，切歌时记一条）+ `views/ListeningView`（`/favorites`「我的收藏」与 `/recent`「最近播放」两页共用一份组件，行复用 `TrackRow` 的收藏键；v5.83 从「我的音乐」+ 两页签拆开的 —— 需求方：“这个标题应该叫我的收藏或者我喜欢，其次最近播放列表应该单开一个在侧边栏里面，现在这种布局让你迷惑”）+ 播放条与沉浸页各一枚收藏键（播放条那枚在**队列键左侧**、与队列并列在最右 —— 中间那组键因此对进度条左右对称，实测播放键中心与进度条中心重合；状态色由 `.ctl.is-on` 一条规则给三处共用，v5.70）；手机上播放条那两枚一起收起（最右那组整组 `display: none`），入口在沉浸页控制栏。**未做**：均衡器（PL-13）。

**均衡器（v5.68，PL-13）**：设置 › 音效。音频路径 `<audio>` → MediaElementSource → 10 段 BiquadFilter 链（31Hz~16kHz）→ 整体增益 → 限幅器（防爆音）→ 输出；**懒建图、拿到用户手势才接线**（`AudioContext` 没手势时 suspended，接进挂起的图里就是静音 —— 所以建图 / `resume()` / 接线分三步），**A/B 关闭时真直通**（source 直接连输出），设置存 `localStorage`（每设备一份）。界面的十根竖杆与整体增益用共用的 `components/Slider.vue`（竖/横同一个实现，几何在 `utils/slider.ts` —— 原生 range 旋转拖不动、填充语义也不对，坑 7 / 23），预设用 Reka Select。**未做**：频谱可视化（VS-05，选型表里与 EQ 共用同一张图）。

**节奏起伏（v5.91，VS-09 彩胶唱片布局；v5.90 曾用 canvas 加法光）**：外圈柔光从“一张图当遮罩”改成纯 CSS 三团渐变（v5.89），再让它在鼓点上**吞吐**一下 —— 需求方：“我的想法光晕会随着音乐的节奏起伏就好了”（对比过 Houdini Paint Worklet：Firefox / Safari 不支持，不能用）。分析走 `AnalyserNode` 旁路挂在**均衡器那份**音频图上（`createMediaElementSource` 一个元素只能建一次，所以必须复用；`stores/equalizer` 导出 `getAnalyser()`）；算法全在 `utils/audioReactive.ts`（低频峰值 → 快起慢落包络 → 相对常态归一，纯函数 + 20 例单测）；循环只有一份（`composables/useBeat`）—— 它每帧**只写一个 CSS 变量 `--beat`**，缩放与亮度交给 CSS 的 `calc()`（`.glow-pulse` 那层包装元素就是为此加的：里面的 transform / opacity 被自转与呼吸动画占着），**没有音频 / 关开关 / 减动效时 `--beat` 恒为 0 = 纯底光，不需要降级分支**。v5.91 撤掉了 v5.90 那层 canvas（随机甩光斑）：“其他不用做那么多”；也记下第一版的坑：**只把原始强度缩放上去等于没动**（实测 `--beat` 挤在 0.70~0.89、缩放只差 1.3%），所以指标改峰值 + 加一层“相对常态”归一（细节见 PRD v5.91 行）。开关在 设置 › 外观「光晕跟随节奏」（默认开，`qt-glow-beat`）。

**下一步**（建议顺序）：**在线音源（3.5，需求方定：放到最后）** → **数据层统一迁 SQLite**（v5.60 定稿：功能全部做完再动，现阶段保持 JSON 文件）。生产静态托管已完成（v5.66）：`npm run build` 后 `npm start` 就是完整形态。

进度明细、留白清单、下一步开工要点见 [`docs/dev/进度与交接.md`](./docs/dev/进度与交接.md)。

## 环境已知坑

1. **TypeScript 必须锁 5.x**：本机装的是 TS 7，`vue-tsc` 3.x 依赖 `typescript/lib/tsc`（TS 7 已移除该导出）会直接崩。根 `package.json` 已用 `overrides` 固定 `^5.9.3`；**改 overrides 后需删除 `node_modules` + `package-lock.json` 重装才生效**（npm 不会自动降级已提升的版本）。
2. **npm workspace 装包偶发不写入**：曾出现 `npm install -w @qingting/client <pkg>` 报 `no workspace folder present` 且依赖没进 `package.json`；装完请 `Get-Content <pkg>/package.json | Select-String <dep>` 复核。
3. esbuild 的 postinstall 被本机策略拦截（有告警），不影响运行（平台二进制走 optionalDependencies）。
4. **中文 commit message 用文件传入**：PowerShell 5.1 向原生程序传中文参数存在编码风险，一律 `git commit -F <UTF-8 文件>`（写文件时用 `[IO.File]::WriteAllText($p, $m, (New-Object Text.UTF8Encoding($false)))` 避免 BOM）。
5. **`<template>` 里别挂"测量用隐藏元素"**：为一个 `.vue` 模板多加一个 `visibility:hidden` 的探针 span，`vue-tsc` 会生成错误的虚拟代码——实测表现为模板里明明在用 `IconSkipBack`/`playIcon` 等，却报 4 个 `TS6133 声明未读取`，且改样式/重跑都不消失（删掉那个 span 立刻恢复正常）。需要量尺寸就用离屏探针（`utils/marquee.ts` 的 `measureTextWidth`，注入宿主便于单测），模板保持干净。判断技巧：`vue-tsc` 只报“模板专用符号未使用”，而模板里的类型错误照常报出，就是踩了这个坑。
6. **Teleport 出去的内容没有 scoped 属性**：用 Reka 等库做弹层时，内容会被 Teleport 到 `body`，而 Vue 的 `<style scoped>` 生成的是 `.cls[data-v-x]`——**元素上没有 `data-v-x`，规则直接不匹配**，表现是“弹层弹得出来但完全没样式”（不是被覆盖，是从没生效）。弹层样式一律写在**非 scoped** 的 `<style>` 里，隔离靠类名前缀。v4.60 实测：两个弹层同时中招。
7. **原生 `input[type=range]` 旋转后拖不动**：加 `transform: rotate(-90deg)` 做竖向滑杆时，**点击映射是对的、拖动不跟手**（浏览器用未旋转的几何算位移；实测从底拖到顶只动 1%）。竖向滑杆一律自绘（pointer 事件 + 自己算比例），键盘与 `role="slider"` 一并自己补。v4.64 实测。**v5.68 起统一收到共用的 `components/Slider.vue`**（v5.69 改名并扩成竖/横两种朝向，几何在 `utils/slider.ts`）：音量条、均衡器十根竖杆、整体增益都用它，别再写第二份；它的**填充**也别用原生 range 那套（坑 23）。
8. **页面不可见（`visibility: hidden` / 后台标签）时 CSS `transition` 不推进**：`getComputedStyle(el).transform` 读到的是**动画开始前的旧值**（与已知的「不可见时 rAF 不触发」同源）。v4.82 实测——我因此一度误判歌词列表“位移慢一拍”，其实内联 `style` 一直是对的。判断这类问题**看 `el.getAttribute("style")`（绑定值），不要看 computed（动画中间值）**。
9. **许可（v4.86）**：本项目自身未指定开源许可，且**不含 AGPL / GPL 代码**（v4.84 曾接入 AMLL 的 npm 包 → v4.85 改为移植其代码 → v4.86 连移植也换成**按公式/按效果自行实现**）。装新依赖前先 `npm view <pkg> license`，**不要再引入强拷贝依赖**；想拄某个实现必须先看许可（AGPL 不能拄，只能参考思路）。
10. **逐帧推进的动画在页面不可见时会停住（rAF 不触发）**（v4.85）：歌词列表位移改成弹簧逐帧推之后，后台标签页里弹簧不推进、位置会停在旧值。所以 `driveTo()` 在 `document.visibilityState !== "visible"` 时直接落位（不做动画）；其它新加的逐帧动画也要给这条退路。
11. **后端挂在根路径下的媒体路由，开发代理要同步补一条（v4.87）**：`client/vite.config.ts` 只代理了 `/api` 与 `/audio`，**漏了 `/covers`**——漏了不会报错，而是被 Vite 的 SPA 兜底成 `index.html`（200 `text/html`），表现是“封面静默加载不出来”＋取色退回默认色（实测 `<img>.naturalWidth` 一直是 0）。**以后后端每加一个根路径路由（如 `/lyrics`），代理里同时加一条**；判断这类问题看响应类型（`text/html` 就是被兜底了），不要只看状态码。**生产构建里同一条由 Service Worker 的 `navigateFallbackDenylist` 兜住（v5.65，RT-07）**：`/api`、`/audio`、`/covers` 都在名单里 —— 漏了的话离线时它们会被兜底成一份 `index.html`（比开发期更隐蔽）。

12. **`npx.ps1` 同样被拦截（v5.32）**：与第 1 条同源—— `npx -y <pkg>` 在 PowerShell 下会报“未对文件 npx.ps1 进行数字签名”，**一律用 `npx.cmd`**。

13. **vitest 偶发 worker 崩（v5.38 实测一次；v5.89 一天撞了四次）**：日志里是 `Worker exited unexpectedly with exit code 3221226505`（= `0xC0000409`）+ `Test Files 8 passed (9)`、`Errors 1 error`，**没有一个断言失败** —— 这是 worker 进程在系统层崩了，不是你的改动坏了代码（四次撞的文件是 `songs.lyrics` / `static` / `playlists.routes` 这些**互不相关**的用例，且都发生在本地开着 `npm run dev` 的时候，疑似资源竞争）。判据：`Tests x passed (y)` 里 y 小于用例总数、且没有 `FAIL`/`AssertionError`。处理：**重跑一次** `npm.cmd run test` 即可（实测每次重跑都全绿）；如果连续两次都在**同一个文件**崩，再去查那个文件的用例。

14. **同一个键多层都在听时，靠“注册顺序”不可控（v5.40）**：沉浸页在 `window` 上听 Esc（收起整页）、Reka 弹层也在 `window` 上听 Esc（关自己），两个同级监听谁先注册谁先跑 —— 实测按一下**把抽屉和整页一起关了**。修法：在最上层挂**捕获阶段**的 `window` 监听（捕获一定早于冒泡），拦住事件并自己关闭最上面那层，保证“Esc 只关最上面那层”。同理，凡是有层级语义的交互，都要由**最上层主动吃掉**事件，不能指望下层自觉让路。

15. **无头浏览器里 `backdrop-filter` 不参与合成（v5.40）**：抽屉用玻璃（`--panel-bg` + `blur(64px)`，总遮盖度算下来 0.94）时，背后那排走带键在截图里**能认出形状** —— 因为模糊压根没生效（`getComputedStyle` 里照样声明着 `blur(64px)`，**声明了不等于渲染了**）。两条结论：① 验证“玻璃够不够挡”别只看截图，也别只信 computed 值；② **不要拿模糊当“藏信息”的手段** —— 真的不能露（背景里是同屏的第二套控件）就该让它是不透明面。（v5.46 补充：**VS Code 自带浏览器（Electron）**里同样不参与合成 —— 它恰好可以当“模糊不在时还看不看得清”的最坏情况环境；左侧抽屉的玻璃因此取 0.80/0.88，而不是小浮层的 0.46/0.52。）**同类现象（v5.64 实测）**：无头 Firefox 里对**浮层**（带定位包装层的 Popover / 菜单）截图会把它拍成半透明 —— 面板的 `backgroundColor` 量出来是不透明的 `rgb(255,255,255)`、`opacity` 是 1，截图里却像 10% 的白纱。别急着改 CSS，换真实浏览器（VS Code 自带那个）一看就正常。

16. **验证浏览器时别只收 `error`，`warning` 也要看（v5.42 实测）**：前几版的无头脚本只写 `if (m.type() === "error")`，于是一条 Reka 的无障碍告警（`Missing Description or aria-describedby … for DialogContent`）从 v5.40 起一直没被发现 —— 换到 VS Code 自带浏览器（`browser_console_messages` 会把 warning 单列出来）才看到。两条：① 弹层的 a11y 属性要配全（Reka 的 `Dialog` 对 `DialogTitle` **和** `DialogDescription` 都有要求，`Popover` 没有）；② 验证脚本把 warning 一并报出来。

17. **同一组件在两处渲染时，别用通用选择器做布局开关（v5.34 埋、v5.43 才发现）**：手机端要藏“外壳里那条常驻侧栏”，写成了通用的 `.sidebar { display: none }` —— 而左侧抽屉（`NavDrawer`）里渲染的是**同一个** `AppSidebar`，于是抽屉里那份也被藏了：点 ☰ 之后只看到一层遮罩、什么都没有，再点也没反应（点到的其实是遮罩），因为抽屉面板自己没有底色（这个 bug 从 v5.34 活到 v5.43）。两条：① 布局开关要限定到宿主（`.app > .sidebar`），别按组件内部的类名通判；② 验证“抽屉/弹层打开了”不能只看它的 transform 或遮罩状态，要**量到里面的内容**（元素在不在、`display` 是不是 none、盒子多大）。
    **同族第二例（v5.44）**：`AppSidebar` 里四条 `.app.collapsed …`（改内容层宽度、藏标签、藏折叠箭头、藏新建按钮）同样会跨进抽屉 —— 外壳一旦处于折叠态，抽屉里的标签/新建按钮就被藏、内容层宽度只剩 68px；已全部收窄为 `.app.collapsed > .sidebar …`。另：内容层的**宽度**也不能写死（那里写的是桌面列宽 224，抽屉只有 208，溢出的部分被 `overflow: hidden` 裁掉，表现是“选中项背景右侧被切平”——行的右圆角与 12px 内缩全没了）。判据：**凡是以“外壳/宿主状态”为前提的规则，选择器就从外壳那一层写起；宿主差异（宽度、断点、折叠态）一律由宿主那层给。**
    **同族第三例、反方向（v5.79）**：`>` **直接子选择器太具体**也会静默失配 —— 列表页骨架靠 `.cs-main:has(> section.page-frame) { overflow: hidden }` 把岛变成固定帧，控制台的页框外面后来多了一层 `.cs-body`（手机端整块隐藏用），于是失配：岛继续自己滚、页框的 `height: 100%` 又没有确定高度可依，症状是**页头跟着列表一起滚走**（实测页头 top 14 → −226，而音乐库稳定在 36），同处还漏了 `.cs-main > section { padding-top: 22px }`。所以：**依赖 DOM 层级的契约用后代匹配**（或在加包装层时同步改选择器），改完按“页头位置 / 岛能不能滚 / 内层能不能滚”三项量一遍，别只看截图。

18. **`force-mount` 常驻 DOM 的三个连带后果（v5.50 → v5.56 实测）**：给 Reka 的弹层（`Dialog` / `Popover`）做**收起动画**时，标准做法是 `force-mount`（它默认一关就卸载，压根没有能播离场动画的元素）+ 用 `data-state` 驱动 CSS 过渡，base 态写成“收在屏幕外”。但这样元素**一直在 DOM 里**，于是：① **`opacity: 0` 不等于不可点** —— 关闭态的遮罩会拦住全页点击（实测：列表里的行都点不动了），必须补 `visibility: hidden`（离散属性，过渡结束时才隐藏，所以离场动画仍然放得完）；② 任何靠 `body:has(...)` / 状态类做联动的规则，**选择器都要带上 `[data-state]`**（否则“打开时把背后的控件淡出”会变成永久淡出）；③ **内容不能跟着数据一起消失**（v5.55）：弹层的内容常由“当前请求 / 当前选中”这类数据驱动，而用户一作答（或数据被清）时那份数据就没了 —— 如果模板直接绑它，标题/正文当场变空，卡片高度从 169 塌到 79，看上去就是“窗口先收缩再消失”（这条同样与模糊无关，`transform` 只是第二个观感问题）。做法：组件里留一份“**正在展示的那份**”副本（只进不出，下一段数据来了再替换），并把“层登记 / 焦点”这类副作用改挂在 `open`、请求 `id` 上，而不是那份数据本体。

19. **`transition: visibility <时长>` 会让弹层“打开后前半个时长仍然是 hidden”（v5.53 实测）**：Reka 弹层用 `force-mount` + `visibility: hidden` 表达关闭态（为什么不能用 `opacity: 0` 见第 18 条）。但 `visibility` 是**离散属性**，现代引擎按“过渡过半才翻转”处理 —— 写 `transition: opacity .2s, visibility .2s` 时，打开后的前 100ms 元素仍然 hidden：渐变看着正常（`opacity` 在动），但**对 hidden 元素调 `focus()` 会静默失败**。症状是“焦点还留在背后的触发按钮上”（后果：回车把弹层又调一遍），时间线上 0ms / 16ms 两次聚焦都没产生 focusin，100ms 后手动聚焦才成功。写法：关闭态 `visibility 0s <时长>`（先播完淡出再隐藏）、打开态 `visibility 0s`（立即可见）；`opacity` / `transform` 照旧。

20. **删文件类命令先 dry-run，别把 `storedName` 当曲目 id（v5.60 血的教训）**：曲库索引里 `id` 与 `storedName` 是**各自独立生成的 nanoid**（`services/storage.ts` 里写明了“id 给前端引用、落盘名另外生成”），两者长度与字符集一样，肉眼分不出。我曾用“文件名 basename 不在 id 列表里”当孤儿判定去清 `uploads/`，结果把 **14 个音频全删了**（索引还在、文件没了，界面上就是一排点不动的鬼影）。两条：① 任何批量删除先只**打印**要删的清单，确认无误再执行；② “这个文件属于哪条曲目”必须用 `storedName` 字段对齐，不要拿 `id` 或 basename 猜。恢复办法（本项目特有）：索引里记着 `originalName` + `size`，可以从原始曲库目录按“名字 + 体积”精确拷回 `uploads/<storedName>`（实测 14/14 恢复，206 流式播放与封面全部正常）。

21. **给 Reka 浮层做 `force-mount` 时，要连它的包装层一起关掉命中区（v5.62 实测）**：我们只给自己的面板写了 `visibility: hidden` + `pointer-events: none`，但带定位的浮层（Popover / Tooltip）外面还有 Reka 自己的一层包装元素（`[data-reka-popper-content-wrapper]`）—— 它 `pointer-events: auto`、盒子就是面板大小（**`visibility: hidden` 的子树照样占位**），于是收起状态下仍有一块隐形矩形**吞掉那块区域的点击**（实测：音乐库列表下部的「播放」按钮点不动，Playwright 直接报该元素 `intercepts pointer events`；量出来是一块 390×116 的隐形区盖在播放条右下）。包装层没有我们的类名，只能从里面反着关：`[data-reka-popper-content-wrapper]:has(> .q-pop[data-state="closed"]) { pointer-events: none }`。判据：**“浮层收起了”不能只看 transform / opacity / visibility，要拿 `document.elementFromPoint()` 量那块地方到底能点到谁**。（Dialog 类浮层不在带定位的包装层里 —— 内容自己 `visibility: hidden` 即不可点，故确认框/元信息弹窗无此问题。）

22. **开发期偶尔某个 `~icons/*` 模块 504（v5.67 实测）**：Vite 重启或依赖集变化后会重新优化依赖，此期间首访页面可能报一串 `Loading failed for the module .../@id/~icons/ph/xxx` + 路由报错，**重载即好**，不是代码问题；生产构建不受影响（图标在构建期已内联）。判断技巧：报错模块随机、多次刷新位置不一样，就是优化器在重排。

23. **双极（±）控件别用原生 `input[type=range]`（v5.69 实测）**：原生 range 的填充是**从 min 端起算**的（`-10~+10` 在 0 处就填满一半），而 Chromium 会画这条填充、Firefox 干脆不画 —— 同一根控件两个引擎两种观感；「从中线往两侧长」原生压根没有。更阴的是本仓 `tokens.css` 里那段 range 配方要求**时时维护渐变断点 `--p`**（原型里真有那段 JS，我们当初只搬了 CSS）—— 于是填充永远停在默认 50%：实测整体增益 `+10dB` 时条子仍只填到中线、手柄已到最右。现在竖横两种滑杆都是自绘的 `components/Slider.vue`（几何在 `utils/slider.ts`），要用滑杆就用它。判据：改完滑杆**量填充的起止百分比**（`fillGeometry` 的 `start` / `size`），别只量手柄位置 —— 手柄是对的、填充是错的，这种「半对」最容易被放过去。

24. **`force-mount` 的弹层要当心两件“库内部判别”的事（v5.71 实测）**：① Reka 的 DismissableLayer 靠 `index === layers.size - 1`（“我得是最上面那层”）决定吃不吃 Esc；常驻 DOM 的层会一直登记在 `layers` 里 —— 所以**凡是我们自己 `force-mount` 的层，Esc 都自己接**（走 `utils/topLayer` 的捕获监听，别留给行为层的默认实现）；判断“某层的 Esc 好不好使”不能只看代码，得在真浏览器里按一下。② **进场动画必须挂在 `[data-state]` 上，不能写在内容的基础类里**：Reka 的 Presence 靠 `animationName` 判断“要不要等退场动画放完”，基础类上永远挂着一个动画名时，关闭时它会去等一个**永远不来的 `animationend`** —— 节点不卸载（表现是提示“赖着不走”，还一直占着 ① 里那个名额），修法：`.tip[data-state="delayed-open"], .tip[data-state="instant-open"] { animation: … }`。

25. **别把 `Tooltip` 套在 `Popover`/`Dialog` 的触发器外面（v5.74 踩、v5.75 绕过、v5.77 更正成因）**：`PopperAnchor` 只做一件事 —— `rootContext.onAnchorChange(props.reference ?? currentElement.value)`，而 `rootContext` 来自 `injectPopperRootContext()`，也就是**最近的那个** `PopperRoot`。`TooltipRoot` 自己就会渲染一个 `PopperRoot`，所以 `<AppTooltip><PopoverTrigger>…` 这种“提示在外”的写法里，**Popover 的触发器把锚点登记到了 Tooltip 的 Root 上**，`PopoverContent` 读自己的 Root 永远是 `undefined` → floating-ui 兜底成“零尺寸虚拟元素在 (0,0)” → 浮层落到 `translate(0, -200%)`（实测 `.q-pop` 盒 `0,-208`，`elementFromPoint` 拿到 `null`），而 `data-state` / `visibility` / `opacity` 全对 —— 用户看到的只是“点了没反应”。**判别方法**：对照量两份浮层的位置 —— 那一版里**提示是对的**（`translate(750px, 667px)`）、**只有浮层错**；若真是“两层 `PopperAnchor` 抢同一元素”，坏的该是提示或两个都坏（我第一版就是这么误判的；另外，一个元素上叠两层 `as-child` 本身**是允许的** —— Vue 会把两层的 ref 合并后逐个调用）。**正确写法（v5.75）**：把提示挂在**按钮里面的图标**上（`<button :aria-label="…"><AppTooltip :label="…"><IconX class="icon" /></AppTooltip></button>`）—— 每个触发器都离自己的 Root 最近，图标又是个真元素（提示锚点就在按钮内、相邻几像素）；代价是 `aria-describedby` 落在图标上，键的**名字**仍由按钮自己的 `aria-label` 给。**一句话规则：触发器和它的内容必须是同一个 `PopperRoot` 下的兄弟，别把 A 的触发器塞进 B 的 Root 里。** 判据：**判断“浮层开了没有”必须量它的盒子在不在视口内**，别只读 `data-state`（我因此漏过两轮）。**上游查过（v5.77）**：这条没人报过（全仓搜 `PopperRoot` 5 条均无关、`anchor` + `offscreen` 0 条）；#923（同场景）官方答复是“可以自由组合”，#2826（v3 roadmap）承认“A Trigger must live inside its Root's subtree”并要用 detached triggers 解决 —— 属于**隐式约束**，官方文档里查不到；需求方定：不提 issue，只把规则写进本仓。
    **同族第二例（v5.76）**：提示挂到图标上后，指针点一下会把 DOM 焦点落到**图标自己**身上（实测 `document.activeElement` 是那个 `<svg>`，按钮反而没拿到焦点），Chromium 于是给它画一圈默认焦点环 —— 深色面板上就是一个黑框。所以 `global.css` 里 `.icon` 统一 `outline: none`：**焦点环归控件（按钮/链接/输入框），图标只是图形**。这条规则看着无用（图标又没 `tabindex`），删掉就会把黑框请回来。

26. **别用管道 / 重定向去“安静地”跑 npm 脚本（v5.82 又踩一次）**：`npm.cmd run test *> $null`（以及 `2>&1 | Select-String …`）会让 `$LASTEXITCODE` **假报非 0**，而单测其实全绿 —— npm 的 `notice` 走 stderr，被 PowerShell 当成原生命令错误。判据：**只读 vitest 自己那两行**（`Test Files 16 passed` / `Tests 185 passed`），或让命令原样输出再单独取 `$LASTEXITCODE`。同理，`Get-Content … | Select-String` 处理中文还会输出乱码，看构建结果别加选择器。

## 文档索引

| 文档                                                         | 内容                                                                          |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| [`docs/dev/架构与代码地图.md`](./docs/dev/架构与代码地图.md) | 目录结构、请求链路、鉴权设计、数据模型、样式体系、扩展指引（怎么加接口/页面） |
| [`docs/dev/开发约定.md`](./docs/dev/开发约定.md)             | 命名、TS、测试、CSS/组件、Git 等落地细则与待补项                              |
| [`docs/dev/进度与交接.md`](./docs/dev/进度与交接.md)         | 里程碑状态、已交付清单、验证记录、留白清单、下一步开工要点                    |
| [`音乐软件需求文档.md`](./音乐软件需求文档.md)               | 需求唯一权威来源（含全部需求编号与决策记录）                                  |
