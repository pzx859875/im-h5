# H5 频道会议

基于 React、TypeScript、Vite 的游客会议客户端，与 APP 共用 room-go、LiveKit 和 OpenIM 服务。

## 功能

- 通过邀请链接设置昵称并入会，支持游客身份续签和重新加入。
- 收听语音、观看视频和屏幕共享；获准后手动开启麦克风。
- 主持人模式下申请发言、撤回申请，处理审批和禁麦状态。
- 临时文字和图片聊天，支持图片预览、上传进度及失败重试。单图上限 10MB，支持 JPG、PNG、WebP、GIF。
- 头像与昵称上下排列的成员列表，支持手机和桌面、深浅色主题。

## 开发

需要 Node.js 22.12 或更新版本。

```sh
git clone https://github.com/pzx859875/im-h5.git
cd im-h5
npm ci
cp .env.example .env.local
npm run dev
```

Windows PowerShell 中复制配置可使用 `Copy-Item .env.example .env.local`。默认开发地址为 `http://127.0.0.1:5173/`。本地开发配置通过 `.env.local` 设置，不提交真实凭据。

## 环境配置

Vite 开发模式与 APP 后端环境相互独立，默认连接生产地址。环境变量在构建时写入前端，不能存放服务端密钥。

| 变量 | 用途 |
| --- | --- |
| `VITE_APP_ENV` | `production`、`test` 或 `debug`，服务地址与 APP 配置一致 |
| `VITE_COMMUNITY_URL` | 可覆盖社区 API 地址，包含 `/chatRoomApi` 前缀 |
| `VITE_IM_API_URL` | 可覆盖 OpenIM HTTP API 地址，用于身份及图片上传 |
| `VITE_IM_WS_URL` | 可覆盖 OpenIM WebSocket 地址，用于管理通知 |
| `VITE_IM_ADMIN_ID` | 可信管理消息发送者账号，默认 `imAdmin` |
| `VITE_IM_EVENTS` | 管理通知开关，默认开启 |
| `VITE_SELF_SNAPSHOT` | 可选个人状态快照接口，默认关闭；仅在后端支持时开启 |

LiveKit 地址由邀请准入接口返回。邀请链接使用 URL fragment，例如：

```text
https://your-h5-host/#/join?channelInvite=<channel-invite>&roomId=<room-id>&roomInvite=<room-invite>
```

私密聊天室需要独立的 `roomInvite`；聊天室与语音频道的游客开关均由后端校验。

## 构建与部署

```sh
npm ci
npm run build
npm run preview
```

构建产物位于 `dist/`。部署到 HTTPS 静态站点，并提供 SPA fallback；API 和对象存储需允许 H5 域名的跨域请求。API 请求包含 `token`，游客注册还包含 `Idempotency-Key`；对象存储使用服务端签名上传地址。

## 代码结构

| 位置 | 职责 |
| --- | --- |
| `src/App.tsx`、`style.css` | 入会、会中页面及移动端布局 |
| `src/meeting.ts` | 入退会、媒体权限、申请发言、消息和成员状态 |
| `src/api.ts`、`session.ts` | 社区接口、游客凭据和邀请解析 |
| `src/media.tsx` | 远端音视频及屏幕共享 |
| `src/images.ts`、`ChatImage.tsx` | 图片校验、缩略图、OpenIM 上传和预览 |
| `src/protocol.ts` | APP 兼容的文字/图片消息和管理事件校验 |
| `src/events.ts` | OpenIM 管理通知订阅 |

图片二进制通过 OpenIM HTTP object API 上传；LiveKit 仅传递图片地址与尺寸等元数据。聊天只保留在当前会话，离会后清空。审批通知不能代替 LiveKit 的麦克风授权，获准后仍需用户手动开启麦克风。

## 依赖与交付范围

仓库只提交业务源码、资源、配置模板以及必要的运行和构建依赖清单。依赖安装目录、构建产物、本地环境、测试源码/配置、测试报告及临时调试文件均被忽略；默认安装不包含 Vitest、Playwright、jsdom 和格式化工具。`package-lock.json` 保留以固定依赖版本。

LiveKit 客户端固定为 **2.18.0**，以兼容当前 **1.9.0** 服务端的 SDP 协商行为。升级前需验证初次连接、重协商和断线恢复，避免重新引入周期性重连。OpenIM SDK 的 declaration-only 深路径由 `vite.config.ts` 映射到 `src/openim-protocol-compat.ts`，复用公开枚举。

OpenIM 管理通知不可达且后端未提供个人快照时，拒绝结果与历史申请状态无法保证实时恢复；媒体权限仍由 LiveKit 控制。本项目不包含管理端、后端服务，也未完成 500 人压力验收。
