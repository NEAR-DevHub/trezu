/**
 * Types for omni-cli-rs chain-signature proposals.
 *
 * An omni proposal is a SputnikDAO FunctionCall to the NEAR MPC signer whose
 * description is a JSON "envelope" describing the full unsigned foreign-chain
 * transaction. See https://github.com/near/omni-cli-rs (DESIGN.md,
 * src/envelope.rs, src/commands/proposal/mod.rs).
 */

export type NearNetwork = "mainnet" | "testnet";

export type OmniFamily = "evm" | "svm" | "utxo" | "aptos" | "sui" | "ton";

export const OMNI_FAMILIES: readonly OmniFamily[] = [
    "evm",
    "svm",
    "utxo",
    "aptos",
    "sui",
    "ton",
];

export function isOmniFamily(value: unknown): value is OmniFamily {
    return (
        typeof value === "string" &&
        (OMNI_FAMILIES as readonly string[]).includes(value)
    );
}

/** Key domains on the MPC signer contract (`state()` view). */
export const SECP256K1_DOMAIN_ID = 0;
export const ED25519_DOMAIN_ID = 1;

export function domainIdForFamily(family: OmniFamily): number {
    switch (family) {
        case "evm":
        case "utxo":
            return SECP256K1_DOMAIN_ID;
        case "svm":
        case "aptos":
        case "sui":
        case "ton":
            return ED25519_DOMAIN_ID;
    }
}

export interface OmniEnvelopeMeta {
    nonce?: number;
    builder_version?: string;
    after_broadcast?: string;
}

/** The parsed description. `family` and `chain` are kept as raw strings so
 * unknown values still render (with UNVERIFIED status). */
export interface OmniEnvelope {
    omni: number;
    intent: string;
    family: string;
    chain: string;
    path: string;
    unsigned_tx: unknown;
    meta: OmniEnvelopeMeta;
}

export type EnvelopeParseResult =
    | { ok: true; envelope: OmniEnvelope; sizeBytes: number }
    | {
          ok: false;
          /** Machine-readable reason; mapped to i18n in the UI. */
          reason:
              | "not-json"
              | "not-object"
              | "missing-omni-marker"
              | "too-large"
              | "missing-fields";
          sizeBytes: number;
          /** Fields that were missing or of the wrong type (missing-fields only). */
          missing?: string[];
          /** Best-effort partial envelope for rendering when some fields exist. */
          partial?: Partial<OmniEnvelope>;
      };

/** One decoded `sign` action on the MPC contract. */
export interface OmniSignRequest {
    index: number;
    methodName: string;
    /** Derivation path, or null when args were malformed. */
    path: string | null;
    domainId: number | null;
    /** "Ecdsa" | "Eddsa" | null when args were malformed. */
    scheme: "Ecdsa" | "Eddsa" | null;
    /** Lowercase hex without 0x prefix, or null when missing. */
    payloadHex: string | null;
    gas: string;
    deposit: string;
    /** Raw decoded args for the raw section. */
    rawArgs: unknown;
    argsDecodeError: boolean;
}

export type CheckState = "pass" | "fail" | "skip";

export type CheckId =
    | "receiver"
    | "methods"
    | "path"
    | "domain"
    | "payload-count"
    | "payload-bytes"
    | "chain-id";

export interface VerificationCheck {
    id: CheckId;
    state: CheckState;
    /** Extra detail values for the i18n message (e.g. expected/actual). */
    detail?: Record<string, string | number>;
}

export type VerificationStatus = "verified" | "mismatch" | "unverified";

/** Result of recomputing the MPC signing payload(s) from `unsigned_tx`. */
export type PayloadRecompute =
    | { ok: true; payloadsHex: string[] }
    | {
          ok: false;
          reason:
              | "unsupported-family"
              | "unsupported-shape"
              | "invalid-field"
              | "contract-creation"
              | "family-not-verifiable";
          /** Field name or free-text detail for the UI. */
          detail?: string;
      };

export const OMNI_ENVELOPE_VERSION = 1;

export type UnverifiedReason =
    | Extract<PayloadRecompute, { ok: false }>["reason"]
    | "envelope"
    | "unsupported-envelope-version"
    | "unknown-chain";

export interface VerificationResult {
    status: VerificationStatus;
    checks: VerificationCheck[];
    /** Why the status is UNVERIFIED (when it is). */
    unverifiedReason?: UnverifiedReason;
    unverifiedDetail?: string;
    /** Payloads the proposal asks the MPC to sign (hex, no 0x). */
    proposalPayloadsHex: string[];
    /** Payloads recomputed from the envelope (hex, no 0x), when recomputable. */
    recomputedPayloadsHex: string[] | null;
    /** True when description has the omni marker but the kind is not a plain
     * MPC sign request (wrong receiver or non-sign actions). */
    notPlainSignRequest: boolean;
}

/** Fully decoded EIP-1559 transaction (all integers as BigInt). */
export interface EvmUnsignedTx {
    chainId: bigint;
    nonce: bigint;
    to: `0x${string}`;
    value: bigint;
    input: `0x${string}`;
    gasLimit: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
}

/** Data handed to the proposal UI (list cell + expanded view). */
export interface OmniProposalData {
    receiver: string;
    actions: OmniSignRequest[];
    parsed: EnvelopeParseResult;
    verification: VerificationResult;
    network: NearNetwork;
    /** Description length in bytes (for the raw section / size warnings). */
    descriptionBytes: number;
}
