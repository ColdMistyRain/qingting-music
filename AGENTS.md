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

| 命令                                  | 说明                                                 |
| ------------------------------------- | ---------------------------------------------------- |
| `npm.cmd install`                     | 装齐三个包（workspace）                              |
| `npm.cmd run dev`                     | 前端 5173 + 后端 3000 同时启动                       |
| `npm.cmd run test`                    | 全量单测（server 103 例 + client 275 例）            |
| `npm.cmd run typecheck`               | `tsc --noEmit` + `vue-tsc --noEmit`                  |
| `npm.cmd run build`                   | 后端 tsup → `server/dist`，前端 vite → `client/dist` |
| `npm.cmd run format`                  | Prettier 全量格式化                                  |
| `npm.cmd run dev -w @qingting/server` | 只起后端                                             |

启用门禁（三档权限）本地调试：

```powershell
$env:USER_PASSWORD='guest123'; $env:ADMIN_PASSWORD='admin123'; npm.cmd run dev
```

## 代码地图（详情见 `docs/dev/架构与代码地图.md`）

```
shared/src/index.ts       前后端共享类型与纯函数（Track/Song/Playlist/Role、扩展名白名单、hasAccess）
server/src/config.ts      环境变量 → AppConfig（PRD 5.5 全量清单，含 parseSize/parseTtl）
server/src/http.ts        统一响应 sendOk/sendFail + errorHandler
server/src/services/auth.ts  签名 Cookie 签发/验签、密码比对、密钥持久化
server/src/services/       storage（data/songs.json 原子读写）、metadata（标签解析 + 文件名回退）、range（Range 解析）
server/src/middleware/     attachRole（角色解析）、requireAccess（401/403）、createLoginLimiter（429）
server/src/routes/        auth、config、songs（列表/上传/删除/重建索引）、audio（/audio + /covers）、stats
server/src/app.ts         createApp(config)（可测试装配）→ index.ts 负责 listen
client/src/assets/        logo-mark.png（品牌标记：透明底单色，供 `.brand-mark` 遮罩上色；水印已裁掉）
client/src/styles/        tokens.css（令牌 + OKLCH 取色核心）、global.css（外壳与共用类）、
                          material.css（材质双模式：islands 玻璃浮岛 / flat 实心面板，含 Apple 实测配方）
client/src/layouts/       PlayerLayout（侧栏+内容+播放条，含空格键快捷键）、ConsoleLayout（控制台独立布局）
client/src/router/        路由表 + 守卫（身份决定可达页面）
client/src/stores/        auth、config、theme、player（播放器单例：队列/模式/进度/音量/单例 audio）、
                          library、transfer（本地列表→上传页的 File 交接 - LC-07）
client/src/utils/         player（模式状态机与选曲，纯函数）、localFiles（文件名解析/时长探测）、
                          fileSystem（拖入文件夹递归）、metadata（ID3 读取）、keyboard（焦点判定）、format、
                          coverColor（封面取色：像素→两个原始色源；JS 只写变量，调校在 CSS - VS-02）、
                          playerState（播放存档：只存刷新后能续上的曲目 - PL-07）、shortcuts（播放快捷键判定 - PL-08）、
                          lyrics（歌词解析：LRC / 增强型 LRC / yrc）、lyricEmphasis（逐字辉光爆发参数与关键帧）、
                          spring（弹簧：阻尼简谐振子的解析解）、lyricsLibrary（手动歌词库：按曲目存 + 来源优先级 + 编码回退 - LR-02）、
                          mediaSession（锁屏/通知栏元数据与进度：纯函数 + 浏览器薄封装 - RT-04）、
                          pointer（触摸点击判定：手机上“点一下就是播这首” - v5.32）、
client/src/views/         login/local/library/online/playlist/settings + immersive(/now) + console/{overview,songs,upload}
client/src/composables/   useActiveIndicator（量选中项位置 → CSS 变量，供共享指示条滑动：Tab 下划线 / 分段底板共用）、
                          useNavItems（一级导航项：侧栏与手机底栏共用一份 - RT-02）、
                          useMediaSession（把播放器状态接到锁屏/通知栏，挂 App.vue - RT-04）
client/src/components/    AppSidebar、PlayerBar（受 store 驱动）、MobileTabBar（手机底部标签栏 - RT-02）、
                          QueuePopover（PL-06，Reka Popover）、
                          VolumeControl（PL-04，播放条与沉浸页共用）、SegmentedControl（Reka RadioGroup + 自绘滑动底板）、
                          TrackRow（通用曲目行）、EmptyState、
                          immersive/{LyricsView,ImTitle,ImControls,LyricsSourceMenu}（沉浸页三布局共享件：歌词壳层（自研）/ 标题 / 控制栏 / 歌词来源菜单）
                          + ImLayoutDuo / ImLayoutCenter / ImLayoutPoster（布局只管自己的版式与专属视觉层 - VS-09）
client/src/utils/format.ts  formatTime/formatSize/formatDateTime
```

## 当前进度

**已完成**：M1 工程骨架 + 双密码三档访问门禁（含登录页与路由守卫）+ **播放器核心（PL-01~05）与本地播放（LC-01~06）**（含 ID3 标签与内嵌封面）+ **云端曲库前后端（LB-01~06/10/11、AD-01~04）**（上传后服务端解析标签与内嵌封面、去重/覆盖、按 Range 流式播放 206/416、删除连同文件、索引重建、存储统计）+ **沉浸式播放页与歌词（3.7 / VS-03/09，三个布局全落地：经典双栏 / 沉浸歌词 / 海报彩胶；LR-04~06 + LR-07 手动滚动）** + **播放队列弹层（PL-06）** + **封面取色（VS-02：主题色 / 页面环境光 / 彩胶盘体 / 逐字发光全部跟着封面变，深浅主题分别夹取对比度）** + **曲目级持久化（PL-07：刷新后恢复队列与进度）** + **快捷转存到音乐库（LC-07）** + **播放快捷键（PL-08）** + **歌词弹簧（v4.86：按公式自行实现 `utils/spring.ts`，只参考思路不搬代码）** + **歌词来源打开与滚动键盘化（v4.87：支持增强型 LRC、可手动导入 `.lrc`/`.yrc`（按曲目记忆、GBK 回退）、歌词区键盘滚动；顺带修好开发环境封面一直没加载出来的代理缺陷）**；前后端类型检查、生产构建、**378 个单测**（server 103 + client 275）全绿；已用真实曲库（D:\Music，369 MP3 + 4 FLAC）与真实云端曲库浏览器实测播放、上传、歌词、彩胶、取色、刷新恢复、转存与快捷键。

**手机端（v5.32，RT-01/02/03）**：`<768px` 侧栏隐藏 + 底部标签栏（`MobileTabBar`：本地播放 / 音乐库 / 设置，选中态只改主题色与字重）；播放条变迷你条（封面+信息+三枚走带键+顶沿 3px 进度线）；列表收起「专辑/来源」两列、删除键隐藏；管理台只给「请使用电脑访问」提示；行的触摸单击即播放（`utils/pointer.ts`）。**移动端参考对象＝Salt Player（椒盐音乐）**：无推荐流的简易首页、迷你条可显歌词、长按播放键进沉浸、封面/壁纸取色、横竖屏与平板、通知栏/系统媒体控制 —— 与原型同为参考而非教条。**锁屏/通知栏（RT-04）**：锁屏显示封面+歌名+歌手+专辑，播放/暂停/上一个/下一个/快退快进六个动作全接上（`utils/mediaSession.ts` + `useMediaSession`，挂在 `App.vue`）。

**下一步**（建议顺序）：歌单（3.6，需服务端）→ 在线音源（3.5，需服务端）→ 移动端手势与横竖屏（RT-05/06，按 Salt Player 的交互语言）→ 生产静态托管（服务端）。

进度明细、留白清单、下一步开工要点见 [`docs/dev/进度与交接.md`](./docs/dev/进度与交接.md)。

## 环境已知坑

1. **TypeScript 必须锁 5.x**：本机装的是 TS 7，`vue-tsc` 3.x 依赖 `typescript/lib/tsc`（TS 7 已移除该导出）会直接崩。根 `package.json` 已用 `overrides` 固定 `^5.9.3`；**改 overrides 后需删除 `node_modules` + `package-lock.json` 重装才生效**（npm 不会自动降级已提升的版本）。
2. **npm workspace 装包偶发不写入**：曾出现 `npm install -w @qingting/client <pkg>` 报 `no workspace folder present` 且依赖没进 `package.json`；装完请 `Get-Content <pkg>/package.json | Select-String <dep>` 复核。
3. esbuild 的 postinstall 被本机策略拦截（有告警），不影响运行（平台二进制走 optionalDependencies）。
4. **中文 commit message 用文件传入**：PowerShell 5.1 向原生程序传中文参数存在编码风险，一律 `git commit -F <UTF-8 文件>`（写文件时用 `[IO.File]::WriteAllText($p, $m, (New-Object Text.UTF8Encoding($false)))` 避免 BOM）。
5. **`<template>` 里别挂"测量用隐藏元素"**：为一个 `.vue` 模板多加一个 `visibility:hidden` 的探针 span，`vue-tsc` 会生成错误的虚拟代码——实测表现为模板里明明在用 `IconSkipBack`/`playIcon` 等，却报 4 个 `TS6133 声明未读取`，且改样式/重跑都不消失（删掉那个 span 立刻恢复正常）。需要量尺寸就用离屏探针（`utils/marquee.ts` 的 `measureTextWidth`，注入宿主便于单测），模板保持干净。判断技巧：`vue-tsc` 只报“模板专用符号未使用”，而模板里的类型错误照常报出，就是踩了这个坑。
6. **Teleport 出去的内容没有 scoped 属性**：用 Reka 等库做弹层时，内容会被 Teleport 到 `body`，而 Vue 的 `<style scoped>` 生成的是 `.cls[data-v-x]`——**元素上没有 `data-v-x`，规则直接不匹配**，表现是“弹层弹得出来但完全没样式”（不是被覆盖，是从没生效）。弹层样式一律写在**非 scoped** 的 `<style>` 里，隔离靠类名前缀。v4.60 实测：两个弹层同时中招。
7. **原生 `input[type=range]` 旋转后拖不动**：加 `transform: rotate(-90deg)` 做竖向滑杆时，**点击映射是对的、拖动不跟手**（浏览器用未旋转的几何算位移；实测从底拖到顶只动 1%）。竖向滑杆一律自绘（pointer 事件 + 自己算比例），键盘与 `role="slider"` 一并自己补。v4.64 实测。
8. **页面不可见（`visibility: hidden` / 后台标签）时 CSS `transition` 不推进**：`getComputedStyle(el).transform` 读到的是**动画开始前的旧值**（与已知的「不可见时 rAF 不触发」同源）。v4.82 实测——我因此一度误判歌词列表“位移慢一拍”，其实内联 `style` 一直是对的。判断这类问题**看 `el.getAttribute("style")`（绑定值），不要看 computed（动画中间值）**。
9. **许可（v4.86）**：本项目自身未指定开源许可，且**不含 AGPL / GPL 代码**（v4.84 曾接入 AMLL 的 npm 包 → v4.85 改为移植其代码 → v4.86 连移植也换成**按公式/按效果自行实现**）。装新依赖前先 `npm view <pkg> license`，**不要再引入强拷贝依赖**；想拄某个实现必须先看许可（AGPL 不能拄，只能参考思路）。
10. **逐帧推进的动画在页面不可见时会停住（rAF 不触发）**（v4.85）：歌词列表位移改成弹簧逐帧推之后，后台标签页里弹簧不推进、位置会停在旧值。所以 `driveTo()` 在 `document.visibilityState !== "visible"` 时直接落位（不做动画）；其它新加的逐帧动画也要给这条退路。
11. **后端挂在根路径下的媒体路由，开发代理要同步补一条（v4.87）**：`client/vite.config.ts` 只代理了 `/api` 与 `/audio`，**漏了 `/covers`**——漏了不会报错，而是被 Vite 的 SPA 兜底成 `index.html`（200 `text/html`），表现是“封面静默加载不出来”＋取色退回默认色（实测 `<img>.naturalWidth` 一直是 0）。**以后后端每加一个根路径路由（如 `/lyrics`），代理里同时加一条**；判断这类问题看响应类型（`text/html` 就是被兜底了），不要只看状态码。

12. **`npx.ps1` 同样被拦截（v5.32）**：与第 1 条同源—— `npx -y <pkg>` 在 PowerShell 下会报“未对文件 npx.ps1 进行数字签名”，**一律用 `npx.cmd`**。

## 文档索引

| 文档                                                         | 内容                                                                          |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| [`docs/dev/架构与代码地图.md`](./docs/dev/架构与代码地图.md) | 目录结构、请求链路、鉴权设计、数据模型、样式体系、扩展指引（怎么加接口/页面） |
| [`docs/dev/开发约定.md`](./docs/dev/开发约定.md)             | 命名、TS、测试、CSS/组件、Git 等落地细则与待补项                              |
| [`docs/dev/进度与交接.md`](./docs/dev/进度与交接.md)         | 里程碑状态、已交付清单、验证记录、留白清单、下一步开工要点                    |
| [`音乐软件需求文档.md`](./音乐软件需求文档.md)               | 需求唯一权威来源（含全部需求编号与决策记录）                                  |
