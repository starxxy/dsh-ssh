# dsh-ssh — DSH 0.2.0 / 桌面客户端兼容性 fork

本仓库是 **[jmcc-guo/dsh-ssh](https://github.com/jmcc-guo/dsh-ssh)** 的 fork。原项目是
DeepSeek Harness（DSH）的 SSH 终端插件与 AI 连接管理器。

**本页只说明这个 fork 改了什么、以及如何安装使用。** 插件本身的功能、模型工具、设置项
与安全说明请阅读原项目文档——它们在这里完全适用：

- [原项目中文说明](https://github.com/jmcc-guo/dsh-ssh/blob/main/README.zh.md)
- [Upstream README (English)](https://github.com/jmcc-guo/dsh-ssh#readme)

## 为什么有这个 fork

上游 `v0.5.0` 在 DSH `0.2.0-rc.2` 上无法运行，存在两处互不相关的缺陷：

**一、所有客户端上都激活失败。** `apply()` 调用了 DSH `0.2.0-rc.2` 已移除的
`ctx.settings.register(name, Config, opts)`，插件在注册任何东西之前就抛错：模型工具
未注册，`/ssh/ws` 路由也从未挂载。

**二、PC 桌面客户端上面板通道永远无法建立。** 桌面客户端的主界面文档由其自定义特权协议
提供（`dsh-app://app/`），于是：

- `window.location.host` 为 `app`，插件拼出的地址 `ws://app/ssh/ws` 永远无法解析；
- 桌面壳发送的 `Origin` 为 `dsh-app://app`，永远不可能等于 `Host`，因此桥接层以
  **403** 拒绝了升级请求。

两者叠加，就是使用者报告的症状：

> 链路指示器变红、**Host 上明明已有连接记录但列表为空**、所有操作报
> `panel link not ready`。

请注意：**缺陷一与客户端无关**——任何 `>= 0.2.0-rc.2` 的 DSH 都会中招，浏览器版同样
打不开。缺陷二只在桌面客户端暴露，这也是"只测浏览器发现不了"的原因。

## 本 fork 的改动

仅三个文件，没有改版本号，没有改依赖：

| 文件 | 改动 |
|---|---|
| `lib/index.js` | 改为从 `apply(ctx, config)` 读取本行配置，不再调用已移除的 `ctx.settings.register`。`settings.watch` 热更新仅在旧版 settings 服务仍提供时保留，否则配置在下次启动生效 |
| `lib/ws.js` | 在信任围栏中额外接受 Harness 自有的桌面源 `dsh-app://app`，其余拒绝规则完全不变 |
| `lib/client.js` | 改用内置 DSH 客户端所用的 `__DSH_TRANSPORT__.streamBaseUrl` 构造 WebSocket 地址，在普通浏览器中回退到文档源 |

完整说明与原始证据见 [`PATCH-NOTES.md`](PATCH-NOTES.md)。

## 安装

需要已安装 DSH 且带 `web` 或桌面 profile，Node.js >= 18。

该插件声明的 peer 范围（`^0.1.0-rc.6`）早于 DSH 0.2.0，因此需要先做一次显式风险确认：

```bash
# 1. 确认接受 peer 范围不匹配（只需一次）
dsh plugin --profile desktop allow-version @jmcc-guo/dsh-ssh@0.5.0 \
  --dsh-version 0.2.0-rc.2 --accept-risk

# 2. 安装本 fork —— main 分支已含全部修复
dsh plugin --profile desktop add "github:starxxy/dsh-ssh#main"

# 3. 重启 DSH：插件集合与客户端 bundle 图在启动时组装
```

把 `desktop` 换成你自己的 profile 名（浏览器版通常是 `web`）。

<details>
<summary>另一种方式：保留 npm 的 <code>0.5.0</code>，用补丁修</summary>

如果你希望继续跟随已发布的 npm 包，可以正常安装后用 `pnpm` 补丁打上同样的三处修改：

```bash
dsh plugin --profile desktop add @jmcc-guo/dsh-ssh
```

然后把 [`patches/@jmcc-guo__dsh-ssh@0.5.0.patch`](patches/) 复制到你 profile 的
`patches/` 目录并登记。注意 pnpm 11 里这项配置属于 `pnpm-workspace.yaml`，**不是**
`package.json`——写在后者里会被静默忽略：

```yaml
# <profile>/pnpm-workspace.yaml
patchedDependencies:
  '@jmcc-guo/dsh-ssh@0.5.0': patches/@jmcc-guo__dsh-ssh@0.5.0.patch
```

然后在 profile 目录里执行 `pnpm install`。如果 pnpm 回答 *"Already up to date"* 而没
有实际应用任何东西，先删掉 `<profile>/node_modules/.modules.yaml`——pnpm 把链接状态
缓存在那里，否则会跳过该包。

</details>

## 如何使用

用法与原项目完全一致，完整说明请查阅原项目文档。简要来说：

- **通过对话使用** —— 插件提供 `ssh_connect` / `ssh_exec` / `ssh_exec_read` /
  `ssh_exec_kill` / `ssh_list` / `ssh_status` / `ssh_disconnect` / `ssh_delete`。
  已保存的连接按需自动重连，因此可以直接按名字寻址，无需先连接。
- **通过界面使用** —— 从右侧栏打开 SSH 面板；连接的管理在
  **设置 → SSH 连接** 页面。面板提供真实的多标签 PTY，以及文件浏览（上传、下载，
  64 KB 以内的 UTF-8 文本可在线编辑）。

> 如果你是因桌面客户端报 `panel link not ready` 而来：上面两处缺陷就是全部原因，
> 安装本 fork 后重启即可。

> **本构建的配置在启动时读取。** 修改 profile patch 中 `dsh-ssh` 那一行需要下次启动
> 才生效，不会热更新。

## 验证情况

| | |
|---|---|
| DSH | `0.2.0-rc.2` |
| 插件 | `@jmcc-guo/dsh-ssh@0.5.0` |
| 客户端 | PC 桌面客户端（Windows，Electron）**以及** 浏览器版 Web 界面 |
| 日期 | 2026-09-30 |

针对 `/ssh/ws` 的原始 WebSocket 握手实测：

| 请求 | 未修补的 `0.5.0` | 本 fork |
|---|---|---|
| `Origin: dsh-app://app`（桌面客户端） | `403` | **`101 Switching Protocols`** |
| `Origin: http://127.0.0.1:<port>`（浏览器同源） | `101` | **`101`** |
| `Origin: http://evil.example` | `403` | **`403`** |
| `Origin: http://127.0.0.1:9999`（其它端口） | `403` | **`403`** |
| `Origin: dsh-app://evil`（仿冒协议主机） | `403` | **`403`** |
| 非回环 `Host` 且无 `Origin` | `403` | **`403`** |

围栏没有丢失任何拒绝能力：仅额外接受 Harness 自身持有的那一个源，远端客户端无法伪造。
随后鉴权会话的 `snapshot` 往返成功，`ssh_connect` / `ssh_exec` 对真实服务器执行正常。

## 与上游的关系

修复已在上游报告并提交：

- Issue —— [jmcc-guo/dsh-ssh#1](https://github.com/jmcc-guo/dsh-ssh/issues/1)
- Pull Request —— [jmcc-guo/dsh-ssh#2](https://github.com/jmcc-guo/dsh-ssh/pull/2)
- 分支 —— [`fix/dsh-0.2.0-desktop-client`](https://github.com/starxxy/dsh-ssh/tree/fix/dsh-0.2.0-desktop-client)

在该 PR 被合并之前，本 fork 即为可直接安装的版本。除上述三个文件与新增文档外，
`main` 与上游保持一致。

## 许可

MIT，与原项目相同。原始作品版权归 jmcc-guo 所有 —— 见 [`LICENSE`](LICENSE)。
