import type { NearNetwork } from "./types";

/** MPC signer contract per NEAR network (chain-signatures v2). */
export const MPC_SIGNER_CONTRACTS: Record<NearNetwork, string> = {
    mainnet: "v1.signer",
    testnet: "v1.signer-prod.testnet",
};

/**
 * The NEAR network this deployment talks to. Trezu is mainnet-only today;
 * `NEXT_PUBLIC_NEAR_NETWORK=testnet` switches the MPC contract, chain
 * registry variants and CLI hints.
 */
export function getNearNetwork(): NearNetwork {
    return process.env.NEXT_PUBLIC_NEAR_NETWORK === "testnet"
        ? "testnet"
        : "mainnet";
}

export function getMpcSignerContract(network: NearNetwork): string {
    return MPC_SIGNER_CONTRACTS[network];
}

export function getNearRpcUrl(network: NearNetwork): string {
    if (process.env.NEXT_PUBLIC_NEAR_RPC_URL) {
        return process.env.NEXT_PUBLIC_NEAR_RPC_URL;
    }
    return network === "testnet"
        ? "https://rpc.testnet.fastnear.com"
        : "https://rpc.mainnet.fastnear.com";
}
