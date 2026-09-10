use crate::api::ApiClient;
use crate::config::TrezuContext;
use crate::types::LoginRequest;
use colored::Colorize;

use borsh::BorshSerialize;
use near_cli_rs::commands::message::sign_nep413::{
    FinalSignNep413Context, NEP413Payload, SignedMessage,
};
use sha3::{Digest, Sha3_256};
use strum::{EnumDiscriminants, EnumIter, EnumMessage};

/// Clients SHOULD set the NEP-641 `timestamp` slightly before the actual
/// signing time to absorb clock skew and block-time lag.
const OFFCHAIN_MESSAGE_TIMESTAMP_SKEW: chrono::Duration = chrono::Duration::seconds(60);

/// NEP-641 `OffchainMessage`: the standardized signable envelope. Binds the
/// payload to the chain, the signer account, the resolution path (empty for a
/// top-level authorization) and the signing time.
///
/// Field order and encodings mirror the reference implementation
/// (`defuse-nep641`): Borsh strings, `Vec<AccountId>` as a vector of strings,
/// timestamp as `u64` nanoseconds.
#[derive(Debug, Clone, BorshSerialize)]
struct OffchainMessage {
    chain_id: String,
    signer_id: String,
    path: Vec<String>,
    timestamp_nanos: u64,
    payload: String,
}

impl OffchainMessage {
    const DOMAIN_SEPARATOR: &[u8] = b"NEAR_NEP641_OFFCHAIN_MESSAGE/V1";

    /// Top-level authorization envelope timestamped "now minus skew".
    fn new(chain_id: String, signer_id: String, payload: String) -> Self {
        Self::at(
            chain_id,
            signer_id,
            payload,
            chrono::Utc::now() - OFFCHAIN_MESSAGE_TIMESTAMP_SKEW,
        )
    }

    fn at(
        chain_id: String,
        signer_id: String,
        payload: String,
        timestamp: chrono::DateTime<chrono::Utc>,
    ) -> Self {
        // Whole seconds: keeps the RFC-3339 rendering and the Borsh nanoseconds
        // trivially consistent.
        let seconds = timestamp.timestamp().max(0) as u64;
        Self {
            chain_id,
            signer_id,
            path: Vec::new(),
            timestamp_nanos: seconds * 1_000_000_000,
            payload,
        }
    }

    /// RFC-3339 timestamp, whole seconds (`2026-08-05T07:28:00Z`).
    fn timestamp_rfc3339(&self) -> String {
        chrono::DateTime::<chrono::Utc>::from_timestamp_nanos(self.timestamp_nanos as i64)
            .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
    }

    /// Canonical hash: `SHA3-256(b"NEAR_NEP641_OFFCHAIN_MESSAGE/V1" || borsh(msg))`.
    fn hash(&self) -> color_eyre::eyre::Result<[u8; 32]> {
        let mut hasher = Sha3_256::new_with_prefix(Self::DOMAIN_SEPARATOR);
        borsh::to_writer(&mut hasher, self)?;
        Ok(hasher.finalize().into())
    }

    /// NEP-641 §"NEP-413 mapping": `message` = payload, `nonce` = canonical
    /// hash (binds every envelope field), `recipient` renders the bindings for
    /// the user: `"<chain_id>: <signer_id>[ -> <path>]... @ <timestamp>"`.
    fn to_nep413_payload(&self) -> color_eyre::eyre::Result<NEP413Payload> {
        let recipient = format!(
            "{}: {} @ {}",
            self.chain_id,
            std::iter::once(self.signer_id.as_str())
                .chain(self.path.iter().map(String::as_str))
                .collect::<Vec<_>>()
                .join(" -> "),
            self.timestamp_rfc3339(),
        );
        Ok(NEP413Payload {
            message: self.payload.clone(),
            nonce: self.hash()?,
            recipient,
            callback_url: None,
        })
    }

    /// JSON wire form (RFC-3339 timestamp; `path` omitted when empty).
    fn to_json(&self) -> serde_json::Value {
        let mut msg = serde_json::json!({
            "chain_id": self.chain_id,
            "signer_id": self.signer_id,
            "timestamp": self.timestamp_rfc3339(),
            "payload": self.payload,
        });
        if !self.path.is_empty() {
            msg["path"] = serde_json::json!(self.path);
        }
        msg
    }

    /// NEP-641 `AccessKeyAuthorization` blob: this envelope, NEP-413-signed by
    /// `access_key` (a full-access key on `signer_id`).
    fn access_key_authorization(&self, access_key: &str, signature: &str) -> String {
        serde_json::json!({
            "msg": self.to_json(),
            "via": { "schema": "nep413", "extra": {} },
            "access_key": access_key,
            "signature": signature,
        })
        .to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Deterministic `AccessKeyAuthorization` blob, cross-checked by
    /// `nt-be/src/auth/resolve_auth.rs` tests against the `defuse-nep641`
    /// reference implementation (parse + signature verification). Keep both
    /// fixtures in sync.
    const FIXTURE_SECRET_KEY: &str = "ed25519:3tgdk2wPraJzT4nsTuf86UX41xgPNk3MHnq8epARMdBNs29AFEztAuaQ7iHddDfXG9F2RzV1XNQYgJyAyoW51UBB";
    const FIXTURE_AUTHORIZATION: &str = r#"{"access_key":"ed25519:5BGSaf6YjVm7565VzWQHNxoyEjwr3jUpRJSGjREvU9dB","msg":{"chain_id":"mainnet","payload":"Login to Trezu initiated at 2026-08-05T07:29:00Z with request ID: fixture","signer_id":"alice.near","timestamp":"2026-08-05T07:28:00Z"},"signature":"ed25519:3V9pmw68DqdLJeDnG18eQFMFvFGT6NGwjZ1zkPSjLtSvRFgBVvhVo71xvtSUKvWU7P81jNFeuatWBVc5Detii1Dz","via":{"extra":{},"schema":"nep413"}}"#;

    #[test]
    fn access_key_authorization_fixture() {
        let secret_key: near_crypto::SecretKey = FIXTURE_SECRET_KEY.parse().unwrap();
        let message = OffchainMessage::at(
            "mainnet".to_string(),
            "alice.near".to_string(),
            "Login to Trezu initiated at 2026-08-05T07:29:00Z with request ID: fixture".to_string(),
            "2026-08-05T07:28:00Z".parse().unwrap(),
        );

        let payload = message.to_nep413_payload().unwrap();
        assert_eq!(
            payload.recipient,
            "mainnet: alice.near @ 2026-08-05T07:28:00Z"
        );

        let signature =
            near_cli_rs::commands::message::sign_nep413::sign_nep413_payload(&payload, &secret_key)
                .unwrap();
        let authorization = message
            .access_key_authorization(&secret_key.public_key().to_string(), &signature.to_string());

        assert_eq!(authorization, FIXTURE_AUTHORIZATION);
    }
}

#[derive(Debug, Clone, interactive_clap::InteractiveClap)]
#[interactive_clap(context = TrezuContext)]
pub struct Auth {
    #[interactive_clap(subcommand)]
    command: AuthCommand,
}

#[derive(Debug, EnumDiscriminants, Clone, interactive_clap::InteractiveClap)]
#[interactive_clap(context = TrezuContext)]
#[strum_discriminants(derive(EnumMessage, EnumIter))]
/// Select auth action
pub enum AuthCommand {
    #[strum_discriminants(strum(message = "login    -   Log in with your NEAR account"))]
    /// Log in with your NEAR account
    Login(Login),
    #[strum_discriminants(strum(message = "logout   -   Log out and clear stored credentials"))]
    /// Log out and clear stored credentials
    Logout(Logout),
    #[strum_discriminants(strum(message = "whoami   -   Show current authenticated user"))]
    /// Show current authenticated user
    Whoami(Whoami),
}

// --- Login ---

#[derive(Debug, Clone, interactive_clap::InteractiveClap)]
#[interactive_clap(input_context = TrezuContext)]
#[interactive_clap(output_context = LoginContext)]
pub struct Login {
    #[interactive_clap(skip_default_input_arg)]
    /// NEAR account ID (e.g. myaccount.near)
    account_id: String,
    #[interactive_clap(subcommand)]
    sign_with: near_cli_rs::commands::message::sign_nep413::signature_options::SignWith,
}

impl Login {
    fn input_account_id(context: &TrezuContext) -> color_eyre::eyre::Result<Option<String>> {
        near_cli_rs::common::input_signer_account_id_from_used_account_list(
            &context.global_context.config.credentials_home_dir,
            "Enter your NEAR account ID (e.g. myaccount.near):",
        )
        .map(|opt| opt.map(|id| id.to_string()))
    }
}

#[derive(Clone)]
pub struct LoginContext(FinalSignNep413Context);

impl std::fmt::Debug for LoginContext {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LoginContext").finish()
    }
}

impl LoginContext {
    #[tracing::instrument(name = "Preparing login challenge ...", skip_all)]
    pub fn from_previous_context(
        previous_context: TrezuContext,
        scope: &<Login as interactive_clap::ToInteractiveClapContextScope>::InteractiveClapContextScope,
    ) -> color_eyre::eyre::Result<Self> {
        let account_id = &scope.account_id;
        tracing::info!("Authenticating as {}...", account_id.cyan());

        let signer_id: near_primitives::types::AccountId = account_id
            .parse()
            .map_err(|e| color_eyre::eyre::eyre!("Invalid account ID: {}", e))?;

        let api = ApiClient::new(&previous_context.config);
        let challenge = api.get_challenge()?;

        // NEP-641 access-key authorization: sign the `OffchainMessage` envelope
        // (chain, signer, empty path, timestamp, challenge payload) via NEP-413
        // with a full-access key. Replay protection comes from the backend
        // consuming the unique challenge payload.
        let message = OffchainMessage::new(
            challenge.chain_id.clone(),
            signer_id.to_string(),
            challenge.payload.clone(),
        );
        let payload = message.to_nep413_payload()?;

        let trezu_config = previous_context.config.clone();
        let login_account_id = account_id.clone();

        let on_after_signing_callback: near_cli_rs::commands::message::sign_nep413::OnAfterSigningNep413Callback =
            std::sync::Arc::new(move |signed_message: SignedMessage| {
                complete_login(
                    &trezu_config,
                    &login_account_id,
                    &message,
                    &signed_message.public_key,
                    &signed_message.signature,
                )
            });

        Ok(Self(FinalSignNep413Context {
            global_context: previous_context.global_context,
            payload,
            signer_id,
            on_after_signing_callback,
        }))
    }
}

impl From<LoginContext> for FinalSignNep413Context {
    fn from(item: LoginContext) -> Self {
        item.0
    }
}

#[tracing::instrument(name = "Completing login ...", skip_all)]
fn complete_login(
    config: &crate::config::TrezuConfig,
    account_id: &str,
    message: &OffchainMessage,
    public_key: &str,
    signature: &str,
) -> color_eyre::eyre::Result<()> {
    if !(signature.starts_with("ed25519:") || signature.starts_with("secp256k1:")) {
        return Err(color_eyre::eyre::eyre!(
            "Unsupported signature scheme: {signature}"
        ));
    }

    let api = ApiClient::new(config);

    // NEP-641 `AccessKeyAuthorization` blob: the backend verifies the NEP-413
    // signature over the envelope and checks the key has FullAccess on the
    // account at the pinned block.
    let authorization = message.access_key_authorization(public_key, signature);

    let login_request = LoginRequest {
        account_id: account_id.to_string(),
        authorization,
    };

    let (me, token) = api.login(&login_request)?;

    let mut config = config.clone();
    config.auth_token = Some(token);
    config.account_id = Some(me.account_id.clone());
    config.save()?;

    if !me.terms_accepted {
        tracing::info!("{}", "Accepting terms of service...".dimmed());
        let authed_api = ApiClient::new(&config);
        authed_api.accept_terms()?;
    }

    tracing::info!(
        "{} Logged in as {}",
        "✓".green().bold(),
        me.account_id.cyan()
    );

    Ok(())
}

// --- Logout ---

#[derive(Debug, Clone, interactive_clap::InteractiveClap)]
#[interactive_clap(input_context = TrezuContext)]
#[interactive_clap(output_context = LogoutContext)]
pub struct Logout {}

#[derive(Debug, Clone)]
pub struct LogoutContext;

impl LogoutContext {
    #[tracing::instrument(name = "Logging out ...", skip_all)]
    pub fn from_previous_context(
        previous_context: TrezuContext,
        _scope: &<Logout as interactive_clap::ToInteractiveClapContextScope>::InteractiveClapContextScope,
    ) -> color_eyre::eyre::Result<Self> {
        if previous_context.config.auth_token.is_some() {
            let api = ApiClient::new(&previous_context.config);
            let _ = api.logout();
        }

        let mut config = previous_context.config.clone();
        config.auth_token = None;
        config.account_id = None;
        config.save()?;

        tracing::info!("{} Logged out successfully", "✓".green().bold());
        Ok(Self)
    }
}

// --- Whoami ---

#[derive(Debug, Clone, interactive_clap::InteractiveClap)]
#[interactive_clap(input_context = TrezuContext)]
#[interactive_clap(output_context = WhoamiContext)]
pub struct Whoami {}

#[derive(Debug, Clone)]
pub struct WhoamiContext;

impl WhoamiContext {
    #[tracing::instrument(name = "Checking authentication status ...", skip_all)]
    pub fn from_previous_context(
        previous_context: TrezuContext,
        _scope: &<Whoami as interactive_clap::ToInteractiveClapContextScope>::InteractiveClapContextScope,
    ) -> color_eyre::eyre::Result<Self> {
        let api = ApiClient::new(&previous_context.config);
        match api.get_me() {
            Ok(me) => {
                tracing::info!("Account:        {}", me.account_id.cyan());
                tracing::info!(
                    "Terms accepted: {}",
                    if me.terms_accepted {
                        "yes".green()
                    } else {
                        "no".red()
                    }
                );
            }
            Err(_) => {
                if let Some(account) = &previous_context.config.account_id {
                    tracing::info!("Stored account: {} {}", account, "(session expired)".red());
                } else {
                    tracing::info!("{}", "Not logged in. Run `trezu auth login` first.".red());
                }
            }
        }
        Ok(Self)
    }
}
