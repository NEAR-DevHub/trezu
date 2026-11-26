# Trezu CLI

`trezu` manages your Trezu treasuries from the terminal: list treasuries, view
assets, members and activity, manage the address book, create payment requests,
and approve or reject requests.

It is published as [`trezu-cli`](https://www.npmjs.com/package/trezu-cli) on npm
and [crates.io](https://crates.io/crates/trezu-cli). The executable is `trezu`.

## Install

Pick one:

```bash
# Node.js (any OS)
npm install -g trezu-cli
```

```bash
# Rust toolchain (on Linux, install libudev-dev first, e.g. `sudo apt install libudev-dev`)
cargo install trezu-cli --locked
```

Prebuilt installers are attached to each CLI release on
[GitHub Releases](https://github.com/NEAR-DevHub/trezu/releases). CLI releases
are tagged with the bare version (for example `0.2.1`), so swap in the latest
version from npm or crates.io:

```bash
# macOS / Linux
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/NEAR-DevHub/trezu/releases/download/0.2.1/trezu-cli-installer.sh | sh
```

```powershell
# Windows PowerShell (an .msi installer is also attached to the release)
powershell -ExecutionPolicy Bypass -c "irm https://github.com/NEAR-DevHub/trezu/releases/download/0.2.1/trezu-cli-installer.ps1 | iex"
```

Check the install with `trezu --help`. Open a new shell if `trezu` is not found
yet.

## Sign in

`trezu` signs a login challenge with a NEAR account key (NEP-413), so the
account must already exist on chain. Running `trezu` without arguments starts
an interactive menu; every command can also be run non-interactively. For
example, with a key file written by [NEAR CLI](https://github.com/near/near-cli-rs):

```bash
trezu auth login <account-id> sign-with-access-key-file ~/.near-credentials/implicit/<account-id>.json
```

Other signing methods (`sign-with-keychain`, `sign-with-ledger`,
`sign-with-seed-phrase`, ...) are offered when you run `trezu auth login
<account-id>` interactively. On the first login the CLI accepts the terms of
service for the signed-in account.

```bash
trezu auth whoami   # show the signed-in account
trezu auth logout   # clear the stored session
```

## Commands

| Command | What it does |
| --- | --- |
| `trezu treasury list` / `info` | List your treasuries, show one treasury's details |
| `trezu assets` | View treasury assets and balances |
| `trezu activity` | View recent transactions |
| `trezu members` | View treasury members and roles |
| `trezu requests list` / `pending` / `view` | Browse requests (proposals) |
| `trezu requests approve` / `reject` | Vote on a request |
| `trezu payments send` | Create a payment request |
| `trezu address-book list` / `add` / `remove` | Manage the address book |
| `trezu auth login` / `logout` / `whoami` | Manage the session |

Add `--teach-me` before the command for verbose output when troubleshooting.
After each interactive run the CLI prints the equivalent one-line command, so
you can reuse it in scripts.

## Configuration

The session and backend address are stored in `config.json` in the OS config
directory:

| OS | Path |
| --- | --- |
| macOS | `~/Library/Application Support/trezu/config.json` |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/trezu/config.json` |
| Windows | `%APPDATA%\trezu\config.json` |

```json
{ "api_base": "https://api.trezu.app", "auth_token": "…", "account_id": "…" }
```

To use another backend (for example staging or a local `nt-be`), set
`api_base` and sign in again. Treat `auth_token` as a secret.

## Onboarding an AI agent

The dashboard's **Onboard your agent** card copies a prompt that walks an
agent (Codex, Claude Code, Cursor, ...) through creating its own NEAR account,
signing in with `trezu`, and requesting to join your treasury through a
one-time invite link. You then approve it under **Members > Join requests**.
The agent never needs your keys.

## Development

```bash
cd nt-cli
cargo run -- --help
```

Releases are cut by `release-plz` (`.github/workflows/release-plz.yml`), which
publishes to crates.io and then builds the binaries, installers and npm package
with [cargo-dist](https://github.com/axodotdev/cargo-dist)
(`.github/workflows/cli-release.yml`, configured in `dist-workspace.toml`).
