import type { NearNetwork, OmniFamily } from "./types";

/**
 * Destination-chain registry, mirroring the default `omni-config.toml` in
 * omni-cli-rs (src/config.rs). A chain is logical: NEAR mainnet maps to the
 * chain's mainnet, NEAR testnet to its testnet.
 */

export interface ChainVariant {
    /** Chain id embedded in the unsigned tx (EVM chain_id, Aptos chain_id);
     * absent for families without one. */
    chainId?: number;
    /** Public JSON-RPC endpoint (EVM only is used in the browser today). */
    rpcUrl: string;
    /** Explorer origin, e.g. https://arbiscan.io */
    explorerOrigin: string;
    /** Path template for an address page; `{address}` is substituted. */
    explorerAddressPath: string;
    /** Path template for a tx page; `{hash}` is substituted. */
    explorerTxPath: string;
    /** Human network name, e.g. "Arbitrum One". */
    displayName: string;
}

export interface ChainDefinition {
    key: string;
    family: OmniFamily;
    /** Native asset symbol, e.g. ETH. */
    symbol: string;
    decimals: number;
    networks: Record<NearNetwork, ChainVariant>;
}

const evm = (
    displayName: string,
    chainId: number,
    rpcUrl: string,
    explorerOrigin: string,
): ChainVariant => ({
    chainId,
    rpcUrl,
    explorerOrigin,
    explorerAddressPath: "/address/{address}",
    explorerTxPath: "/tx/{hash}",
    displayName,
});

export const OMNI_CHAINS: Record<string, ChainDefinition> = {
    eth: {
        key: "eth",
        family: "evm",
        symbol: "ETH",
        decimals: 18,
        networks: {
            mainnet: evm(
                "Ethereum",
                1,
                "https://ethereum-rpc.publicnode.com",
                "https://etherscan.io",
            ),
            testnet: evm(
                "Ethereum Sepolia",
                11155111,
                "https://ethereum-sepolia-rpc.publicnode.com",
                "https://sepolia.etherscan.io",
            ),
        },
    },
    base: {
        key: "base",
        family: "evm",
        symbol: "ETH",
        decimals: 18,
        networks: {
            mainnet: evm(
                "Base",
                8453,
                "https://base-rpc.publicnode.com",
                "https://basescan.org",
            ),
            testnet: evm(
                "Base Sepolia",
                84532,
                "https://base-sepolia-rpc.publicnode.com",
                "https://sepolia.basescan.org",
            ),
        },
    },
    arb: {
        key: "arb",
        family: "evm",
        symbol: "ETH",
        decimals: 18,
        networks: {
            mainnet: evm(
                "Arbitrum One",
                42161,
                "https://arbitrum-one-rpc.publicnode.com",
                "https://arbiscan.io",
            ),
            testnet: evm(
                "Arbitrum Sepolia",
                421614,
                "https://arbitrum-sepolia-rpc.publicnode.com",
                "https://sepolia.arbiscan.io",
            ),
        },
    },
    bnb: {
        key: "bnb",
        family: "evm",
        symbol: "BNB",
        decimals: 18,
        networks: {
            mainnet: evm(
                "BNB Smart Chain",
                56,
                "https://bsc-rpc.publicnode.com",
                "https://bscscan.com",
            ),
            testnet: evm(
                "BNB Smart Chain Testnet",
                97,
                "https://bsc-testnet-rpc.publicnode.com",
                "https://testnet.bscscan.com",
            ),
        },
    },
    pol: {
        key: "pol",
        family: "evm",
        symbol: "POL",
        decimals: 18,
        networks: {
            mainnet: evm(
                "Polygon",
                137,
                "https://polygon-bor-rpc.publicnode.com",
                "https://polygonscan.com",
            ),
            testnet: evm(
                "Polygon Amoy",
                80002,
                "https://polygon-amoy-bor-rpc.publicnode.com",
                "https://amoy.polygonscan.com",
            ),
        },
    },
    hyperevm: {
        key: "hyperevm",
        family: "evm",
        symbol: "HYPE",
        decimals: 18,
        networks: {
            mainnet: evm(
                "HyperEVM",
                999,
                "https://rpc.hyperliquid.xyz/evm",
                "https://hyperevmscan.io",
            ),
            testnet: evm(
                "HyperEVM Testnet",
                998,
                "https://rpc.hyperliquid-testnet.xyz/evm",
                "https://testnet.purrsec.com",
            ),
        },
    },
    abs: {
        key: "abs",
        family: "evm",
        symbol: "ETH",
        decimals: 18,
        networks: {
            mainnet: evm(
                "Abstract",
                2741,
                "https://api.mainnet.abs.xyz",
                "https://abscan.org",
            ),
            testnet: evm(
                "Abstract Sepolia",
                11124,
                "https://api.testnet.abs.xyz",
                "https://sepolia.abscan.org",
            ),
        },
    },
    btc: {
        key: "btc",
        family: "utxo",
        symbol: "BTC",
        decimals: 8,
        networks: {
            mainnet: {
                rpcUrl: "https://blockstream.info/api",
                explorerOrigin: "https://mempool.space",
                explorerAddressPath: "/address/{address}",
                explorerTxPath: "/tx/{hash}",
                displayName: "Bitcoin",
            },
            testnet: {
                rpcUrl: "https://blockstream.info/testnet/api",
                explorerOrigin: "https://mempool.space",
                explorerAddressPath: "/testnet/address/{address}",
                explorerTxPath: "/testnet/tx/{hash}",
                displayName: "Bitcoin Testnet",
            },
        },
    },
    ton: {
        key: "ton",
        family: "ton",
        symbol: "TON",
        decimals: 9,
        networks: {
            mainnet: {
                rpcUrl: "https://toncenter.com/api/v2",
                explorerOrigin: "https://tonviewer.com",
                explorerAddressPath: "/{address}",
                explorerTxPath: "/transaction/{hash}",
                displayName: "TON",
            },
            testnet: {
                rpcUrl: "https://testnet.toncenter.com/api/v2",
                explorerOrigin: "https://testnet.tonviewer.com",
                explorerAddressPath: "/{address}",
                explorerTxPath: "/transaction/{hash}",
                displayName: "TON Testnet",
            },
        },
    },
    solana: {
        key: "solana",
        family: "svm",
        symbol: "SOL",
        decimals: 9,
        networks: {
            mainnet: {
                rpcUrl: "https://solana-rpc.publicnode.com",
                explorerOrigin: "https://solscan.io",
                explorerAddressPath: "/account/{address}",
                explorerTxPath: "/tx/{hash}",
                displayName: "Solana",
            },
            testnet: {
                rpcUrl: "https://api.devnet.solana.com",
                explorerOrigin: "https://solscan.io",
                explorerAddressPath: "/account/{address}?cluster=devnet",
                explorerTxPath: "/tx/{hash}?cluster=devnet",
                displayName: "Solana Devnet",
            },
        },
    },
    fogo: {
        key: "fogo",
        family: "svm",
        symbol: "FOGO",
        decimals: 9,
        networks: {
            mainnet: {
                rpcUrl: "https://mainnet.fogo.io",
                explorerOrigin: "https://fogoscan.com",
                explorerAddressPath: "/account/{address}",
                explorerTxPath: "/tx/{hash}",
                displayName: "Fogo",
            },
            testnet: {
                rpcUrl: "https://testnet.fogo.io",
                explorerOrigin: "https://fogoscan.com",
                explorerAddressPath: "/account/{address}?cluster=testnet",
                explorerTxPath: "/tx/{hash}?cluster=testnet",
                displayName: "Fogo Testnet",
            },
        },
    },
    aptos: {
        key: "aptos",
        family: "aptos",
        symbol: "APT",
        decimals: 8,
        networks: {
            mainnet: {
                chainId: 1,
                rpcUrl: "https://fullnode.mainnet.aptoslabs.com",
                explorerOrigin: "https://explorer.aptoslabs.com",
                explorerAddressPath: "/account/{address}?network=mainnet",
                explorerTxPath: "/txn/{hash}?network=mainnet",
                displayName: "Aptos",
            },
            testnet: {
                chainId: 2,
                rpcUrl: "https://fullnode.testnet.aptoslabs.com",
                explorerOrigin: "https://explorer.aptoslabs.com",
                explorerAddressPath: "/account/{address}?network=testnet",
                explorerTxPath: "/txn/{hash}?network=testnet",
                displayName: "Aptos Testnet",
            },
        },
    },
    sui: {
        key: "sui",
        family: "sui",
        symbol: "SUI",
        decimals: 9,
        networks: {
            mainnet: {
                rpcUrl: "https://sui-rpc.publicnode.com",
                explorerOrigin: "https://suiscan.xyz",
                explorerAddressPath: "/mainnet/account/{address}",
                explorerTxPath: "/mainnet/tx/{hash}",
                displayName: "Sui",
            },
            testnet: {
                rpcUrl: "https://sui-testnet-rpc.publicnode.com",
                explorerOrigin: "https://suiscan.xyz",
                explorerAddressPath: "/testnet/account/{address}",
                explorerTxPath: "/testnet/tx/{hash}",
                displayName: "Sui Testnet",
            },
        },
    },
};

export interface ResolvedChain extends ChainVariant {
    key: string;
    family: OmniFamily;
    symbol: string;
    decimals: number;
    network: NearNetwork;
}

/** Resolve a registry key for a NEAR network; null for unknown keys. */
export function resolveChain(
    chainKey: string,
    network: NearNetwork,
): ResolvedChain | null {
    const definition = OMNI_CHAINS[chainKey];
    if (!definition) return null;
    const variant = definition.networks[network];
    return {
        ...variant,
        key: definition.key,
        family: definition.family,
        symbol: definition.symbol,
        decimals: definition.decimals,
        network,
    };
}

export function explorerAddressUrl(
    chain: ResolvedChain,
    address: string,
): string {
    return (
        chain.explorerOrigin +
        chain.explorerAddressPath.replace(
            "{address}",
            encodeURIComponent(address),
        )
    );
}

export function explorerTxUrl(chain: ResolvedChain, hash: string): string {
    return (
        chain.explorerOrigin +
        chain.explorerTxPath.replace("{hash}", encodeURIComponent(hash))
    );
}
