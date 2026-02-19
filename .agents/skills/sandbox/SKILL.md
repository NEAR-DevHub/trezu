---
name: sandbox
description: Start or restart the E2E test sandbox (NEAR blockchain + Treasury backend + PostgreSQL). Required before running Playwright E2E tests.
argument-hint: "[start|stop|restart|status]"
---

# E2E Test Sandbox

Manages the Docker sandbox container needed for Playwright E2E tests. The sandbox provides a local NEAR blockchain, the Treasury backend API, a Sputnik DAO indexer, and PostgreSQL — all in a single container.

## Usage

- `/sandbox` or `/sandbox start` — Start the sandbox (pull latest image, stop conflicts, run)
- `/sandbox stop` — Stop and remove the sandbox container
- `/sandbox restart` — Stop then start
- `/sandbox status` — Check if sandbox is running and healthy

## How to start the sandbox

### 1. Free port 8080

The sandbox needs ports 3030, 8080, and 5001. Stop any conflicting processes first:

```bash
# Check what's on port 8080
lsof -i :8080 -P -n

# If the nt-be dev backend or postgres dev container is running, stop it:
docker stop nt-be-postgres-1 2>/dev/null || true
# Kill any node/cargo process on 8080 if needed
kill $(lsof -t -i :8080) 2>/dev/null || true
```

### 2. Pull and run the sandbox image

```bash
# Pull latest sandbox image (public, no auth needed)
docker pull ghcr.io/near-devhub/treasury26/near-treasury-sandbox:main

# Remove any previous sandbox container
docker rm -f sandbox 2>/dev/null || true

# Start the sandbox
docker run -d --name sandbox \
  -p 3030:3030 -p 8080:8080 -p 5001:5001 \
  --health-cmd "curl -f http://localhost:8080/api/health || exit 1" \
  --health-interval 10s \
  --health-timeout 5s \
  --health-retries 30 \
  --health-start-period 120s \
  ghcr.io/near-devhub/treasury26/near-treasury-sandbox:main
```

### 3. Wait for the sandbox to be healthy

The sandbox takes 60-120 seconds to fully initialize (NEAR blockchain genesis, contract deployment, database migrations).

```bash
echo "Waiting for sandbox to be healthy..."
for i in $(seq 1 60); do
  if curl -sf http://localhost:8080/api/health > /dev/null 2>&1; then
    echo "Sandbox is ready!"
    break
  fi
  echo "Attempt $i: Not ready yet..."
  sleep 5
done
```

Verify with:
```bash
curl -s http://localhost:8080/api/health
docker inspect sandbox --format='{{.State.Health.Status}}'
```

### 4. Run E2E tests

```bash
cd nt-fe
BACKEND_URL=http://localhost:8080 npx playwright test
```

## How to stop the sandbox

```bash
docker stop sandbox && docker rm sandbox
```

## Ports

| Port | Service | Description |
|------|---------|-------------|
| 3030 | NEAR RPC | Local NEAR blockchain JSON-RPC |
| 8080 | Treasury API | Backend REST API |
| 5001 | Sputnik Indexer | DAO proposal caching |

## Image

The sandbox image is built automatically by CI and pushed to:
`ghcr.io/near-devhub/treasury26/near-treasury-sandbox:main`

PR-specific images are tagged as `pr-<number>` when available.

## Troubleshooting

- **Container won't start**: Check `docker logs sandbox` for errors
- **API returns 500**: Services need 60-120s to initialize after container start
- **Port conflict**: Stop the dev backend (`nt-be-postgres-1`) or any process on port 8080
