# dsh-ssh — DSH 0.2.0 / desktop-client compatibility fork

A fork of **[jmcc-guo/dsh-ssh](https://github.com/jmcc-guo/dsh-ssh)** — the SSH terminal
panel and AI connection manager for DeepSeek Harness (DSH).

**This page documents only what this fork changes and how to install it.** For what the
plugin *does* — its features, model tools, settings namespace and security notes — read
the upstream documentation, which applies here unchanged:

- [Upstream README (English)](https://github.com/jmcc-guo/dsh-ssh#readme)
- [上游中文说明](https://github.com/jmcc-guo/dsh-ssh/blob/main/README.zh.md)

## Why this fork exists

Upstream `v0.5.0` cannot run on DSH `0.2.0-rc.2`. Two independent defects:

**1 — Activation fails on every client.** `apply()` calls
`ctx.settings.register(name, Config, opts)`, an API DSH `0.2.0-rc.2` removed. The plugin
throws before registering anything: no model tools, and `/ssh/ws` is never mounted.

**2 — The panel channel can never open in the PC desktop client.** The desktop shell
serves the document from its own privileged origin (`dsh-app://app/`), where:

- `window.location.host` is `app`, so the URL the client half built
  (`ws://app/ssh/ws`) can never resolve; and
- the shell's `Origin` is `dsh-app://app`, which can never equal the `Host` authority,
  so the bridge rejected the upgrade with `403`.

Together they produce the symptom people report:

> a red link indicator, an empty saved-connection list **even though records exist on
> the Host**, and every action failing with `panel link not ready`.

Defect 1 is **not** desktop-specific — it breaks the plugin on any DSH `>= 0.2.0-rc.2`,
browser included. Defect 2 only surfaces in the desktop client, which is why testing in a
browser alone never catches it.

## What this fork changes

Three files. No version bump, no dependency change:

| File | Change |
|---|---|
| `lib/index.js` | Read the row config from `apply(ctx, config)` instead of the removed `ctx.settings.register`. `settings.watch` live reload is kept only where a legacy settings service still exposes it; otherwise a config change applies at next boot |
| `lib/ws.js` | Additionally accept the harness-owned desktop origin `dsh-app://app` in the trust fence. Every other rejection is unchanged |
| `lib/client.js` | Build the WebSocket URL from `__DSH_TRANSPORT__.streamBaseUrl` — the source the built-in DSH clients use — falling back to the document origin in a plain browser |

Full write-up and raw evidence: [`PATCH-NOTES.md`](PATCH-NOTES.md).

## Install

Requires a DSH installation with the `web` or desktop profile, and Node.js >= 18.

The plugin's peer ranges (`^0.1.0-rc.6`) predate DSH 0.2.0, so DSH asks for an explicit
risk acknowledgement once:

```bash
# 1. acknowledge the peer-range mismatch (once)
dsh plugin --profile desktop allow-version @jmcc-guo/dsh-ssh@0.5.0 \
  --dsh-version 0.2.0-rc.2 --accept-risk

# 2. install this fork — `main` already carries the fixes
dsh plugin --profile desktop add "github:starxxy/dsh-ssh#main"

# 3. restart DSH: the plugin set and the client bundle graph are composed at boot
```

Substitute your profile name for `desktop` (`web` for the browser profile).

<details>
<summary>Alternative: stay on npm's <code>0.5.0</code> and patch it</summary>

If you would rather keep tracking the published package, install it normally and apply
the same three edits as a `pnpm` patch:

```bash
dsh plugin --profile desktop add @jmcc-guo/dsh-ssh
```

Then copy [`patches/@jmcc-guo__dsh-ssh@0.5.0.patch`](patches/) into your profile's
`patches/` directory and register it. In pnpm 11 that setting belongs in
`pnpm-workspace.yaml`, **not** in `package.json` — a `pnpm` field there is silently
ignored:

```yaml
# <profile>/pnpm-workspace.yaml
patchedDependencies:
  '@jmcc-guo/dsh-ssh@0.5.0': patches/@jmcc-guo__dsh-ssh@0.5.0.patch
```

Then run `pnpm install` inside the profile. If pnpm answers *"Already up to date"*
without re-applying anything, delete `<profile>/node_modules/.modules.yaml` first — pnpm
caches the link state there and will otherwise skip the package.

</details>

## How to use

Usage is identical to upstream; see its docs for the full surface. In short:

- **From the assistant** — the plugin contributes `ssh_connect` / `ssh_exec` /
  `ssh_exec_read` / `ssh_exec_kill` / `ssh_list` / `ssh_status` / `ssh_disconnect` /
  `ssh_delete`. Saved connections reconnect on demand, so you can address one by name
  without connecting it first.
- **From the GUI** — open the SSH panel from the right rail, then manage connections
  under **Settings → SSH Connections**. The panel holds real multi-tab PTYs plus a file
  browser (upload, download, and in-place editing of UTF-8 text up to 64 KB).

> If you are here because of `panel link not ready` in the desktop client, the two
> defects above are the entire cause: install this fork and restart.

> **Configuration is read at boot in this build.** A change to the `dsh-ssh` row in the
> profile patch takes effect on the next start, not live.

## Verified

| | |
|---|---|
| DSH | `0.2.0-rc.2` |
| Plugin | `@jmcc-guo/dsh-ssh@0.5.0` |
| Client | PC desktop client (Windows, Electron) **and** browser Web UI |
| Date | 2026-09-30 |

Raw WebSocket upgrade handshakes against `/ssh/ws`:

| Request | Unpatched `0.5.0` | This fork |
|---|---|---|
| `Origin: dsh-app://app` (desktop client) | `403` | **`101 Switching Protocols`** |
| `Origin: http://127.0.0.1:<port>` (browser, same-origin) | `101` | **`101`** |
| `Origin: http://evil.example` | `403` | **`403`** |
| `Origin: http://127.0.0.1:9999` (other port) | `403` | **`403`** |
| `Origin: dsh-app://evil` (forged scheme host) | `403` | **`403`** |
| Non-loopback `Host`, no `Origin` | `403` | **`403`** |

The fence loses no rejection: only the harness's own shell origin is additionally
accepted, and a remote client cannot forge it. An authenticated `snapshot` round-trip
then completes and `ssh_connect` / `ssh_exec` succeed against a real server.

## Upstream

The fix is reported and proposed upstream:

- Issue — [jmcc-guo/dsh-ssh#1](https://github.com/jmcc-guo/dsh-ssh/issues/1)
- Pull request — [jmcc-guo/dsh-ssh#2](https://github.com/jmcc-guo/dsh-ssh/pull/2)
- Branch — [`fix/dsh-0.2.0-desktop-client`](https://github.com/starxxy/dsh-ssh/tree/fix/dsh-0.2.0-desktop-client)

Until that pull request is merged, this fork is the ready-to-install version. Apart from
the three files above and the added documentation, `main` tracks upstream.

## License

MIT, unchanged from upstream. Original work © jmcc-guo — see [`LICENSE`](LICENSE).
