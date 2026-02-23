/**
 * Maps chainName from backend to blockchain identifiers for address validation
 * 
 * This utility helps determine which blockchain validation to use based on the
 * network/chainName provided by the token data
 */

export type BlockchainType =
    | "near"
    | "bitcoin"
    | "ethereum"
    | "solana"
    | "tron"
    | "zcash"
    | "dogecoin"
    | "xrp"
    | "stellar"
    | "sui"
    | "aptos"
    | "cardano"
    | "unknown";

/**
 * Maps a chainName (from token data) to a blockchain type for validation
 */
export function getBlockchainType(chainName: string): BlockchainType {
    const chainLower = chainName.toLowerCase();

    // NEAR chains
    if (chainLower === "near") {
        return "near";
    }

    // Bitcoin
    if (chainLower === "bitcoin" || chainLower === "btc") {
        return "bitcoin";
    }

    // Ethereum and EVM chains
    const evmChains = new Set([
        "eth",
        "ethereum",
        "arbitrum",
        "arb",
        "gnosis",
        "berachain",
        "bera",
        "base",
        "polygon",
        "pol",
        "bsc",
        "binance",
        "optimism",
        "avalanche",
        "aurora",
        "turbochain",
        "vertex",
        "easychain",
        "hako",
        "optima",
        "tuxappchain",
        "aurora_devnet",
        "layerx",
        "monad",
    ]);
    if (evmChains.has(chainLower)) {
        return "ethereum";
    }

    // Solana
    if (chainLower === "solana" || chainLower === "sol") {
        return "solana";
    }

    // Tron
    if (chainLower === "tron" || chainLower === "trx") {
        return "tron";
    }

    // Zcash
    if (chainLower === "zcash" || chainLower === "zec") {
        return "zcash";
    }

    // Dogecoin
    if (chainLower === "dogecoin" || chainLower === "doge") {
        return "dogecoin";
    }

    // XRP/Ripple
    if (chainLower === "xrp" || chainLower === "ripple" || chainLower === "xrpledger") {
        return "xrp";
    }

    // Stellar
    if (chainLower === "stellar" || chainLower === "xlm") {
        return "stellar";
    }

    // Sui
    if (chainLower === "sui") {
        return "sui";
    }

    // Aptos
    if (chainLower === "aptos" || chainLower === "apt") {
        return "aptos";
    }

    // Cardano
    if (chainLower === "cardano" || chainLower === "ada") {
        return "cardano";
    }

    // Hyperliquid (treat as EVM-compatible for now, though it may need special handling)
    if (chainLower === "hyperliquid") {
        return "ethereum";
    }

    console.log(`⚠️  UNKNOWN BLOCKCHAIN: "${chainName}" - No validation available!`);
    return "unknown";
}

/**
 * Check if a token is on NEAR blockchain
 */
export function isNearToken(chainName?: string, residency?: string): boolean {
    if (!chainName) return true; // Default to NEAR if no chainName
    return getBlockchainType(chainName) === "near";
}

/**
 * Check if a token requires cross-chain address validation
 */
export function requiresCrossChainValidation(chainName?: string, residency?: string): boolean {
    if (!chainName) return false;
    const blockchainType = getBlockchainType(chainName);
    return blockchainType !== "near" && blockchainType !== "unknown";
}

