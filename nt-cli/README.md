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

## Using from scripts and AI agents

Scripts and AI agents usually run without a terminal (no TTY). There the CLI cannot ask questions, so any missing argument fails with `The input device is not a TTY`. Always pass the whole command. Sign in first as shown in [Sign in](#sign-in).

### Read

```sh
trezu treasury list
trezu treasury info <treasury>
trezu assets <treasury>
trezu members <treasury>
trezu activity <treasury>
trezu address-book <treasury> list
trezu requests <treasury> pending
trezu requests <treasury> list --status InProgress   # or Approved, Rejected, Expired, Failed
trezu requests <treasury> view <request-id>
```

`<treasury>` is the treasury's account id, e.g. `acme.sputnik-dao.near`.

### Create and vote on requests

Commands that change the treasury do not move funds directly. They create a request (a DAO proposal) or vote on one, and nothing happens until enough approvers approve it. Every such command ends with the same tail:

```
network-config mainnet sign-with-access-key-file <key-file> send
```

The CLI builds the DAO proposal itself and Trezu relays it and pays the gas, so there is no gas or deposit to choose. Use exactly this tail. Other options NEAR CLI offers at that point, like `submit-as-dao-proposal` or `sign-later`, do not apply.

Pay someone:

```sh
trezu payments <treasury> send <token> details <amount> <destination-network> <recipient> '<description>' \
  network-config mainnet sign-with-access-key-file <key-file> send
```

- `<token>`: a symbol from `trezu assets <treasury>`, e.g. `NEAR` or `USDC`. If the treasury holds the same symbol in several forms, add the form: `NEAR@near`, `USDT@intents`, `USDT@ft`. A token contract id also works.
- `<amount>`: what the recipient receives, in whole tokens (`0.1`, `250`).
- `<destination-network>` and `<recipient>`:
  - `near.com`: the recipient's NEAR Intents (near.com) balance. Write the recipient as `nearcom:<account>`, e.g. `nearcom:alice.near`.
  - `near`: a NEAR account, e.g. `alice.near`.
  - another chain: its bridge asset id, e.g. `nep141:eth.omft.near`, with an address on that chain.
- `<description>`: a short memo shown to approvers.

Example, 0.1 NEAR to `frol.near`'s near.com balance:

```sh
trezu payments acme.sputnik-dao.near send NEAR details 0.1 near.com nearcom:frol.near 'Test payment' \
  network-config mainnet sign-with-access-key-file ~/.near-credentials/implicit/<account-id>.json send
```

On success the CLI prints `Delegate action relayed successfully!` and a `View proposal: <url>` link to the new request.

Vote:

```sh
trezu requests <treasury> approve <request-id> network-config mainnet sign-with-access-key-file <key-file> send
trezu requests <treasury> reject <request-id> network-config mainnet sign-with-access-key-file <key-file> send
```

### Troubleshooting

- `The input device is not a TTY`: an argument is missing. Compare the command with the forms above, or run `trezu <command> --help`.
- `Not logged in`: run `trezu auth login` again.
- Add `--teach-me` before the command (`trezu --teach-me assets <treasury>`) for verbose output.

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
one-time invite link. It picks an avatar for the product it runs in (Claude,
ChatGPT, Gemini, Cursor, NEAR AI, or a generic agent). You then approve it
under **Members > Join requests**.
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
