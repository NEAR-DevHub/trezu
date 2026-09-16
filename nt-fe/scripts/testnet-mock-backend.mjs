#!/usr/bin/env node

/**
 * Dev-only mock backend for viewing a NEAR *testnet* DAO in the trezu UI
 * without building nt-be.
 *
 * Serves the read endpoints the treasury pages need straight from NEAR RPC
 * view calls (no database, no indexer):
 *   GET /api/proposals/{dao}            get_last_proposal_id + get_proposals
 *   GET /api/proposal/{dao}/{id}        get_proposal
 *   GET /api/treasury/config?treasuryId get_config
 *   GET /api/treasury/policy?treasuryId get_policy
 *   GET /api/proposals/{dao}/proposers  derived from the proposal list
 *   GET /api/proposals/{dao}/approvers  derived from the proposal list
 *   POST /api/monitored-accounts        local no-op registration (prod shape)
 *   GET /api/proposal/{dao}/{id}/tx     404, like nt-be without an indexed execution
 * Everything else is forwarded to the real backend (default production), so
 * unrelated features keep working or fail exactly as they do in prod.
 *
 * Usage:
 *   bun run testnet:mock
 *   NEXT_PUBLIC_NEAR_NETWORK=testnet \
 *   NEXT_PUBLIC_NEAR_RPC_URL=https://rpc.testnet.fastnear.com \
 *   NEXT_PUBLIC_BACKEND_API_BASE=http://127.0.0.1:8889 bun run dev
 *   (Next's server-side fetch may resolve "localhost" to ::1; the mock
 *   listens on both stacks, but 127.0.0.1 avoids the question entirely.)
 *   open http://localhost:3000/omni-e2e.sputnik-v2.testnet/requests
 *
 * Env: MOCK_PORT (8889), MOCK_NEAR_RPC_URL (https://rpc.testnet.fastnear.com),
 * MOCK_FORWARD_TARGET (https://api.trezu.app).
 */

import http from "node:http";
import https from "node:https";

const PORT = Number(process.env.MOCK_PORT || 8889);
const RPC_URL =
    process.env.MOCK_NEAR_RPC_URL || "https://rpc.testnet.fastnear.com";
const FORWARD_TARGET =
    process.env.MOCK_FORWARD_TARGET || "https://api.trezu.app";
const PROPOSAL_BATCH = 50;
const CACHE_TTL_MS = 10_000;

const cache = new Map();

async function viewFunction(contractId, methodName, args = {}) {
    const response = await fetch(RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "query",
            params: {
                request_type: "call_function",
                finality: "final",
                account_id: contractId,
                method_name: methodName,
                args_base64: Buffer.from(JSON.stringify(args)).toString(
                    "base64",
                ),
            },
        }),
    });
    if (!response.ok)
        throw new Error(`RPC ${response.status} ${response.statusText}`);
    const body = await response.json();
    if (body.error)
        throw new Error(
            `RPC error: ${body.error.message ?? JSON.stringify(body.error)}`,
        );
    const bytes = body?.result?.result;
    if (!bytes) throw new Error(`RPC: empty result for ${methodName}`);
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
}

async function cached(key, loader) {
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    const value = await loader();
    cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
    return value;
}

/** Sputnik serializes the unit-variant kind `Vote` as a plain string; keep it. */
async function fetchProposals(daoId) {
    return cached(`proposals:${daoId}`, async () => {
        const lastId = await viewFunction(daoId, "get_last_proposal_id");
        const proposals = [];
        for (let from = 0; from < lastId; from += PROPOSAL_BATCH) {
            const limit = Math.min(PROPOSAL_BATCH, lastId - from);
            proposals.push(
                ...(await viewFunction(daoId, "get_proposals", {
                    from_index: from,
                    limit,
                })),
            );
        }
        return proposals;
    });
}

function decodeMetadata(config) {
    if (typeof config?.metadata !== "string" || config.metadata.length === 0)
        return undefined;
    try {
        const parsed = JSON.parse(
            Buffer.from(config.metadata, "base64").toString("utf8"),
        );
        return {
            primaryColor: parsed.primary_color ?? parsed.primaryColor ?? null,
            flagLogo: parsed.flag_logo ?? parsed.flagLogo ?? null,
        };
    } catch {
        return undefined;
    }
}

function json(res, origin, status, payload) {
    res.statusCode = status;
    res.writeHead(status, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(payload));
}

function applyListQuery(proposals, query) {
    let list = proposals.slice();
    const statuses = query.get("statuses");
    if (statuses) {
        const wanted = new Set(statuses.split(","));
        list = list.filter((p) => wanted.has(p.status));
    }
    const proposers = query.get("proposers");
    if (proposers) {
        const wanted = new Set(proposers.split(","));
        list = list.filter((p) => wanted.has(p.proposer));
    }
    const proposersNot = query.get("proposers_not");
    if (proposersNot) {
        const excluded = new Set(proposersNot.split(","));
        list = list.filter((p) => !excluded.has(p.proposer));
    }
    const search = query.get("search");
    if (search) {
        const needle = search.toLowerCase();
        list = list.filter(
            (p) =>
                String(p.id).includes(needle) ||
                (p.description ?? "").toLowerCase().includes(needle),
        );
    }
    const direction = query.get("sort_direction") === "asc" ? 1 : -1;
    list.sort((a, b) => (a.id - b.id) * direction);
    const page = Number(query.get("page") ?? 0);
    const pageSize = Number(query.get("page_size") ?? 10);
    return {
        page,
        page_size: pageSize,
        total: list.length,
        proposals: list.slice(page * pageSize, page * pageSize + pageSize),
    };
}

async function handleLocal(url, res, origin) {
    const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]
    if (parts[0] !== "api") return false;

    if (parts[1] === "proposals" && parts.length === 3) {
        const proposals = await fetchProposals(parts[2]);
        json(res, origin, 200, applyListQuery(proposals, url.searchParams));
        return true;
    }
    if (
        parts[1] === "proposals" &&
        parts.length === 4 &&
        parts[3] === "proposers"
    ) {
        const proposals = await fetchProposals(parts[2]);
        json(res, origin, 200, [...new Set(proposals.map((p) => p.proposer))]);
        return true;
    }
    if (
        parts[1] === "proposals" &&
        parts.length === 4 &&
        parts[3] === "approvers"
    ) {
        const proposals = await fetchProposals(parts[2]);
        json(res, origin, 200, [
            ...new Set(proposals.flatMap((p) => Object.keys(p.votes ?? {}))),
        ]);
        return true;
    }
    if (parts[1] === "proposal" && parts.length === 4) {
        const id = Number(parts[3]);
        if (!Number.isInteger(id)) {
            json(res, origin, 400, { error: "invalid proposal id" });
            return true;
        }
        try {
            json(
                res,
                origin,
                200,
                await viewFunction(parts[2], "get_proposal", { id }),
            );
        } catch (error) {
            json(res, origin, 404, { error: String(error.message ?? error) });
        }
        return true;
    }
    if (parts[1] === "proposal" && parts.length === 5 && parts[4] === "tx") {
        // Execution tx lookup needs an indexer; report "not indexed".
        json(res, origin, 404, {
            error: "execution transaction not available in mock mode",
        });
        return true;
    }
    if (parts[1] === "treasury" && parts[2] === "config") {
        const treasuryId = url.searchParams.get("treasuryId");
        if (!treasuryId) {
            json(res, origin, 400, { error: "treasuryId required" });
            return true;
        }
        const config = await cached(`config:${treasuryId}`, () =>
            viewFunction(treasuryId, "get_config"),
        );
        json(res, origin, 200, {
            metadata: decodeMetadata(config),
            name: config?.name ?? undefined,
            purpose: config?.purpose ?? undefined,
            isConfidential: false,
        });
        return true;
    }
    if (parts[1] === "treasury" && parts[2] === "policy") {
        const treasuryId = url.searchParams.get("treasuryId");
        if (!treasuryId) {
            json(res, origin, 400, { error: "treasuryId required" });
            return true;
        }
        json(
            res,
            origin,
            200,
            await cached(`policy:${treasuryId}`, () =>
                viewFunction(treasuryId, "get_policy"),
            ),
        );
        return true;
    }
    return false;
}

function forward(req, res, origin) {
    const targetUrl = new URL(req.url, FORWARD_TARGET);
    const options = {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (targetUrl.protocol === "https:" ? 443 : 80),
        path: targetUrl.pathname + targetUrl.search,
        method: req.method,
        headers: { ...req.headers, host: targetUrl.hostname },
    };
    delete options.headers.origin;
    const proxy = (targetUrl.protocol === "https:" ? https : http).request(
        options,
        (proxyRes) => {
            const headers = {
                ...proxyRes.headers,
                "access-control-allow-origin": origin,
                "access-control-allow-credentials": "true",
            };
            const setCookie = proxyRes.headers["set-cookie"];
            if (setCookie) {
                headers["set-cookie"] = (
                    Array.isArray(setCookie) ? setCookie : [setCookie]
                ).map((c) =>
                    c
                        .replace(/;\s*Secure/gi, "")
                        .replace(/;\s*Domain=[^;]*/gi, ""),
                );
            }
            res.writeHead(proxyRes.statusCode, headers);
            proxyRes.pipe(res);
        },
    );
    proxy.on("error", (err) =>
        json(res, origin, 502, { error: "Proxy error", message: err.message }),
    );
    req.pipe(proxy);
}

const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin || "http://localhost:3000";
    if (req.method === "OPTIONS") {
        res.writeHead(204, {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods":
                "GET, POST, PUT, DELETE, PATCH, OPTIONS",
            "Access-Control-Allow-Headers":
                req.headers["access-control-request-headers"] ||
                "Content-Type, Authorization, Cookie",
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Max-Age": "600",
            Vary: "Origin, Access-Control-Request-Headers",
        });
        res.end();
        return;
    }
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (req.method === "POST" && url.pathname === "/api/monitored-accounts") {
        // Registering a treasury for monitoring needs the real DB; answer the
        // prod-shaped success body so the page does not log an error.
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        let accountId = null;
        try {
            accountId =
                JSON.parse(Buffer.concat(chunks).toString("utf8")).accountId ??
                null;
        } catch {
            accountId = null;
        }
        res.locals = { source: "[mock]" };
        res.on("finish", () =>
            console.log(`[mock] POST ${req.url} -> ${res.statusCode}`),
        );
        json(res, origin, 200, {
            accountId,
            isNewRegistration: false,
            exportCredits: 0,
            batchPaymentCredits: 0,
        });
        return;
    }
    res.on("finish", () => {
        console.log(
            `${res.locals?.source ?? "[fwd] "} ${req.method} ${req.url} -> ${res.statusCode}`,
        );
    });
    res.locals = { source: "[mock]" };
    try {
        if (req.method === "GET" && (await handleLocal(url, res, origin))) {
            return;
        }
    } catch (error) {
        console.error(`[mock] ${req.url}: ${error.message ?? error}`);
        json(res, origin, 502, { error: String(error.message ?? error) });
        return;
    }
    res.locals.source = "[fwd] ";
    forward(req, res, origin);
});

// "::" gives a dual-stack socket on Node (accepts ::1 and 127.0.0.1), so both
// `localhost` resolutions used by Next's server-side fetch work.
server.listen(PORT, "::", () => {
    console.log(
        `Testnet mock backend on http://127.0.0.1:${PORT} (also [::1]:${PORT})`,
    );
    console.log(`  NEAR RPC:      ${RPC_URL}`);
    console.log(`  forwarding to: ${FORWARD_TARGET}`);
    console.log("");
    console.log("Run the frontend with:");
    console.log(
        `  NEXT_PUBLIC_NEAR_NETWORK=testnet NEXT_PUBLIC_NEAR_RPC_URL=${RPC_URL} NEXT_PUBLIC_BACKEND_API_BASE=http://127.0.0.1:${PORT} bun run dev`,
    );
});
