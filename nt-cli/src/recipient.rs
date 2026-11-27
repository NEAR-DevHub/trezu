//! Recipient address validation per destination network.
//!
//! Mirrors the Trezu web app so the CLI accepts and rejects the same
//! recipients:
//! - `nt-fe/lib/address-validation.ts` — per-chain address patterns,
//! - `nt-fe/lib/blockchain-utils.ts` (`getBlockchainType`) — network name to chain,
//! - `nt-fe/lib/near-address-format.ts` — NEAR account format,
//! - `nt-fe/lib/recipient-address-rules.ts` — the `nearcom:` prefix rule.
//!
//! These are format checks only, like the web app's payment form: whether a
//! NEAR account exists is left to 1Click, which rejects missing accounts when
//! quoting.

use std::sync::LazyLock;

use regex::Regex;

/// Prefix that names the near.com (NEAR Intents) route for a NEAR account.
pub const NEAR_COM_ADDRESS_PREFIX: &str = "nearcom:";

/// Address formats the web app knows how to validate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Blockchain {
    Near,
    Bitcoin,
    BitcoinCash,
    Litecoin,
    Dash,
    Ethereum,
    Starknet,
    Aleo,
    Solana,
    Tron,
    Ton,
    Zcash,
    Dogecoin,
    Xrp,
    Stellar,
    Sui,
    Aptos,
    Cardano,
    Pearl,
}

/// Where the payment is going, as far as the recipient format is concerned.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Destination {
    /// The recipient's near.com (NEAR Intents) balance: a NEAR account written
    /// with the `nearcom:` prefix (e.g. `nearcom:alice.near`).
    NearCom,
    /// A chain. `None` when the network maps to no known address format, in
    /// which case any non-empty address is accepted (as in the web app).
    Chain(Option<Blockchain>),
}

fn re(pattern: &str) -> Regex {
    Regex::new(pattern).expect("valid address pattern")
}

static BITCOIN: LazyLock<Regex> = LazyLock::new(|| {
    re(r"^([13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[ac-hj-np-z02-9]{39,59}|BC1[AC-HJ-NP-Z02-9]{39,59})$")
});
static BITCOIN_CASH: LazyLock<Regex> =
    LazyLock::new(|| re(r"^([13][a-km-zA-HJ-NP-Z1-9]{25,34}|(bitcoincash:)?[qp][a-z0-9]{41})$"));
static LITECOIN: LazyLock<Regex> =
    LazyLock::new(|| re(r"^([LM3][a-km-zA-HJ-NP-Z1-9]{26,33}|ltc1[ac-hj-np-z02-9]{39,59})$"));
static DASH: LazyLock<Regex> = LazyLock::new(|| re(r"^[X7][1-9A-HJ-NP-Za-km-z]{33}$"));
static ETHEREUM: LazyLock<Regex> = LazyLock::new(|| re(r"^0x[a-fA-F0-9]{40}$"));
// The web app uses a lookahead to exclude 40-hex (EVM) addresses; the regex
// crate has none, so that part is checked in `matches_format`.
static STARKNET: LazyLock<Regex> = LazyLock::new(|| re(r"^0x[a-fA-F0-9]{1,64}$"));
static ALEO: LazyLock<Regex> = LazyLock::new(|| re(r"^aleo1[a-z0-9]{58}$"));
static SOLANA: LazyLock<Regex> = LazyLock::new(|| re(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$"));
static TRON: LazyLock<Regex> = LazyLock::new(|| re(r"^T[1-9A-HJ-NP-Za-km-z]{33}$"));
static TON: LazyLock<Regex> =
    LazyLock::new(|| re(r"^([UE][Qq][a-zA-Z0-9_-]{46}|-?\d+:[0-9a-fA-F]{64})$"));
static ZCASH: LazyLock<Regex> = LazyLock::new(|| {
    re(
        r"(?i)^(t1|t3|tm1|tm3)[a-km-zA-HJ-NP-Z1-9]{33}$|^(tex1|textest1)[ac-hj-np-z02-9]{38}$|^u1[ac-hj-np-z02-9]{100,250}$",
    )
});
static DOGECOIN: LazyLock<Regex> = LazyLock::new(|| re(r"^[DA][a-km-zA-HJ-NP-Z1-9]{33}$"));
static XRP: LazyLock<Regex> = LazyLock::new(|| re(r"^r[1-9A-HJ-NP-Za-km-z]{25,34}$"));
static STELLAR: LazyLock<Regex> = LazyLock::new(|| re(r"^G[A-Z2-7]{55}$"));
static HEX_32_BYTES: LazyLock<Regex> = LazyLock::new(|| re(r"^0x[a-fA-F0-9]{64}$"));
static CARDANO: LazyLock<Regex> = LazyLock::new(|| re(r"(?i)^addr1[a-z0-9]{53,103}$"));
static PEARL: LazyLock<Regex> =
    LazyLock::new(|| re(r"^(prl1[pz][ac-hj-np-z02-9]{58}|PRL1[PZ][AC-HJ-NP-Z02-9]{58})$"));

static NEAR_IMPLICIT: LazyLock<Regex> = LazyLock::new(|| re(r"^[0-9a-fA-F]{64}$"));
static NEAR_ETH_IMPLICIT: LazyLock<Regex> = LazyLock::new(|| re(r"^0x[0-9a-fA-F]{40}$"));
static NEAR_DETERMINISTIC: LazyLock<Regex> = LazyLock::new(|| re(r"^0s[0-9a-fA-F]{40}$"));
static NEAR_NAMED_CHARS: LazyLock<Regex> = LazyLock::new(|| re(r"^[a-z0-9._-]+$"));

/// Top-level accounts the web app accepts for named NEAR recipients.
const NEAR_TLDS: [&str; 4] = [".near", ".aurora", ".tg", ".sweat"];

/// EVM networks, as compact keys (see `compact_chain_key`).
const EVM_CHAINS: &[&str] = &[
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
    "matic",
    "bsc",
    "bnb",
    "binance",
    "bnbsmartchain",
    "binancesmartchain",
    "optimism",
    "op",
    "avalanche",
    "avax",
    "aurora",
    "auroradevnet",
    "turbochain",
    "vertex",
    "easychain",
    "hako",
    "optima",
    "tuxappchain",
    "tuxachain",
    "layerx",
    "xlayer",
    "monad",
    "scroll",
    "plasma",
    "adi",
    "hyperliquid",
    "hypercore",
    "hood",
    "robinhood",
];

/// Lowercased, with spaces, underscores and hyphens removed, so catalog
/// display names ("BNB Smart Chain", "XRP Ledger") match their keys.
fn compact_chain_key(network: &str) -> String {
    network
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '_' && *c != '-')
        .flat_map(char::to_lowercase)
        .collect()
}

impl Blockchain {
    /// The address format for a network name (a chain key such as `eth` or a
    /// catalog name such as `bnb smart chain`). `None` for unknown networks.
    pub fn from_network(network: &str) -> Option<Self> {
        let compact = compact_chain_key(network);
        let chain = match compact.as_str() {
            "near" | "nearprotocol" => Self::Near,
            "bitcoin" | "btc" => Self::Bitcoin,
            "bitcoincash" | "bch" => Self::BitcoinCash,
            "litecoin" | "ltc" => Self::Litecoin,
            "dash" => Self::Dash,
            c if EVM_CHAINS.contains(&c) => Self::Ethereum,
            "solana" | "sol" => Self::Solana,
            "tron" | "trx" => Self::Tron,
            "zcash" | "zec" => Self::Zcash,
            "dogecoin" | "doge" => Self::Dogecoin,
            "xrp" | "ripple" | "xrpledger" => Self::Xrp,
            "stellar" | "xlm" => Self::Stellar,
            "sui" => Self::Sui,
            "aptos" | "apt" => Self::Aptos,
            "cardano" | "ada" => Self::Cardano,
            "ton" => Self::Ton,
            "starknet" => Self::Starknet,
            "aleo" => Self::Aleo,
            "prl" | "pearl" | "pearlnetwork" => Self::Pearl,
            _ => return None,
        };
        Some(chain)
    }

    pub fn display_name(self) -> &'static str {
        match self {
            Self::Near => "NEAR",
            Self::Bitcoin => "Bitcoin",
            Self::BitcoinCash => "Bitcoin Cash",
            Self::Litecoin => "Litecoin",
            Self::Dash => "Dash",
            Self::Ethereum => "Ethereum",
            Self::Starknet => "Starknet",
            Self::Aleo => "Aleo",
            Self::Solana => "Solana",
            Self::Tron => "Tron",
            Self::Ton => "TON",
            Self::Zcash => "Zcash",
            Self::Dogecoin => "Dogecoin",
            Self::Xrp => "XRP",
            Self::Stellar => "Stellar",
            Self::Sui => "Sui",
            Self::Aptos => "Aptos",
            Self::Cardano => "Cardano",
            Self::Pearl => "Pearl Network",
        }
    }

    /// Example of the expected format, for error messages.
    pub fn example(self) -> &'static str {
        match self {
            Self::Near => "alice.near, 0x..., or 64-char hex",
            Self::Bitcoin => "bc1...",
            Self::BitcoinCash => "1... or bitcoincash:q...",
            Self::Litecoin => "ltc1..., L... or M...",
            Self::Dash => "X...",
            Self::Ethereum | Self::Starknet | Self::Sui | Self::Aptos => "0x...",
            Self::Aleo => "aleo1...",
            Self::Solana => "7xKXtg...",
            Self::Tron => "T...",
            Self::Ton => "UQ..., EQ... or 0:...",
            Self::Zcash => "t1..., tex1..., or u1...",
            Self::Dogecoin => "D...",
            Self::Xrp => "r...",
            Self::Stellar => "G...",
            Self::Cardano => "addr1...",
            Self::Pearl => "prl1p... or prl1z...",
        }
    }

    /// Whether `address` (already trimmed) has this chain's format.
    fn matches_format(self, address: &str) -> bool {
        match self {
            Self::Near => validate_near_address_format(address).is_ok(),
            Self::Bitcoin => BITCOIN.is_match(address),
            Self::BitcoinCash => BITCOIN_CASH.is_match(address),
            Self::Litecoin => LITECOIN.is_match(address),
            Self::Dash => DASH.is_match(address),
            Self::Ethereum => ETHEREUM.is_match(address),
            // A 40-hex `0x` string is an EVM address. It fits a felt, but no
            // Starknet account lives there, so funds sent to it are lost.
            Self::Starknet => STARKNET.is_match(address) && !ETHEREUM.is_match(address),
            Self::Aleo => ALEO.is_match(address),
            Self::Solana => SOLANA.is_match(address),
            Self::Tron => TRON.is_match(address),
            Self::Ton => TON.is_match(address),
            Self::Zcash => ZCASH.is_match(address),
            Self::Dogecoin => DOGECOIN.is_match(address),
            Self::Xrp => XRP.is_match(address),
            Self::Stellar => STELLAR.is_match(address),
            Self::Sui | Self::Aptos => HEX_32_BYTES.is_match(address),
            Self::Cardano => CARDANO.is_match(address),
            Self::Pearl => PEARL.is_match(address),
        }
    }
}

fn is_implicit_or_deterministic_near_address(address: &str) -> bool {
    NEAR_IMPLICIT.is_match(address)
        || NEAR_ETH_IMPLICIT.is_match(address)
        || NEAR_DETERMINISTIC.is_match(address)
}

/// NEAR account format, as the web app checks it for recipients: implicit
/// (64 hex), eth-implicit (`0x` + 40 hex) and deterministic (`0s` + 40 hex)
/// accounts, or a named account under one of the supported top-level accounts.
pub fn validate_near_address_format(address: &str) -> Result<(), String> {
    let address = address.trim();
    if address.len() < 2 || address.len() > 64 {
        return Err("NEAR account IDs must be 2 to 64 characters long".to_string());
    }
    if is_implicit_or_deterministic_near_address(address) {
        return Ok(());
    }
    let missing_tld = || {
        format!(
            "NEAR account must end with {} (or be an implicit account: 64 hex characters or 0x + 40 hex)",
            NEAR_TLDS.join(", ")
        )
    };
    if !address.contains('.') {
        return Err(missing_tld());
    }
    if !NEAR_NAMED_CHARS.is_match(address) {
        return Err(
            "NEAR account IDs may only contain lowercase letters, digits, '.', '_' and '-'"
                .to_string(),
        );
    }
    if !NEAR_TLDS.iter().any(|tld| address.ends_with(tld)) {
        return Err(missing_tld());
    }
    Ok(())
}

/// Splits a leading `nearcom:` (any case) off the address.
fn strip_near_com_prefix(address: &str) -> Option<&str> {
    let head = address.get(..NEAR_COM_ADDRESS_PREFIX.len())?;
    head.eq_ignore_ascii_case(NEAR_COM_ADDRESS_PREFIX)
        .then(|| &address[NEAR_COM_ADDRESS_PREFIX.len()..])
}

/// Checks a recipient against its destination and returns the address to use:
/// trimmed, and without the `nearcom:` prefix.
///
/// The prefix names the near.com route, so it is required for a near.com
/// destination and rejected for every other one (as in the web app). Requiring
/// it keeps an address like `0x…` from being sent to near.com when the sender
/// meant a public chain, or the other way round.
pub fn validate_recipient(address: &str, destination: Destination) -> Result<String, String> {
    let trimmed = address.trim();
    if trimmed.is_empty() {
        return Err("Recipient address is required".to_string());
    }

    let stripped = strip_near_com_prefix(trimmed);
    match destination {
        Destination::NearCom => {
            let Some(account) = stripped else {
                return Err(format!(
                    "near.com recipients must start with '{NEAR_COM_ADDRESS_PREFIX}' \
                     (e.g. {NEAR_COM_ADDRESS_PREFIX}alice.near)"
                ));
            };
            let account = account.trim();
            validate_near_address_format(account)
                .map_err(|e| format!("Invalid near.com recipient '{account}': {e}"))?;
            Ok(account.to_string())
        }
        Destination::Chain(chain) => {
            if stripped.is_some() {
                return Err(format!(
                    "The '{NEAR_COM_ADDRESS_PREFIX}' prefix is only valid for the near.com destination"
                ));
            }
            let Some(chain) = chain else {
                // Unknown network: nothing to check against (same as the web app).
                return Ok(trimmed.to_string());
            };
            if chain == Blockchain::Near {
                validate_near_address_format(trimmed)
                    .map_err(|e| format!("Invalid NEAR recipient '{trimmed}': {e}"))?;
            } else if !chain.matches_format(trimmed) {
                return Err(format!(
                    "Invalid {} address '{trimmed}' (expected e.g. {})",
                    chain.display_name(),
                    chain.example()
                ));
            }
            Ok(trimmed.to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ETH: &str = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
    const HEX64: &str = "98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de";

    fn chain(network: &str) -> Destination {
        Destination::Chain(Blockchain::from_network(network))
    }

    #[test]
    fn network_names_map_like_the_web_app() {
        assert_eq!(Blockchain::from_network("eth"), Some(Blockchain::Ethereum));
        assert_eq!(
            Blockchain::from_network("BNB Smart Chain"),
            Some(Blockchain::Ethereum)
        );
        assert_eq!(
            Blockchain::from_network("xrp ledger"),
            Some(Blockchain::Xrp)
        );
        assert_eq!(
            Blockchain::from_network("Bitcoin Cash"),
            Some(Blockchain::BitcoinCash)
        );
        assert_eq!(Blockchain::from_network("near"), Some(Blockchain::Near));
        assert_eq!(
            Blockchain::from_network("pearl network"),
            Some(Blockchain::Pearl)
        );
        assert_eq!(Blockchain::from_network("near.com"), None);
        assert_eq!(Blockchain::from_network("quantus"), None);
    }

    #[test]
    fn near_account_format() {
        for ok in [
            "alice.near",
            "a-b_c.tg",
            "x.sweat",
            "bridge.aurora",
            HEX64,
            "0s0123456789abcdef0123456789abcdef01234567",
            ETH,
        ] {
            assert!(validate_near_address_format(ok).is_ok(), "{ok}");
        }
        let too_long = format!("{}.near", "a".repeat(60));
        for bad in [
            "a",
            "alice",
            "Alice.near",
            "alice.testnet",
            "alice@x.near",
            &too_long,
        ] {
            assert!(validate_near_address_format(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn chain_addresses_are_checked_against_the_destination() {
        assert_eq!(
            validate_recipient(&format!("  {ETH} "), chain("base")).unwrap(),
            ETH
        );
        assert!(validate_recipient("alice.near", chain("eth")).is_err());
        assert!(validate_recipient(ETH, chain("solana")).is_err());
        assert!(
            validate_recipient("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", chain("sol"))
                .is_ok()
        );
        assert!(
            validate_recipient("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", chain("btc")).is_ok()
        );
        assert!(validate_recipient("TJRabPrwbZy45sbavfcjinPJC18kjpRTv8", chain("tron")).is_ok());
        assert!(validate_recipient("alice.near", chain("near")).is_ok());
        assert!(validate_recipient("alice", chain("near")).is_err());
    }

    #[test]
    fn starknet_rejects_evm_length_addresses() {
        assert!(validate_recipient(ETH, chain("starknet")).is_err());
        assert!(validate_recipient(&format!("0x{HEX64}"), chain("starknet")).is_ok());
        assert!(validate_recipient("0x1", chain("starknet")).is_ok());
        assert!(validate_recipient("0x1", chain("aptos")).is_err());
    }

    #[test]
    fn unknown_networks_accept_any_address() {
        assert_eq!(
            validate_recipient(" anything ", chain("quantus")).unwrap(),
            "anything"
        );
        assert!(validate_recipient("  ", chain("quantus")).is_err());
    }

    #[test]
    fn nearcom_prefix_is_required_for_near_com_only() {
        assert_eq!(
            validate_recipient("NearCom:alice.near", Destination::NearCom).unwrap(),
            "alice.near"
        );
        assert_eq!(
            validate_recipient(&format!("nearcom:{ETH}"), Destination::NearCom).unwrap(),
            ETH
        );
        // Without the prefix a near.com recipient is rejected, so a public-chain
        // address can't end up on near.com by accident.
        assert!(validate_recipient("alice.near", Destination::NearCom).is_err());
        assert!(validate_recipient(ETH, Destination::NearCom).is_err());
        assert!(validate_recipient("nearcom:alice", Destination::NearCom).is_err());
        assert!(
            validate_recipient(
                "nearcom:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
                Destination::NearCom
            )
            .is_err()
        );
        assert!(validate_recipient(&format!("nearcom:{ETH}"), chain("eth")).is_err());
        assert!(validate_recipient("nearcom:alice.near", chain("near")).is_err());
    }
}
