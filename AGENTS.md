# AGENTS.md —— 轻听音乐（qingting-music）

给所有 AI 编码助手/协作者的入口文档。**开工前请先读本文件，再读下面「文档索引」里的两份详细文档。**

## 项目是什么

一款**可私有部署的 Web 音乐播放器**：播放本地文件 + 自建服务器云端曲库（上传/流式播放）+ 在线音源（网易云等）搜索试听。产品形态是"本地 + 自有云端 + 在线聚合"三合一。

- 需求文档（唯一权威来源，含全部需求编号 PL/LB/LC/ON/PS/LR/VS/RT/AC/AD）：[`音乐软件需求文档.md`](./音乐软件需求文档.md)
- 高保真界面原型（**界面样式唯一事实来源**）：[`docs/design/mockup/`](./docs/design/mockup/)（`css/mockup.css` 定义了全部令牌与配方）
- 架构图 / 线框：[`docs/design/*.drawio`](./docs/design/)

需求文档里的编号（如 `LB-06`、`AC-03`、`VS-09`）是**通用语言**：代码注释、提交信息、文档都应引用它们。

## 铁律（不要擅自更改）

1. **技术选型已定稿**（PRD 5.1）：前端 Vue 3 + Vite + TS + Pinia + Vue Router；样式手写 CSS + CSS 变量，**不引入带样式的组件库**；复杂交互件用 Reka UI（无样式行为层）；图标只用 **Iconify + Phosphor**（`~icons/ph/xxx`，构建期打包）。后端 Node + Express + TS，multer 上传，music-metadata 解析标签，JSON 文件存储。
2. **界面以"美观 + 易用"为准，需求方的感受是最终裁决权；原型是参考与素材库，不是教条。** `docs/design/mockup/` 提供令牌、配方与视觉语言（`css/mockup.css`）。改样式不必先改原型，但必须：① 保持单一视觉语言，不出现两套互相矛盾的样式；② 改动后同步更新原型与需求文档决策记录，避免下次有人照着旧原型改回去。**不要**照搬原型里的单页 CSS 类切换（已被证明会产生层叠逃逸 bug，见 v3.9 修订记录），沉浸页三布局必须拆成三个独立 Vue 组件（VS-09 / v4.0 决策）。
3. **取色只注入原始色源**：JS 只写 `--cover-src` / `--cover-src-2`，一切调校在 CSS 用 OKLCH 相对颜色语法派生。**严禁 JS 写内联 background**（会覆盖多层图层，原型踩过两次）。
4. **全链路 camelCase**（API JSON、JSON 存储、未来 SQLite 列名）；时间用 ISO 8601 UTC 字符串；时长用秒；ID 用 nanoid（在线曲目引用用 `provider:id`）。
5. **API 响应结构**：成功 `{ code: 0, data }`；失败用正确 HTTP 状态码（400/401/403/404/429/500）+ `{ code, message }`。业务码只在前端需要分支时定义。
6. **每个基础函数必须有单元测试（正常 + 异常路径），实现与测试同次提交**；无用例的基础函数视为未完成（PRD 11.2）。测试框架统一 Vitest，HTTP 集成测试用 supertest。
7. **提交信息用 Conventional Commits**（feat/fix/docs/test/refactor/chore/style），与现有仓库历史一致。

## 常用命令

> Windows PowerShell 下 `npm.ps1` 会被执行策略拦截 → **一律用 `npm.cmd`**；链接命令用 `;`，不要用 `&&`。

| 命令 | 说明 |
| --- | --- |
| `npm.cmd install` | 装齐三个包（workspace） |
| `npm.cmd run dev` | 前端 5173 + 后端 3000 同时启动 |
| `npm.cmd run test` | 全量单测（server 41 例 + client 7 例） |
| `npm.cmd run typecheck` | `tsc --noEmit` + `vue-tsc --noEmit` |
| `npm.cmd run build` | 后端 tsup → `server/dist`，前端 vite → `client/dist` |
| `npm.cmd run format` | Prettier 全量格式化 |
| `npm.cmd run dev -w @qingting/server` | 只起后端 |

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
server/src/middleware/     attachRole（角色解析）、requireAccess（401/403）、createLoginLimiter（429）
server/src/routes/        auth（status/login/logout）、config；后续 songs/playlists/online/stats
server/src/app.ts         createApp(config)（可测试装配）→ index.ts 负责 listen
client/src/styles/        tokens.css（令牌 + OKLCH 取色核心）、global.css（玻璃拟态外壳 + 材质/投放区配方）
client/src/layouts/       PlayerLayout（侧栏+内容+播放条，含空格键快捷键）、ConsoleLayout（控制台独立布局）
client/src/router/        路由表 + 守卫（身份决定可达页面）
client/src/stores/        auth、config、theme、player（播放器单例：队列/模式/进度/音量/单例 audio）
client/src/utils/         player（模式状态机与选曲，纯函数）、localFiles（文件名解析/时长探测）、
                          fileSystem（拖入文件夹递归）、metadata（ID3 读取）、keyboard（焦点判定）、format
client/src/views/         login/local/library/online/playlist/settings + console/{overview,songs,upload}
client/src/components/    AppSidebar、PlayerBar（受 store 驱动）、TrackRow（通用曲目行）、EmptyState
client/src/utils/format.ts  formatTime/formatSize/formatDateTime
```

## 当前进度

**已完成**：M1 工程骨架 + 双密码三档访问门禁（含登录页与路由守卫）+ **播放器核心（PL-01~05）与本地播放（LC-01~05，含 ID3 标签与内嵌封面）**；前后端类型检查、生产构建、**120 个单测**全绿；已用真实曲库（D:\Music，369 MP3 + 4 FLAC）浏览器实测播放。

**下一步**（建议顺序）：云端曲库上传/列表/删除/Range 流播（3.4 + 3.12）→ 沉浸式播放页与歌词（3.7 / VS-03/09）→ 播放队列弹层（PL-06）与曲目级持久化（PL-07）。

进度明细、留白清单、下一步开工要点见 [`docs/dev/进度与交接.md`](./docs/dev/进度与交接.md)。

## 环境已知坑

1. **TypeScript 必须锁 5.x**：本机装的是 TS 7，`vue-tsc` 3.x 依赖 `typescript/lib/tsc`（TS 7 已移除该导出）会直接崩。根 `package.json` 已用 `overrides` 固定 `^5.9.3`；**改 overrides 后需删除 `node_modules` + `package-lock.json` 重装才生效**（npm 不会自动降级已提升的版本）。
2. **npm workspace 装包偶发不写入**：曾出现 `npm install -w @qingting/client <pkg>` 报 `no workspace folder present` 且依赖没进 `package.json`；装完请 `Get-Content <pkg>/package.json | Select-String <dep>` 复核。
3. esbuild 的 postinstall 被本机策略拦截（有告警），不影响运行（平台二进制走 optionalDependencies）。
4. **中文 commit message 用文件传入**：PowerShell 5.1 向原生程序传中文参数存在编码风险，一律 `git commit -F <UTF-8 文件>`（写文件时用 `[IO.File]::WriteAllText($p, $m, (New-Object Text.UTF8Encoding($false)))` 避免 BOM）。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [`docs/dev/架构与代码地图.md`](./docs/dev/架构与代码地图.md) | 目录结构、请求链路、鉴权设计、数据模型、样式体系、扩展指引（怎么加接口/页面） |
| [`docs/dev/开发约定.md`](./docs/dev/开发约定.md) | 命名、TS、测试、CSS/组件、Git 等落地细则与待补项 |
| [`docs/dev/进度与交接.md`](./docs/dev/进度与交接.md) | 里程碑状态、已交付清单、验证记录、留白清单、下一步开工要点 |
| [`音乐软件需求文档.md`](./音乐软件需求文档.md) | 需求唯一权威来源（含全部需求编号与决策记录） |
