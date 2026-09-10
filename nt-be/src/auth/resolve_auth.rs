//! NEP-641 caller-side authorization resolver.
//!
//! Thin wrapper around [`defuse_nep641::resolver::RpcResolver`] (the NEP-641
//! reference implementation from the `near/intents` monorepo), which walks the
//! `w_resolve_auth` authorization graph against a single pinned final block and
//! verifies [`AccessKeyAuthorization`](defuse_nep641::access_keys::AccessKeyAuthorization)
//! blobs (NEP-413 signed `OffchainMessage`s) against full-access keys for
//! accounts without a resolver contract.
//!
//! What this module adds on top of the crate:
//!
//! * building a `near-kit` RPC client from the app's `near-api` network config
//!   (same endpoint + auth headers),
//! * the resource limits we accept for a login,
//! * a bounded retry when the account does not exist *yet* — deterministic
//!   wallet-contract accounts are state-inited by a relayer right before login,
//!   and the view call can race ahead of chain indexing.

use defuse_nep641::resolver::{ContractError, ResolveError, ResolveErrorKind, RpcResolver};
use near_api::NetworkConfig;
use near_kit::{AccountId, Finality, Near, RpcClient, RpcError};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

/// Maximum total number of sub-authorizations across the whole graph for a
/// single login (multisig members, wallet extensions, ...).
const MAX_SUB_AUTHORIZATIONS: usize = 8;
/// Maximum depth of sub-authorization branches. A malicious cyclic graph
/// terminates here rather than looping forever.
const MAX_DEPTH: usize = 8;

/// Account-not-found can transiently appear right after a relayer creates a
/// deterministic wallet-contract account (the FE's EIP-712 / passkey
/// `resolveAuth` state-inits the account on-chain): the view call may race
/// ahead of chain indexing. Retry with exponential backoff so the caller
/// doesn't see a false negative.
const ACCOUNT_NOT_FOUND_RETRY_DELAYS_MS: [u64; 5] = [1000, 2000, 4000, 8000, 16000];

/// Verify a NEP-641 authorization for `account_id` and return the resolved
/// payload on success.
///
/// The caller is responsible for checking the payload against what it issued
/// (NEP-641 §"Caller-side resolution algorithm", last paragraph).
pub async fn verify_resolve_auth(
    network: &NetworkConfig,
    account_id: &str,
    authorization: &str,
) -> Result<String, String> {
    let account_id: AccountId = account_id
        .parse()
        .map_err(|e| format!("invalid account id \"{account_id}\": {e}"))?;

    let rpc = create_rpc_client(network)?;
    let resolver = RpcResolver::new(rpc.clone())
        .await
        .map_err(|e| format!("failed to initialize NEP-641 resolver: {e}"))?
        .with_max_sub_authorizations(MAX_SUB_AUTHORIZATIONS)
        .with_max_depth(MAX_DEPTH);

    // Initial attempt + retries with backoff when the account doesn't exist yet.
    // Every attempt re-pins the final block (the resolver's default), so the
    // retry sees the latest chain state once the account materializes.
    let mut attempt = 0;
    loop {
        let err = match resolver
            .resolve_auth(account_id.clone(), authorization)
            .await
        {
            Ok(payload) => return Ok(payload),
            Err(err) => err,
        };

        let retriable = attempt < ACCOUNT_NOT_FOUND_RETRY_DELAYS_MS.len()
            && is_no_resolver(&err)
            && !account_exists(&rpc, &account_id).await;
        if !retriable {
            return Err(err.to_string());
        }

        tracing::debug!(
            %account_id,
            attempt,
            error = %err,
            "NEP-641: account does not exist yet, retrying resolution"
        );
        tokio::time::sleep(std::time::Duration::from_millis(
            ACCOUNT_NOT_FOUND_RETRY_DELAYS_MS[attempt],
        ))
        .await;
        attempt += 1;
    }
}

/// Chain ID reported by the RPC endpoint (e.g. `mainnet`, `testnet`, or a
/// sandbox-specific value). Clients bind it into the signed `OffchainMessage`,
/// so it is advertised alongside the login challenge.
///
/// Cached per RPC URL for the lifetime of the process: the chain behind an
/// endpoint never changes, and the login challenge must not pay for an RPC
/// round-trip every time.
pub async fn fetch_chain_id(network: &NetworkConfig) -> Result<String, String> {
    static CHAIN_IDS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    let cache = CHAIN_IDS.get_or_init(Default::default);

    let rpc = create_rpc_client(network)?;
    if let Some(chain_id) = cache.lock().unwrap().get(rpc.url()) {
        return Ok(chain_id.clone());
    }

    let status = rpc
        .status()
        .await
        .map_err(|e| format!("failed to fetch RPC status: {e}"))?;
    cache
        .lock()
        .unwrap()
        .insert(rpc.url().to_string(), status.chain_id.clone());
    Ok(status.chain_id)
}

/// Build a `near-kit` RPC client for the primary endpoint of `network`,
/// forwarding the same bearer / API-key headers `near-api` would send.
fn create_rpc_client(network: &NetworkConfig) -> Result<RpcClient, String> {
    let endpoint = network
        .rpc_endpoints
        .first()
        .ok_or_else(|| "No RPC endpoint configured".to_string())?;

    let mut http = reqwest13::Client::builder();
    if let Some(bearer) = &endpoint.bearer_header {
        let mut header = reqwest13::header::HeaderValue::from_str(bearer)
            .map_err(|e| format!("invalid RPC auth header: {e}"))?;
        header.set_sensitive(true);
        let mut headers = reqwest13::header::HeaderMap::new();
        headers.insert(reqwest13::header::AUTHORIZATION, header.clone());
        headers.insert("x-api-key", header);
        http = http.default_headers(headers);
    }
    let http = http
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;

    let near = Near::custom(
        endpoint.url.as_str().trim_end_matches('/'),
        network.network_name.as_str(),
    )
    .http_client(http)
    .build();
    Ok(near.rpc().clone())
}

/// The top-level account has neither a full-access-key authorization the
/// resolver could verify nor a `w_resolve_auth` contract. This is the only
/// failure mode that can be caused by the account not existing yet.
fn is_no_resolver(err: &ResolveError) -> bool {
    err.rev_path.is_empty()
        && matches!(
            err.kind,
            ResolveErrorKind::Contract(ContractError::NoResolve)
        )
}

async fn account_exists(rpc: &RpcClient, account_id: &AccountId) -> bool {
    match rpc.view_account(account_id, Finality::Final.into()).await {
        Ok(_) => true,
        Err(RpcError::AccountNotFound(_)) => false,
        // Be conservative on unrelated RPC failures: don't spend the retry
        // budget, surface the original resolution error instead.
        Err(_) => true,
    }
}

#[cfg(test)]
mod tests {
    use defuse_nep641::access_keys::{AccessKeyAuthorization, AccessKeySchema};

    /// Deterministic blob produced by `nt-cli` (see
    /// `nt-cli/src/auth/mod.rs` `access_key_authorization_fixture`). Keep both
    /// fixtures in sync: this proves the CLI's hand-rolled envelope hashing and
    /// NEP-413 mapping match the NEP-641 reference implementation.
    const CLI_FIXTURE_AUTHORIZATION: &str = r#"{"access_key":"ed25519:5BGSaf6YjVm7565VzWQHNxoyEjwr3jUpRJSGjREvU9dB","msg":{"chain_id":"mainnet","payload":"Login to Trezu initiated at 2026-08-05T07:29:00Z with request ID: fixture","signer_id":"alice.near","timestamp":"2026-08-05T07:28:00Z"},"signature":"ed25519:3V9pmw68DqdLJeDnG18eQFMFvFGT6NGwjZ1zkPSjLtSvRFgBVvhVo71xvtSUKvWU7P81jNFeuatWBVc5Detii1Dz","via":{"extra":{},"schema":"nep413"}}"#;

    #[test]
    fn cli_access_key_authorization_matches_reference_impl() {
        let auth: AccessKeyAuthorization =
            serde_json::from_str(CLI_FIXTURE_AUTHORIZATION).expect("blob must parse");

        assert_eq!(auth.msg.chain_id, "mainnet");
        assert_eq!(auth.msg.signer_id, "alice.near");
        assert!(auth.msg.is_top_level());
        assert_eq!(auth.msg.timestamp.to_string(), "2026-08-05T07:28:00Z");
        assert_eq!(
            auth.msg.payload,
            "Login to Trezu initiated at 2026-08-05T07:29:00Z with request ID: fixture"
        );
        assert!(matches!(
            auth.via,
            AccessKeySchema::Nep413 { callback_url: None }
        ));
        assert_eq!(
            auth.access_key.to_string(),
            "ed25519:5BGSaf6YjVm7565VzWQHNxoyEjwr3jUpRJSGjREvU9dB"
        );

        assert!(
            auth.verify(),
            "NEP-413 signature over the envelope must verify"
        );

        // Tamper: any envelope field change must invalidate the signature.
        let mut tampered = auth.clone();
        tampered.msg.chain_id = "testnet".to_string();
        assert!(!tampered.verify());
    }

    #[test]
    fn access_key_schema_requires_extra() {
        // The reference impl's adjacently-tagged `via` needs `extra` even when
        // there is no callback URL. Clients (nt-cli, near-connect, e2e helpers)
        // must always emit `"extra": {}`.
        let blob = CLI_FIXTURE_AUTHORIZATION.replace(r#""extra":{},"#, "");
        assert!(serde_json::from_str::<AccessKeyAuthorization>(&blob).is_err());
    }

    /// Live mainnet check of the full resolver path (RPC status, block pinning,
    /// concurrent access-key + `w_resolve_auth` attempts) with a fresh key and
    /// its implicit account.
    ///
    /// NEP-641 §"Verification procedure" step 6 would accept a not-yet-created
    /// implicit account derived from the key, but the `query` RPC reports a
    /// missing account as "access key ... does not exist" (indistinguishable
    /// from a removed key), so the reference resolver rejects it — exactly as
    /// the previous hand-rolled resolver did. This pins that behavior and the
    /// signer-mismatch rejection.
    ///
    /// Run with `cargo test --lib resolve_auth -- --ignored`.
    #[tokio::test]
    #[ignore = "hits a public mainnet RPC"]
    async fn live_implicit_account_access_key_authorization() {
        use defuse_nep641::access_keys::{AccessKeyAuthorization, PublicKey, Signature};
        use defuse_nep641::{OffchainMessage, Timestamp};
        use near_api::{NetworkConfig, RPCEndpoint};

        let network = NetworkConfig {
            rpc_endpoints: vec![RPCEndpoint::new(
                "https://free.rpc.fastnear.com".parse().unwrap(),
            )],
            ..NetworkConfig::mainnet()
        };
        let chain_id = super::fetch_chain_id(&network).await.unwrap();
        assert_eq!(chain_id, "mainnet");

        let secret_key = near_crypto::SecretKey::from_random(near_crypto::KeyType::ED25519);
        let access_key: PublicKey = secret_key.public_key().to_string().parse().unwrap();
        let account_id = access_key.to_implicit_account_id();

        let msg = OffchainMessage {
            chain_id,
            signer_id: account_id.clone(),
            path: vec![],
            timestamp: Timestamp::now() - std::time::Duration::from_secs(60),
            payload: "Login to Trezu (live resolver test)".to_string(),
        };
        let nep413 = msg.clone().into_nep413_payload(None);
        let hash = near_api::signer::NEP413Payload {
            message: nep413.message,
            nonce: nep413.nonce,
            recipient: nep413.recipient,
            callback_url: nep413.callback_url,
        }
        .compute_hash()
        .unwrap();
        let signature: Signature = secret_key
            .sign(hash.0.as_ref())
            .to_string()
            .parse()
            .unwrap();

        let authorization: String = AccessKeyAuthorization {
            msg: msg.clone(),
            via: defuse_nep641::access_keys::AccessKeySchema::Nep413 { callback_url: None },
            access_key,
            signature,
        }
        .into();

        let err = super::verify_resolve_auth(&network, account_id.as_str(), &authorization)
            .await
            .expect_err("account does not exist on-chain");
        assert!(
            err.contains("access key without FullAccess permission"),
            "{err}"
        );

        // Same blob presented for another account: signer_id mismatch.
        let err = super::verify_resolve_auth(&network, "near", &authorization)
            .await
            .expect_err("foreign account must be rejected");
        assert!(err.contains("invalid signer_id"), "{err}");
    }
}
