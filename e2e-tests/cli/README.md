# trezu CLI E2E Tests

End-to-end tests for the `trezu` CLI binary, run against a locally running
sandbox (NEAR sandbox + nt-be backend in Docker).

## What's covered

Every top-level CLI command, invoked non-interactively as a child process:

- `auth login` / `auth whoami` / `auth logout` (via `sign-with-private-key`)
- `treasury list` / `treasury info <dao>`
- `assets <dao>`, `activity <dao>`, `members <dao>`
- `address-book <dao> add | list | remove`
- `requests <dao> list | pending | view | approve | reject`
- `payments <dao> send NEAR <amount> <recipient> <description>` — full
  delegate-action → Trezu relay → DAO proposal path
- Negative test: protected commands fail cleanly after logout

## Prerequisites

1. **Build the CLI**
   ```bash
   cd nt-cli && cargo build
   ```

2. **Start the sandbox** (NEAR + nt-be + indexer)
   ```bash
   docker build -t near-treasury-sandbox -f sandbox/Dockerfile .
   docker run -d --name sandbox \
     -p 3030:3030 -p 8080:8080 -p 5001:5001 \
     near-treasury-sandbox
   sleep 30   # wait for services to come up
   curl http://localhost:8080/api/health
   ```

3. **Install test deps**
   ```bash
   cd e2e-tests/cli && npm install
   ```

## Running

```bash
npm run test:docker
```

Or with custom endpoints:

```bash
SANDBOX_RPC_URL=http://localhost:3030 \
API_URL=http://localhost:8080 \
TREZU_BIN=/abs/path/to/trezu \
npm test
```

## Configuration

| Env | Default |
|---|---|
| `SANDBOX_RPC_URL` | `http://localhost:3030` |
| `API_URL` | `http://localhost:8080` |
| `TREZU_BIN` | `../../nt-cli/target/debug/trezu` |
| `DAO_FACTORY_ID` | `sputnik-dao.near` |
| `GENESIS_ACCOUNT_ID` | `test.near` |
| `GENESIS_PRIVATE_KEY` | (sandbox public test key) |
| `DAO_NAME` | `cli-e2e-<timestamp>` |

The test isolates the CLI's config under a temp `XDG_CONFIG_HOME` so it
never touches your real `~/.config/trezu/config.json`.
