# 轻听音乐（qingting-music）

可私有部署的 Web 音乐播放器：本地文件 + 自建云端曲库 + 在线音源聚合，数据由自己掌控。

## 文档

| 文档                                                         | 给谁看                                                                              |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| [`音乐软件需求文档.md`](./音乐软件需求文档.md)               | 所有人 —— 需求唯一权威来源（含全部需求编号与决策记录）                              |
| [`AGENTS.md`](./AGENTS.md)                                   | AI 编码助手 / 协作者 —— 铁律、命令、代码地图、已知坑                                |
| [`docs/dev/架构与代码地图.md`](./docs/dev/架构与代码地图.md) | 开发者 —— 目录结构、请求链路、鉴权设计、样式体系、扩展指引                          |
| [`docs/dev/开发约定.md`](./docs/dev/开发约定.md)             | 开发者 —— 命名/TS/测试/CSS/组件/Git 落地细则                                        |
| [`docs/dev/进度与交接.md`](./docs/dev/进度与交接.md)         | 接手的人 —— 里程碑状态、验证记录、留白清单、下一步开工要点                          |
| [`docs/design/`](./docs/design/)                             | 设计与前端 —— 架构图/线框（drawio）、高保真原型（mockup，**界面样式唯一事实来源**） |

## 快速开始

```bash
npm install       # 一次装齐 client / server / shared 三个包的依赖
npm run dev       # 同时启动后端(3000) 与前端(5173)
```

打开 http://localhost:5173 。开发期前端把 `/api`、`/audio` 代理到后端，无需处理跨域。

> Windows PowerShell 下若报 `npm.ps1 无法加载`（执行策略拦截），把命令里的 `npm` 换成 `npm.cmd`；多命令用 `;` 分隔而不是 `&&`。

## 常用命令

| 命令                | 说明                                               |
| ------------------- | -------------------------------------------------- |
| `npm run dev`       | 前后端并行开发（后端 tsx watch 热重启 + Vite HMR） |
| `npm run build`     | 编译后端（tsup）并构建前端（vite build）           |
| `npm start`         | 运行编译后的后端产物                               |
| `npm test`          | 前后端单元测试（Vitest）                           |
| `npm run typecheck` | 前后端类型检查（tsc / vue-tsc）                    |
| `npm run format`    | Prettier 全量格式化                                |

## 工程结构（PRD 5.4）

```
├── package.json          # workspace 根：一条命令装齐依赖并同时启动前后端
├── shared/               # 前后端共享类型与纯函数（Track / Song / Playlist / Role…）
├── server/               # Express + TypeScript
│   ├── src/config.ts     #   环境变量装配（PRD 5.5 全量清单）
│   ├── src/http.ts       #   统一响应结构（成功 code:0 / 失败 HTTP 状态码 + message）
│   ├── src/middleware/   #   角色解析与接口分级保护、登录限速
│   ├── src/routes/       #   auth / config…（后续：songs / playlists / online / stats）
│   ├── src/services/     #   签名 Cookie 签发与校验等（后续：元数据解析、文件存储）
│   ├── data/             #   运行时：曲库索引、歌单、auth-secret（自动生成，不入库）
│   └── uploads/          #   运行时：音频与封面（不入库）
└── client/               # Vue 3 + Vite + TypeScript
    └── src/
        ├── styles/       #   设计令牌与玻璃拟态外壳（迁移自 mockup.css，单一事实来源）
        ├── stores/       #   Pinia：auth / config / theme（后续：player）
        ├── layouts/      #   PlayerLayout（播放器外壳）/ ConsoleLayout（管理控制台）
        ├── views/        #   local / library / online / playlist / settings / login / console/*
        ├── components/   #   AppSidebar / PlayerBar / EmptyState
        └── api/          #   接口封装（fetch，统一错误类型）
```

## 环境变量（全部可选）

最小配置 = 一条启动命令即可运行（门禁关闭、无在线音源）。完整清单见 PRD 5.5。

| 变量                      | 作用                               | 默认                       |
| ------------------------- | ---------------------------------- | -------------------------- |
| `PORT`                    | 服务监听端口                       | 3000                       |
| `DATA_DIR` / `UPLOAD_DIR` | 数据目录 / 音频目录                | `./data` / `./uploads`     |
| `MAX_UPLOAD_SIZE`         | 单文件上传上限                     | 300MB                      |
| `USER_PASSWORD`           | 访客密码（可听云端曲库与在线音源） | 无                         |
| `ADMIN_PASSWORD`          | 管理员密码（额外解锁管理控制台）   | 无                         |
| `AUTH_SECRET`             | Cookie 签名密钥                    | 首次启动自动生成并持久化   |
| `AUTH_TTL`                | 登录有效期                         | 30d                        |
| `NETEASE_API_BASE`        | 网易云 API 服务地址                | 无（未配置则隐藏在线功能） |

PowerShell 临时启用门禁示例：

```powershell
$env:USER_PASSWORD='guest123'; $env:ADMIN_PASSWORD='admin123'; npm run dev
```

## 开发进度

**当前状态：M1 进行中** —— 工程骨架与访问门禁已完成并验证；**播放器核心（播放/暂停/切歌/进度/音量/播放模式）与本地播放（拖入文件或文件夹、ID3 标签与内嵌封面、本地临时列表）已可用**，真实曲库实测通过。云端曲库、歌词、沉浸式播放页尚未实现。

进度明细、验证记录、留白清单与下一步开工要点统一维护在 [`docs/dev/进度与交接.md`](./docs/dev/进度与交接.md)（单一事实来源，本文不再重复）。

## 许可

本项目以 **AGPL-3.0-only** 分发（见 [`LICENSE`](./LICENSE)）。

原因：沉浸页歌词的渲染与动效直接使用 **AMLL**（[amll-dev/applemusic-like-lyrics](https://github.com/amll-dev/applemusic-like-lyrics)，`@applemusic-like-lyrics/core` / `vue`，**AGPL-3.0-only**，v4.84 接入）。AGPL 具传染性，且本软件是网络服务（AGPL §13 要求向使用者提供完整源码）——这与本项目的定位一致（可私有部署、开源）。

只有这一个第三方强拷贝依赖；其余依赖（Vue / Vite / Express / Reka UI / Phosphor 图标等）均为宽松许可。**新加依赖前先看 `npm view <pkg> license`**。
