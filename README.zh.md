# @jmcc-guo/dsh-ssh

[English](README.md) · [简体中文](README.zh.md)

![License: MIT](https://img.shields.io/github/license/jmcc-guo/dsh-ssh.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)
![Type](https://img.shields.io/badge/type-ESM-blueviolet.svg)

> DeepSeek Harness 的 SSH 终端插件：AI 自主管理连接 + XShell 风格多标签实时终端面板。

DeepSeek Harness（DSH）的 SSH 终端插件：AI 代理可在对话中自主管理远程连接，Web GUI 右侧提供 XShell / Uniterm 风格的多标签终端面板，模型与人工执行的命令同屏实时显示。

## 兼容性说明

已在 **DSH `0.2.0-rc.2`** 上验证可用，覆盖 **PC 桌面客户端（Windows，Electron）** 与浏览器版 Web 界面，验证日期 **2026-09-30**。

发布的 `0.5.0` 在上述环境无法运行，本分支修复了三处缺陷：

1. **所有客户端上激活即失败。** `apply()` 调用了 DSH 0.2.0-rc.2 已移除的 `ctx.settings.register(name, Config, opts)`，导致工具未注册、`/ssh/ws` 路由未挂载。现改为直接使用 `apply(ctx, config)` 传入的配置。
2. **WebSocket 地址取自错误的源。** 桌面客户端的主界面文档由其自定义特权协议提供（`dsh-app://app/`），此处 `window.location.host` 为 `app`，插件因此连接了无法解析的地址。现改用内置客户端所用的 `__DSH_TRANSPORT__.streamBaseUrl`。
3. **信任围栏拒绝了桌面外壳。** 桌面壳发送的 `Origin`（`dsh-app://app`）永远无法等于 `Host`，升级被 **403** 拒绝。现仅额外接受这一个由 Harness 自身持有的源，其余拒绝规则不变。

若使用未修补的 `0.5.0`，症状为：链路指示器变红、Host 上已有记录但列表为空、且所有操作报 `panel link not ready`。

完整证据、握手前后对照表与确切环境记录在 [`PATCH-NOTES.md`](PATCH-NOTES.md)。相关：[issue #1](https://github.com/jmcc-guo/dsh-ssh/issues/1) · [PR #2](https://github.com/jmcc-guo/dsh-ssh/pull/2)。

> 以上改动仅存在于本 fork；在 PR 被合并前，上游仓库保持原样。

## 功能

- **模型自主管理连接**：`ssh_connect` / `ssh_exec` / `ssh_list` / `ssh_status` / `ssh_disconnect` / `ssh_exec_read` / `ssh_exec_kill` / `ssh_delete`。同一服务端可建立多个独立连接（各自拥有连接名、会话状态与命令队列）。
- **自动保存与复用**：连接按名称持久化（名称全局唯一）。重启 DSH 后，`ssh_exec` 直接按已保存名称自动建连执行，无需重新传参。
- **统一由 AI 管理**：不存在来源区分——无论连接由 AI（`ssh_connect`）还是设置页创建，一律归 AI 代理管理：出现在 `ssh_list` 中，`ssh_exec` / `ssh_status` / `ssh_disconnect` / `ssh_delete` 立即可用，无需任何"转移"步骤。
- **保活与重连**：空闲心跳；**仅意外断线自动重连**（指数退避、有上限），重连成功提示"shell 状态已重置"；一切显式断开（关标签、`ssh_disconnect`、设置页断开按钮）均不自动重连。
- **执行互斥（所有连接）**：AI 执行期间该终端的人工输入被服务器端丢弃并显示"AI 正在执行中…"（AI 不执行时人类才可以输入）；AI 对"共享终端 shell 仍活跃"的连接 `ssh_exec` 会等待其静默（默认 2 秒无输出/输入）或返回"连接忙"。
- **标签联动**：人工关闭标签 → 立即断开（无确认弹框）；AI 断开 → 标签保留显示已断开、可一键重连；模型自动建连成功 → 自动打开/复用标签。连接一个已保存连接（标签栏 **"+"**、设置页"连接"按钮）**从不拒绝已打开的连接**：若该连接已有打开的标签，调用会**新建一个独立会话/标签**（即使同一连接已在其他标签中连接）；仅当尚无任何标签时才连接主会话（即模型工具寻址的那个会话）。
- **实时终端面板——双形态、同一状态**：面板主体可落在两个位置——**DSH 原生右侧详情列**（对话区收缩，不遮挡；关闭后**原始右列（工具详情）原样恢复**，右侧细条可重新打开面板），或 **[dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 侧边栏**：安装了该插件时，同一份面板主体注册为侧边栏 tab（`dsh-ssh:terminal`，出现在其 **+** 菜单，带连接数实时角标），AI 建连的自动打开也落在那里（并展开侧边栏）。两个形态共享同一条 host 管理的状态流，切换不会分叉终端状态。`panelSurface` 设置（见下文）决定形态：`auto`（默认——装了 sidebar 就用 sidebar）、`sidebar`（优先 sidebar）、`native`（始终原生右列）；未安装 dsh-better-sidebar 时自动全部回退到原生右列。每条连接持有一个**真实交互式 shell（PTY）**：登录横幅（motd / Last login）、远端提示符 `user@host:路径$`、输入回显、`cd` 后路径跟随变化——与原生 SSH 客户端观感一致；**没有独立输入框、没有复制按钮**，点击终端后直接键入，击键直达远端 shell（支持方向键、Tab、Ctrl-C、粘贴、IME）；聚焦后显示闪烁块光标；AI 执行的命令以来源标记同屏显示；多标签、ANSI 颜色、滚动回看；画面自动跟随最新输出保持在底部（大段输出突发也不会脱尾），手动上滑回看历史时不强拉回底部，但 AI 开始操控该连接时会自动滑回底部，始终可见 AI 的实时输出。
- **设置页管理连接**：设置 → "SSH 连接" 页面集中管理新建、编辑（可重命名）、删除连接及其凭据（密码/私钥存入 DSH 凭证库）、连接/断开。终端分栏内不含增删改功能。
- **凭证安全**：密码/私钥只进 DSH 凭证库（生成式引用），记录文件、日志、工具返回均不含明文；工具参数内联密钥被拒绝；认证失败返回脱敏的可读原因。
- **设置**：`dsh-ssh` 设置命名空间可覆盖心跳、重连策略、超时、输出上限、记录文件路径等。
- **中英文双语**界面。

## 环境要求

- Node.js >= 18（ESM）
- pnpm（锁文件：`pnpm-lock.yaml`）
- 带 `web` profile 的 DeepSeek Harness（DSH）安装
- 测试套件需要可达的 SSH 服务（自带测试以本地 WSL OpenSSH 实例为目标，见 `scripts/test-acceptance.mjs`）

## 安装

```bash
# 从 npm 安装（推荐）
dsh plugin --profile web add @jmcc-guo/dsh-ssh

# 或直接从 GitHub 安装
dsh plugin --profile web add "github:jmcc-guo/dsh-ssh#v0.5.0"

# 或从本地目录安装
dsh plugin --profile web add <本仓库路径>
```

插件自带的 `cordis.patch.yml` 挂载 `dsh-ssh` 行。可在 profile 的
`cordis.patch.yml` 中按同一行 id 覆盖配置：

```yaml
- id: dsh-ssh
  config:
    heartbeatIntervalMs: 20000
    reconnectMaxAttempts: 8
    outputLimitBytes: 2097152
```

修改后重启 profile 进程生效（插件集与客户端 bundle 图在启动时组合）。

## 常见问题

### ssh2 已捆绑内置——无需任何构建步骤

`ssh2` 及其完整依赖闭包通过 `bundleDependencies` **直接打进 npm 包**，因此安装 `@jmcc-guo/dsh-ssh` 不会执行任何依赖构建脚本：无需修改 `allowBuilds`，也不会出现 `ERR_PNPM_IGNORED_BUILDS`。ssh2 以纯 JS 实现运行（功能完整，已经真实 SSH 服务器验证）；可选的原生加密绑定有意不编译。

### Peer 依赖警告

`pnpm peers check` 可能报告 `@deepseek-ai/*` 的 "missing peer"，尽管 DSH 实际已提供：在 hoisted 的 profile 布局下，外部插件运行时从共享的 `profiles/node_modules` 解析宿主包，而 pnpm 的静态 peer 检查不跨该边界。该警告无害——插件可正常加载（已运行时验证）。

## 设置命名空间（`dsh-ssh`）

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `heartbeatIntervalMs` | 30000 | ssh2 心跳间隔 |
| `keepaliveCountMax` | 3 | 心跳失败多少次判定连接死亡 |
| `connectTimeoutMs` | 15000 | 建连/握手超时 |
| `reconnectBaseDelayMs` | 2000 | 首次自动重连延迟（每次翻倍） |
| `reconnectMaxDelayMs` | 60000 | 退避上限 |
| `reconnectMaxAttempts` | 5 | 自动重连次数上限 |
| `execTimeoutMs` | 120000 | `ssh_exec` 默认完成等待 |
| `busyWaitTimeoutMs` | 20000 | 连接忙时默认等待 |
| `reconnectWaitTimeoutMs` | 30000 | 重连中默认等待 |
| `shellQuietWaitMs` | 2000 | AI 执行前共享终端 shell 需静默的时长 |
| `outputLimitBytes` | 1048576 | 每连接终端缓冲上限 |
| `execOutputMaxBytes` | 200000 | 单命令返回给模型的上限 |
| `recordsPath` | `$DSH_HOME/storages/dsh-ssh/connections.json` | 记录文件路径 |
| `panelSurface` | `auto` | Web 面板形态：`auto` = 装了 dsh-better-sidebar 就用其侧边栏，否则原生右列；`sidebar` = 优先 dsh-better-sidebar（未装时回退原生）；`native` = 始终原生右列。对已打开的面板实时生效 |

## 模型工具

- `ssh_connect`：新建连接（认证走凭证引用或密钥文件路径）或重新建立已有连接。
- `ssh_exec`：按名称在已保存连接上执行命令；离线自动建连；重连/忙碌时按超时等待；返回输出与退出码；长命令返回 `execId` 供 `ssh_exec_read` / `ssh_exec_kill` 使用。
- `ssh_exec_read`：增量读取（运行中或已结束）命令输出。
- `ssh_exec_kill`：终止运行中的命令（经 PTY 发送 SIGINT）。
- `ssh_list`：列出全部已保存连接及实时状态（所有连接统一由 AI 管理）。
- `ssh_status`：单个已保存连接的详细状态。
- `ssh_disconnect`：显式断开（不自动重连，可带 `delete`）；面板标签保留显示"已断开"。
- `ssh_delete`：删除已保存的连接记录（先断开）。

**给模型的密钥规则**：不要把密码/私钥明文放进工具参数（会被完整记入会话轨迹并被拒绝）。请使用 `auth.passwordRef` / `auth.privateKeyRef`（已存储的凭证或环境变量名）或 `auth.privateKeyPath`（本机密钥文件路径）。新密钥可通过设置页的"SSH 连接"表单录入，自动存入 DSH 凭证库。

## 安全说明

- 面板通道（`/ssh/ws`）复用 harness 浏览器信任围栏：回环/信任主机、同源 Origin、拒绝跨站 fetch-metadata。
- 密钥只存在于凭证库：记录文件仅保存引用，错误信息脱敏，日志无密钥。
- 命令经远端真实 PTY 执行：ANSI 输出、交互程序、SIGINT 终止均可用；用户击键经 PTY 直达远端 shell，AI 执行期间该终端的人工输入由服务端丢弃（执行互斥，AI 不执行时人类才可输入）。

## 仓库结构

```
lib/index.js            插件入口：配置 schema、manager + 工具 + 面板通道装配
lib/manager.js          SshManager —— 连接生命周期、保活/重连、互斥、PTY shell
lib/tools.js            模型工具（ssh_connect / ssh_exec / ssh_exec_read / ssh_exec_kill / ...）
lib/ws.js               面板 WebSocket 通道（/ssh/ws，含浏览器信任围栏）
lib/store.js            连接记录持久化
lib/client.js           Web GUI 客户端：多标签终端面板 + 设置页 UI
cordis.patch.yml        bundle patch，挂载 dsh-ssh 行
scripts/                测试套件（见下文）
```

## 测试

`scripts/` 内含验收套件与辅助脚本（需要可达的 SSH 服务；自带测试以 WSL OpenSSH 实例为目标）：

```bash
node scripts/test-acceptance.mjs   # 64 项管理层验收套件
node scripts/smoke.mjs             # 快速冒烟测试
node scripts/test-panel-ws.mjs     # 面板 WebSocket 通道驱动（测试 web 实例 :3081）
node scripts/test-rename.mjs       # 重命名专项测试（无需 SSH 服务）
node scripts/test-connect-tabs.mjs # connect/标签语义专项测试（无需 SSH 服务）
node scripts/test-panel-channel.mjs # 面板 WS 通道专项测试（无需 SSH 服务，也无需 DSH 实例）
node scripts/test-client-surface.mjs  # 双形态（原生右列 / dsh-better-sidebar）逻辑（无需 SSH 服务）
```

## 参与贡献

欢迎提交 Issue 与 Pull Request。请保持模型可见接口（工具名、参数语义、返回结构）向后兼容，并确保密钥绝不进入日志、记录文件或工具返回。

## License

MIT
