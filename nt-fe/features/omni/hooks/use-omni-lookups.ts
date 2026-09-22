"use client";

import { useQuery } from "@tanstack/react-query";
import { useProposals } from "@/hooks/use-proposals";
import type { Proposal } from "@/lib/proposals-api";
import type { ResolvedChain } from "../chains";
import { type DerivedAccount, fetchDerivedAccount } from "../derived-address";
import { hasOmniMarker, parseEnvelope } from "../envelope";
import { type DecodedCall, decodeCalldata } from "../evm/calldata";
import { fetchEvmHasCode, fetchEvmNonce } from "../evm/rpc";
import { parseEvmUnsignedTx } from "../evm/sighash";
import { getNearNetwork } from "../network";
import { isOmniFamily, type NearNetwork } from "../types";

/**
 * All network lookups for the expanded omni view. Every hook degrades to
 * `undefined` data + `isError` on failure; none of them influence the
 * verification status, which is computed synchronously in verify.ts.
 */

export function useOmniDerivedAccount(
    dao: string | undefined,
    path: string | undefined,
    family: string | undefined,
    network: NearNetwork,
) {
    const enabled = !!dao && !!path && isOmniFamily(family);
    return useQuery<DerivedAccount>({
        queryKey: ["omni-derived-account", network, dao, path, family],
        queryFn: () => {
            if (!dao || !path || !isOmniFamily(family)) {
                throw new Error("derived account lookup not enabled");
            }
            return fetchDerivedAccount(dao, path, family, network);
        },
        enabled,
        // Cached per (network, dao, path, family) for the page lifetime. A
        // malformed key from the contract is not retryable; RPC failures get
        // a manual retry button in the UI instead of a loop.
        staleTime: Number.POSITIVE_INFINITY,
        retry: false,
    });
}

export function useOmniEvmNonce(
    chain: ResolvedChain | null,
    address: string | undefined,
    enabled = true,
) {
    return useQuery<bigint>({
        queryKey: ["omni-evm-nonce", chain?.key, chain?.network, address],
        queryFn: () => {
            if (!chain || !address) {
                throw new Error("nonce lookup not enabled");
            }
            return fetchEvmNonce(chain.rpcUrl, address);
        },
        enabled: enabled && !!chain && !!address && chain.family === "evm",
        staleTime: 30_000,
        retry: 1,
    });
}

export function useOmniDecodedCalldata(
    chainId: number | undefined,
    to: string | undefined,
    input: `0x${string}` | undefined,
) {
    return useQuery<{ decoded: DecodedCall | null; sourcifyFailed: boolean }>({
        queryKey: ["omni-calldata", chainId, to, input],
        queryFn: () => {
            if (!chainId || !to || !input) {
                throw new Error("calldata lookup not enabled");
            }
            return decodeCalldata(chainId, to, input);
        },
        enabled: !!chainId && !!to && !!input && input.length >= 10,
        staleTime: Number.POSITIVE_INFINITY,
        retry: false,
    });
}

/** Whether the EVM target has code. Presentation only (EOA warning). */
export function useOmniEvmHasCode(
    chain: ResolvedChain | null,
    address: string | undefined,
    enabled = true,
) {
    return useQuery<boolean>({
        queryKey: ["omni-evm-has-code", chain?.key, chain?.network, address],
        queryFn: () => {
            if (!chain || !address) {
                throw new Error("code lookup not enabled");
            }
            return fetchEvmHasCode(chain.rpcUrl, address);
        },
        enabled: enabled && !!chain && !!address && chain.family === "evm",
        staleTime: Number.POSITIVE_INFINITY,
        retry: 1,
    });
}

/**
 * Other open omni proposals of the same DAO that target the same path +
 * chain with the same EVM nonce. Only InProgress proposals count.
 */
export function useOmniDuplicateNonce(
    dao: string | undefined,
    current: Proposal,
    path: string | undefined,
    chain: string | undefined,
    nonce: bigint | undefined,
): number[] {
    const enabled = !!dao && !!path && !!chain && nonce !== undefined;
    const { data } = useProposals(
        dao,
        { statuses: ["InProgress"], page_size: 100 },
        enabled,
    );
    if (!enabled || !data?.proposals) return [];
    const duplicates: number[] = [];
    for (const proposal of data.proposals) {
        if (proposal.id === current.id) continue;
        if (!hasOmniMarker(proposal.description)) continue;
        const parsed = parseEnvelope(proposal.description);
        if (!parsed.ok) continue;
        if (parsed.envelope.path !== path || parsed.envelope.chain !== chain)
            continue;
        if (parsed.envelope.family !== "evm") continue;
        const tx = parseEvmUnsignedTx(parsed.envelope.unsigned_tx);
        if (tx.ok && tx.tx.nonce === nonce) duplicates.push(proposal.id);
    }
    return duplicates.sort((a, b) => a - b);
}

export function useNearNetwork(): NearNetwork {
    return getNearNetwork();
}
