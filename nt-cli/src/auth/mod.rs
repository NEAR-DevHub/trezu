use crate::api::ApiClient;
use crate::config::TrezuContext;
use crate::types::LoginRequest;
use base64::Engine;
use colored::Colorize;

use near_cli_rs::commands::message::sign_nep413::{
    FinalSignNep413Context, NEP413Payload, SignedMessage,
};

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
        let nonce_bytes = base64::engine::general_purpose::STANDARD.decode(&challenge.nonce)?;
        let nonce_32: [u8; 32] = nonce_bytes
            .as_slice()
            .try_into()
            .map_err(|_| color_eyre::eyre::eyre!("Nonce must be 32 bytes"))?;

        let payload = NEP413Payload {
            message: "Login to Trezu".to_string(),
            nonce: nonce_32,
            recipient: "trezu.app".to_string(),
            callback_url: None,
        };

        let trezu_config = previous_context.config.clone();
        let nonce_b64 = challenge.nonce.clone();
        let login_account_id = account_id.clone();

        let on_after_signing_callback: near_cli_rs::commands::message::sign_nep413::OnAfterSigningNep413Callback =
            std::sync::Arc::new(move |signed_message: SignedMessage| {
                complete_login(
                    &trezu_config,
                    &login_account_id,
                    &signed_message.public_key,
                    &signed_message.signature,
                    &nonce_b64,
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
    public_key: &str,
    signature: &str,
    nonce_b64: &str,
) -> color_eyre::eyre::Result<()> {
    let sig_b64 = convert_signature_to_base64(signature)?;

    let api = ApiClient::new(config);

    let login_request = LoginRequest {
        account_id: account_id.to_string(),
        public_key: public_key.to_string(),
        signature: sig_b64,
        message: "Login to Trezu".to_string(),
        nonce: nonce_b64.to_string(),
        recipient: "trezu.app".to_string(),
        callback_url: None,
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

fn convert_signature_to_base64(signature_str: &str) -> color_eyre::eyre::Result<String> {
    let sig: near_crypto::Signature = signature_str
        .parse()
        .map_err(|e| color_eyre::eyre::eyre!("Failed to parse signature: {}", e))?;
    let sig_bytes: Vec<u8> = match &sig {
        near_crypto::Signature::ED25519(sig) => sig.to_bytes().to_vec(),
        _ => return Err(color_eyre::eyre::eyre!("Only ED25519 keys are supported")),
    };
    Ok(base64::engine::general_purpose::STANDARD.encode(sig_bytes))
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
                    tracing::info!("{}", "Not logged in. Run `trezu login` first.".red());
                }
            }
        }
        Ok(Self)
    }
}
