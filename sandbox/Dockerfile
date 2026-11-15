# syntax=docker/dockerfile:1
# Multi-stage Dockerfile for NEAR Treasury Sandbox Test Environment
# Builds and runs:
# - NEAR Sandbox (via near-sandbox binary)
# - Bulk Payment Contract
# - Treasury Backend (nt-be)
# - Sputnik DAO Indexer (proposal caching)
#
# Build-speed notes (CI builds this image on every E2E run):
# - The Rust toolchain image is pinned: a moving `rust:latest` digest
#   invalidates every cached layer below it.
# - Every `cargo build` keeps its `target/` and cargo registry in BuildKit cache
#   mounts and copies only the final artifact out, so image layers (and the
#   GitHub Actions layer cache) hold binaries, not multi-GB target dirs. CI
#   persists the nt-be mounts between runs with buildkit-cache-dance, so a
#   change to nt-be/src only recompiles nt-be itself, not its dependencies.

ARG RUST_IMAGE=rust:1.100.0-trixie

# ============================================================================
# Stage 1: Build the Bulk Payment Contract
# ============================================================================
FROM ${RUST_IMAGE} AS contract-builder

WORKDIR /build

# Install cargo-near via pre-built binary (much faster than cargo install)
RUN curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/cargo-near/releases/download/cargo-near-v0.21.1/cargo-near-installer.sh | sh

# Install Rust 1.86 toolchain for building the contract
RUN rustup target add wasm32-unknown-unknown

COPY contracts/bulk-payment/Cargo.toml contracts/bulk-payment/Cargo.lock* ./
COPY contracts/bulk-payment/src ./src

RUN --mount=type=cache,id=contract-cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=contract-target,target=/build/target \
    cargo near build non-reproducible-wasm \
    && mkdir -p /out \
    && cp target/near/bulk_payment_contract.wasm /out/

# ============================================================================
# Stage 2: Build the Sandbox Initializer
# ============================================================================
FROM ${RUST_IMAGE} AS sandbox-builder

WORKDIR /build

RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

COPY sandbox/sandbox-init/Cargo.toml sandbox-init/
COPY sandbox/sandbox-init/src sandbox-init/src
COPY sandbox/contracts/ contracts/

RUN --mount=type=cache,id=sandbox-init-cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=sandbox-init-cargo-git,target=/usr/local/cargo/git \
    --mount=type=cache,id=sandbox-init-target,target=/build/sandbox-init/target \
    cd sandbox-init && cargo build --release \
    && mkdir -p /out \
    && cp target/release/sandbox-init /out/

# ============================================================================
# Stage 3: Build the Treasury Backend (nt-be)
# ============================================================================
FROM ${RUST_IMAGE} AS api-builder

WORKDIR /build

RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Mirror the repo layout: `shared/` is a sibling of the `nt-be` crate root so the
# `include_str!("../../../../shared/...")` path in templates.rs resolves at build time.
COPY nt-be/Cargo.toml nt-be/Cargo.lock nt-be/
COPY nt-be/src nt-be/src
COPY nt-be/migrations nt-be/migrations
COPY nt-be/.sqlx nt-be/.sqlx
COPY nt-be/data nt-be/data
COPY shared/ shared/

# `release` by default (matches production); CI passes NT_BE_PROFILE=ci for
# a much faster, less optimized build (see [profile.ci] in nt-be/Cargo.toml).
ARG NT_BE_PROFILE=release
ENV SQLX_OFFLINE=true
# Mount ids must stay in sync with the cache-map in .github/workflows/e2e.yml.
# Only the registry index and downloaded .crate files are mounted (not the
# unpacked registry/src, which cargo recreates quickly and which would double
# the size of the CI cache); registry crates are fingerprinted by version, so
# re-unpacking them doesn't trigger recompiles.
RUN --mount=type=cache,id=nt-be-cargo-registry-index,target=/usr/local/cargo/registry/index \
    --mount=type=cache,id=nt-be-cargo-registry-cache,target=/usr/local/cargo/registry/cache \
    --mount=type=cache,id=nt-be-cargo-git,target=/usr/local/cargo/git \
    --mount=type=cache,id=nt-be-target,target=/build/nt-be/target \
    cd nt-be && cargo build --profile "${NT_BE_PROFILE}" --bin nt-be \
    && mkdir -p /out \
    && cp "target/${NT_BE_PROFILE}/nt-be" /out/

# ============================================================================
# Stage 4: Build the Sputnik Indexer
# ============================================================================
FROM ${RUST_IMAGE} AS indexer-builder

WORKDIR /app

# Pinned so the layer cache stays valid (and builds are reproducible). Bump
# deliberately to pick up upstream changes.
ARG SPUTNIK_INDEXER_REV=de138e4f528bb0393270237f21eace7170b7b321
RUN git init -q . \
    && git remote add origin https://github.com/near-daos/sputnik-dao-caching-api-server.git \
    && git fetch -q --depth 1 origin "${SPUTNIK_INDEXER_REV}" \
    && git checkout -q FETCH_HEAD
RUN --mount=type=cache,id=indexer-cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=indexer-cargo-git,target=/usr/local/cargo/git \
    --mount=type=cache,id=indexer-target,target=/app/target \
    cargo build --release --bin sputnik-indexer \
    && mkdir -p /out \
    && cp target/release/sputnik-indexer /out/

# ============================================================================
# Stage 5: Runtime environment
# ============================================================================
FROM debian:trixie-slim AS runtime

RUN apt-get update && apt-get install -y \
    curl \
    supervisor \
    ca-certificates \
    socat \
    postgresql \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built binaries
COPY --from=sandbox-builder /out/sandbox-init /usr/local/bin/
COPY --from=api-builder /out/nt-be /usr/local/bin/
COPY --from=indexer-builder /out/sputnik-indexer /usr/local/bin/

# Copy contract WASM
COPY --from=contract-builder /out/bulk_payment_contract.wasm /app/contracts/bulk_payment.wasm

# Copy configuration files
COPY sandbox/supervisord.conf /etc/supervisor/conf.d/
COPY sandbox/start-sandbox.sh /usr/local/bin/
COPY sandbox/start-postgres.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/start-sandbox.sh /usr/local/bin/start-postgres.sh

# Copy additional contracts (DAO factory, wrap.near, etc.)
COPY sandbox/contracts/ /app/contracts/


# Create directories
RUN mkdir -p /data /var/log

# Expose ports
# 3030 - NEAR RPC
# 8080 - Treasury API
# 5001 - Sputnik Indexer
# 5432 - PostgreSQL
EXPOSE 3030 4000 8080 5001 5432

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8080/api/health || exit 1

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
