import type { Proposal } from "@/lib/proposals-api";
import { aptosPayloadsFromEnvelope } from "./aptos/recompute";
import { resolveChain } from "./chains";
import { parseEnvelope } from "./envelope";
import { evmPayloadsFromEnvelope } from "./evm/sighash";
import { getMpcSignerContract } from "./network";
import { decodeSignActions } from "./sign-actions";
import { suiPayloadsFromEnvelope } from "./sui/recompute";
import { svmPayloadsFromEnvelope } from "./svm/recompute";
import {
    parseTonUnsignedTx,
    tonPayloadsFromEnvelope,
    walletIdNetworkCheck,
} from "./ton/recompute";
import {
    domainIdForFamily,
    type EnvelopeParseResult,
    isOmniFamily,
    type NearNetwork,
    OMNI_ENVELOPE_VERSION,
    type OmniProposalData,
    type OmniSignRequest,
    type PayloadRecompute,
    type VerificationCheck,
    type VerificationResult,
} from "./types";
import { utxoPayloadsFromEnvelope } from "./utxo/recompute";

/**
 * Recompute the MPC signing payload(s) for a family. All six families
 * omni-cli-rs supports recompute in the browser; parse failures return the
 * reason and the UI shows the proposal's payload with a CLI hint.
 */
export function recomputePayloads(
    family: string,
    unsignedTx: unknown,
): PayloadRecompute {
    if (!isOmniFamily(family)) {
        return { ok: false, reason: "unsupported-family", detail: family };
    }
    switch (family) {
        case "evm":
            return evmPayloadsFromEnvelope(unsignedTx);
        case "aptos":
            return aptosPayloadsFromEnvelope(unsignedTx);
        case "ton":
            return tonPayloadsFromEnvelope(unsignedTx);
        case "svm":
            return svmPayloadsFromEnvelope(unsignedTx);
        case "sui":
            return suiPayloadsFromEnvelope(unsignedTx);
        case "utxo":
            return utxoPayloadsFromEnvelope(unsignedTx);
        default:
            // Every family omni-cli-rs supports recomputes in the browser;
            // this only fires if a family is added to OmniFamily without a
            // recompute implementation.
            return {
                ok: false,
                reason: "family-not-verifiable",
                detail: family,
            };
    }
}

/**
 * The verification checklist, mirroring `verify_envelope_against_kind` in
 * omni-cli-rs plus the registry chain-id check. Pure and synchronous: it
 * depends only on the proposal data, never on network lookups.
 */
export function verifyOmniProposal(
    receiver: string,
    actions: OmniSignRequest[],
    parsed: EnvelopeParseResult,
    network: NearNetwork,
): VerificationResult {
    const checks: VerificationCheck[] = [];
    const expectedMpc = getMpcSignerContract(network);
    const proposalPayloadsHex = actions
        .map((a) => a.payloadHex)
        .filter((p): p is string => p !== null);

    // 1. receiver is the MPC signer contract
    const receiverOk = receiver === expectedMpc;
    checks.push({
        id: "receiver",
        state: receiverOk ? "pass" : "fail",
        detail: { expected: expectedMpc, actual: receiver },
    });

    // 2. every action is a plain `sign`
    const nonSign = actions.filter((a) => a.methodName !== "sign");
    const methodsOk = actions.length > 0 && nonSign.length === 0;
    checks.push({
        id: "methods",
        state: methodsOk ? "pass" : "fail",
        detail: {
            count: actions.length,
            offending: nonSign.map((a) => a.methodName).join(", "),
        },
    });

    const notPlainSignRequest = !receiverOk || !methodsOk;

    if (!parsed.ok) {
        // Without an envelope nothing else can be checked.
        const family = parsed.partial?.family ?? "";
        const chain = parsed.partial?.chain ?? "";
        checks.push({ id: "path", state: "skip" });
        checks.push({ id: "domain", state: "skip", detail: { family } });
        checks.push({ id: "chain-id", state: "skip", detail: { chain } });
        checks.push({ id: "payload-count", state: "skip" });
        checks.push({ id: "payload-bytes", state: "skip" });
        return {
            status: notPlainSignRequest ? "mismatch" : "unverified",
            checks,
            unverifiedReason: "envelope",
            unverifiedDetail: parsed.reason,
            proposalPayloadsHex,
            recomputedPayloadsHex: null,
            notPlainSignRequest,
        };
    }

    const { envelope } = parsed;

    // Only v1 rules are known. A future version may carry several
    // transactions, so nothing below can be trusted to apply.
    if (envelope.omni !== OMNI_ENVELOPE_VERSION) {
        checks.push({ id: "path", state: "skip" });
        checks.push({
            id: "domain",
            state: "skip",
            detail: { family: envelope.family },
        });
        checks.push({
            id: "chain-id",
            state: "skip",
            detail: { chain: envelope.chain },
        });
        checks.push({ id: "payload-count", state: "skip" });
        checks.push({ id: "payload-bytes", state: "skip" });
        return {
            status: notPlainSignRequest ? "mismatch" : "unverified",
            checks,
            unverifiedReason: "unsupported-envelope-version",
            unverifiedDetail: String(envelope.omni),
            proposalPayloadsHex,
            recomputedPayloadsHex: null,
            notPlainSignRequest,
        };
    }

    // 3. derivation path matches the envelope
    const badPath = actions.find((a) => a.path !== envelope.path);
    checks.push({
        id: "path",
        state: actions.length > 0 && !badPath ? "pass" : "fail",
        detail: {
            expected: envelope.path,
            actual: badPath?.path ?? "",
            index: badPath ? badPath.index + 1 : 0,
        },
    });

    // 4. key domain matches the family
    const expectedDomain = isOmniFamily(envelope.family)
        ? domainIdForFamily(envelope.family)
        : null;
    const badDomain =
        expectedDomain === null
            ? undefined
            : actions.find((a) => a.domainId !== expectedDomain);
    checks.push({
        id: "domain",
        state:
            expectedDomain === null
                ? "skip"
                : actions.length > 0 && !badDomain
                  ? "pass"
                  : "fail",
        detail: {
            expected: expectedDomain ?? "",
            actual: badDomain?.domainId ?? "",
            family: envelope.family,
            index: badDomain ? badDomain.index + 1 : 0,
        },
    });

    // 7. registry consistency: envelope.chain resolves and, for EVM, the
    //    unsigned_tx.chain_id equals the registry chain id.
    const chain = resolveChain(envelope.chain, network);
    let chainIdState: VerificationCheck["state"] = "skip";
    let chainIdDetail: Record<string, string | number> = {
        chain: envelope.chain,
    };
    if (chain) {
        if (chain.family !== envelope.family) {
            chainIdState = "fail";
            chainIdDetail = {
                chain: envelope.chain,
                expected: chain.family,
                actual: envelope.family,
            };
        } else if (chain.family === "ton") {
            // TON has no chain id; a v5r1 wallet id encodes the network
            // global id (mainnet -239, testnet -3) instead.
            const parsedTon = parseTonUnsignedTx(envelope.unsigned_tx);
            if (parsedTon.ok) {
                const walletCheck = walletIdNetworkCheck(parsedTon.tx, network);
                chainIdState = walletCheck.state;
                chainIdDetail = {
                    chain: envelope.chain,
                    expected: walletCheck.expected,
                    actual: String(parsedTon.tx.walletId),
                };
            }
        } else if (chain.chainId !== undefined) {
            // EVM: unsigned_tx.chain_id; Aptos: unsigned_tx.tx.chain_id.
            const unsigned = envelope.unsigned_tx as Record<string, unknown>;
            const inner = unsigned?.tx as Record<string, unknown> | undefined;
            const txChainId = unsigned?.chain_id ?? inner?.chain_id;
            const txChainIdText =
                typeof txChainId === "number" || typeof txChainId === "string"
                    ? String(txChainId)
                    : "";
            chainIdState =
                txChainIdText === String(chain.chainId) ? "pass" : "fail";
            chainIdDetail = {
                chain: envelope.chain,
                expected: chain.chainId,
                actual: txChainIdText,
            };
        } else {
            chainIdState = "pass";
        }
    }
    checks.push({ id: "chain-id", state: chainIdState, detail: chainIdDetail });

    // 5 + 6. recomputed payloads
    const recomputed = recomputePayloads(envelope.family, envelope.unsigned_tx);
    let recomputedPayloadsHex: string[] | null = null;
    if (recomputed.ok) {
        recomputedPayloadsHex = recomputed.payloadsHex;
        const countOk = recomputed.payloadsHex.length === actions.length;
        checks.push({
            id: "payload-count",
            state: countOk ? "pass" : "fail",
            detail: {
                expected: recomputed.payloadsHex.length,
                actual: actions.length,
            },
        });
        let bytesOk = countOk;
        let badIndex = 0;
        if (countOk) {
            for (let i = 0; i < actions.length; i++) {
                if (actions[i].payloadHex !== recomputed.payloadsHex[i]) {
                    bytesOk = false;
                    badIndex = i;
                    break;
                }
            }
        }
        checks.push({
            id: "payload-bytes",
            state: bytesOk ? "pass" : "fail",
            detail: {
                index: badIndex + 1,
                expected: recomputed.payloadsHex[badIndex] ?? "",
                actual: actions[badIndex]?.payloadHex ?? "",
            },
        });
    } else {
        checks.push({ id: "payload-count", state: "skip" });
        checks.push({ id: "payload-bytes", state: "skip" });
    }

    const anyFail = checks.some((c) => c.state === "fail");
    if (anyFail) {
        return {
            status: "mismatch",
            checks,
            proposalPayloadsHex,
            recomputedPayloadsHex,
            notPlainSignRequest,
        };
    }
    if (!recomputed.ok) {
        return {
            status: "unverified",
            checks,
            unverifiedReason: recomputed.reason,
            unverifiedDetail: recomputed.detail,
            proposalPayloadsHex,
            recomputedPayloadsHex,
            notPlainSignRequest,
        };
    }
    if (!chain) {
        return {
            status: "unverified",
            checks,
            unverifiedReason: "unknown-chain",
            unverifiedDetail: envelope.chain,
            proposalPayloadsHex,
            recomputedPayloadsHex,
            notPlainSignRequest,
        };
    }
    return {
        status: "verified",
        checks,
        proposalPayloadsHex,
        recomputedPayloadsHex,
        notPlainSignRequest,
    };
}

/**
 * Everything the UI needs for an omni proposal, computed synchronously from
 * the proposal alone. Never throws.
 */
export function extractOmniProposalData(
    proposal: Proposal,
    network: NearNetwork,
): OmniProposalData {
    const parsed = parseEnvelope(proposal.description);
    let receiver = "";
    let actions: OmniSignRequest[] = [];
    if (
        typeof proposal.kind === "object" &&
        proposal.kind !== null &&
        "FunctionCall" in proposal.kind
    ) {
        receiver = proposal.kind.FunctionCall.receiver_id;
        actions = decodeSignActions(proposal.kind.FunctionCall.actions ?? []);
    }
    const verification = verifyOmniProposal(receiver, actions, parsed, network);
    return {
        receiver,
        actions,
        parsed,
        verification,
        network,
        descriptionBytes: parsed.sizeBytes,
    };
}
