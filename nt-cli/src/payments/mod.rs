use std::str::FromStr;

use crate::api::ApiClient;
use crate::config::{TreasuryContext, TrezuContext};
use colored::Colorize;
use strum::{EnumDiscriminants, EnumIter, EnumMessage};

#[derive(Debug, Clone, interactive_clap::InteractiveClap)]
#[interactive_clap(input_context = TrezuContext)]
#[interactive_clap(output_context = PaymentsTreasuryContext)]
pub struct Payments {
    #[interactive_clap(skip_default_input_arg)]
    /// Treasury (DAO) account ID
    treasury_id: String,
    #[interactive_clap(subcommand)]
    command: PaymentsCommand,
}

impl Payments {
    fn input_treasury_id(context: &TrezuContext) -> color_eyre::eyre::Result<Option<String>> {
        crate::config::input_treasury_id(context)
    }
}

#[derive(Debug, Clone)]
pub struct PaymentsTreasuryContext(TreasuryContext);

impl PaymentsTreasuryContext {
    pub fn from_previous_context(
        previous_context: TrezuContext,
        scope: &<Payments as interactive_clap::ToInteractiveClapContextScope>::InteractiveClapContextScope,
    ) -> color_eyre::eyre::Result<Self> {
        crate::config::touch_treasury(&scope.treasury_id);
        Ok(Self(TreasuryContext {
            config: previous_context.config,
            global_context: previous_context.global_context,
            treasury_id: scope.treasury_id.clone(),
        }))
    }
}

impl From<PaymentsTreasuryContext> for TreasuryContext {
    fn from(item: PaymentsTreasuryContext) -> Self {
        item.0
    }
}

#[derive(Debug, EnumDiscriminants, Clone, interactive_clap::InteractiveClap)]
#[interactive_clap(context = TreasuryContext)]
#[strum_discriminants(derive(EnumMessage, EnumIter))]
/// Select payment action
pub enum PaymentsCommand {
    #[strum_discriminants(strum(message = "send     -   Create a payment proposal"))]
    /// Create a payment proposal
    Send(PaymentSend),
}

#[derive(Debug, Clone, interactive_clap::InteractiveClap)]
#[interactive_clap(input_context = TreasuryContext)]
#[interactive_clap(output_context = PaymentSendContext)]
pub struct PaymentSend {
    #[interactive_clap(skip_default_input_arg)]
    /// Token to send (e.g. NEAR, USDT, USDC)
    token: String,
    /// Amount to send (e.g. 0.5, 100)
    amount: String,
    /// Recipient account ID
    receiver: String,
    #[interactive_clap(skip_default_input_arg)]
    /// Description/memo for the payment
    description: String,
    #[interactive_clap(named_arg)]
    /// Select network
    network_config: near_cli_rs::network_for_transaction::NetworkForTransactionArgs,
}

impl PaymentSend {
    fn input_token(context: &TreasuryContext) -> color_eyre::eyre::Result<Option<String>> {
        let api = ApiClient::new(&context.config);
        let assets = api.get_assets(&context.treasury_id)?;

        if assets.is_empty() {
            return Err(color_eyre::eyre::eyre!("No assets available in treasury."));
        }

        let options: Vec<String> = assets
            .iter()
            .map(|t| {
                let balance = crate::assets::format_balance_human(&t.balance, t.decimals);
                format!("{} (balance: {})", t.symbol, balance)
            })
            .collect();

        let selection = inquire::Select::new("Select token to send:", options).prompt()?;
        let symbol = selection.split(' ').next().unwrap().to_string();
        Ok(Some(symbol))
    }

    fn input_description(_context: &TreasuryContext) -> color_eyre::eyre::Result<Option<String>> {
        let desc = inquire::Text::new("Payment description:")
            .with_default("Payment")
            .prompt()?;
        Ok(Some(desc))
    }
}

#[derive(Debug, Clone)]
pub struct PaymentSendContext {
    global_context: near_cli_rs::GlobalContext,
    signer_id: near_primitives::types::AccountId,
    trezu_config: crate::config::TrezuConfig,
    treasury_id: String,
    description: String,
    kind: serde_json::Value,
    deposit: u128,
}

impl PaymentSendContext {
    #[tracing::instrument(name = "Building payment proposal ...", skip_all)]
    pub fn from_previous_context(
        previous_context: TreasuryContext,
        scope: &<PaymentSend as interactive_clap::ToInteractiveClapContextScope>::InteractiveClapContextScope,
    ) -> color_eyre::eyre::Result<Self> {
        let treasury_id = &previous_context.treasury_id;
        let config = &previous_context.config;

        let account_id = config.account_id.as_deref().ok_or_else(|| {
            color_eyre::eyre::eyre!("Not logged in. Run `trezu auth login` first.")
        })?;

        let signer_id: near_primitives::types::AccountId = account_id
            .parse()
            .map_err(|e| color_eyre::eyre::eyre!("Invalid account ID: {}", e))?;

        let api = ApiClient::new(config);
        let assets = api.get_assets(treasury_id)?;

        let token = assets
            .iter()
            .find(|t| t.symbol.eq_ignore_ascii_case(&scope.token))
            .ok_or_else(|| {
                color_eyre::eyre::eyre!(
                    "Token '{}' not found in treasury. Available: {}",
                    scope.token,
                    assets
                        .iter()
                        .map(|t| t.symbol.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            })?;

        let ft_input = format!("{} {}", scope.amount.trim(), token.symbol);
        let ft = near_cli_rs::types::ft_properties::FungibleToken::from_str(&ft_input)
            .map_err(|e| color_eyre::eyre::eyre!("Invalid amount '{}': {}", scope.amount, e))?;
        let ft_metadata = near_cli_rs::types::ft_properties::FtMetadata {
            symbol: token.symbol.clone(),
            decimals: token.decimals,
        };
        let normalized = ft.normalize(&ft_metadata)?;
        let raw_amount = normalized.amount().to_string();

        let policy = api.get_treasury_policy(treasury_id)?;
        let deposit: u128 = policy
            .proposal_bond
            .as_deref()
            .unwrap_or("0")
            .parse()
            .unwrap_or(0);

        let treasury_config = api.get_treasury_config(treasury_id)?;
        let is_confidential = treasury_config.is_confidential;

        tracing::info!(
            "Creating {} payment proposal: {} to {}",
            if is_confidential {
                "confidential".magenta().to_string()
            } else {
                "public".to_string()
            },
            normalized.to_string().cyan(),
            scope.receiver.cyan()
        );

        let (description, kind) = if is_confidential {
            build_confidential_proposal(
                &api,
                treasury_id,
                token,
                &raw_amount,
                &scope.receiver,
                &scope.description,
                &policy,
            )?
        } else {
            let token_id = resolve_token_id(token);
            let kind = serde_json::json!({
                "Transfer": {
                    "token_id": token_id,
                    "receiver_id": scope.receiver,
                    "amount": raw_amount,
                    "msg": serde_json::Value::Null,
                }
            });
            (scope.description.clone(), kind)
        };

        Ok(Self {
            global_context: previous_context.global_context,
            signer_id,
            trezu_config: previous_context.config.clone(),
            treasury_id: treasury_id.to_string(),
            description,
            kind,
            deposit,
        })
    }
}

impl From<PaymentSendContext> for near_cli_rs::commands::ActionContext {
    fn from(item: PaymentSendContext) -> Self {
        let treasury_id = item.treasury_id.clone();
        let description = item.description.clone();
        let kind = item.kind.clone();
        let deposit = item.deposit;
        let signer_id = item.signer_id.clone();

        let get_prepopulated_transaction_after_getting_network_callback:
            near_cli_rs::commands::GetPrepopulatedTransactionAfterGettingNetworkCallback =
        {
            std::sync::Arc::new(move |_network_config| {
                let args = serde_json::json!({
                    "proposal": {
                        "description": description,
                        "kind": kind,
                    }
                });
                let args_bytes = serde_json::to_vec(&args)
                    .map_err(|e| color_eyre::eyre::eyre!("Failed to serialize args: {}", e))?;

                let receiver_id: near_primitives::types::AccountId = treasury_id
                    .parse()
                    .map_err(|e| color_eyre::eyre::eyre!("Invalid treasury ID: {}", e))?;

                Ok(near_cli_rs::commands::PrepopulatedTransaction {
                    signer_id: signer_id.clone(),
                    receiver_id,
                    actions: vec![near_primitives::transaction::Action::FunctionCall(
                        Box::new(near_primitives::action::FunctionCallAction {
                            method_name: "add_proposal".to_string(),
                            args: args_bytes,
                            gas: near_primitives::types::Gas::from_teragas(270),
                            deposit: near_token::NearToken::from_yoctonear(deposit),
                        }),
                    )],
                })
            })
        };

        Self {
            global_context: item.global_context,
            interacting_with_account_ids: vec![item.signer_id],
            get_prepopulated_transaction_after_getting_network_callback,
            on_before_signing_callback: std::sync::Arc::new(
                |_unsigned_transaction, _network_config| Ok(()),
            ),
            on_before_sending_transaction_callback: std::sync::Arc::new(
                |_signed_transaction, _network_config| Ok(String::new()),
            ),
            on_after_sending_transaction_callback: std::sync::Arc::new(
                |_outcome, _network_config| Ok(()),
            ),
            sign_as_delegate_action: true,
            on_sending_delegate_action_callback: Some(crate::relay::build_relay_callback(
                item.trezu_config,
                item.treasury_id,
                None,
                None,
            )),
        }
    }
}

fn resolve_origin_asset(token: &crate::types::SimplifiedToken) -> String {
    if token.symbol.eq_ignore_ascii_case("NEAR") {
        return "nep141:wrap.near".to_string();
    }
    if let Some(contract_id) = &token.contract_id {
        if contract_id.starts_with("nep141:") {
            contract_id.clone()
        } else {
            format!("nep141:{}", contract_id)
        }
    } else {
        "nep141:wrap.near".to_string()
    }
}

#[tracing::instrument(name = "Building confidential proposal ...", skip_all)]
fn build_confidential_proposal(
    api: &ApiClient,
    treasury_id: &str,
    token: &crate::types::SimplifiedToken,
    raw_amount: &str,
    receiver: &str,
    notes: &str,
    policy: &crate::types::Policy,
) -> color_eyre::eyre::Result<(String, serde_json::Value)> {
    let origin_asset = resolve_origin_asset(token);

    let deadline_ms = policy
        .proposal_period
        .as_deref()
        .and_then(|p| p.parse::<u64>().ok())
        .map(|nanos| nanos / 1_000_000)
        .unwrap_or(24 * 60 * 60 * 1000);
    let deadline = chrono::Utc::now() + chrono::Duration::milliseconds(deadline_ms as i64);

    tracing::info!("  Getting intents quote...");
    let quote_request = serde_json::json!({
        "daoId": treasury_id,
        "swapType": "EXACT_INPUT",
        "slippageTolerance": 0,
        "originAsset": origin_asset,
        "depositType": "CONFIDENTIAL_INTENTS",
        "destinationAsset": origin_asset,
        "amount": raw_amount,
        "refundTo": treasury_id,
        "refundType": "CONFIDENTIAL_INTENTS",
        "recipient": receiver,
        "recipientType": "CONFIDENTIAL_INTENTS",
        "deadline": deadline.to_rfc3339(),
        "quoteWaitingTimeMs": 0,
        "dry": false,
    });

    let quote_response = api.get_intents_quote(&quote_request)?;

    tracing::info!("  Generating confidential intent...");
    let mut quote_metadata = quote_response.clone();
    if let Some(obj) = quote_metadata.as_object_mut() {
        obj.remove("correlationId");
    }

    let intent_request = serde_json::json!({
        "type": "swap_transfer",
        "standard": "nep413",
        "signerId": treasury_id,
        "quoteMetadata": quote_metadata,
        "notes": if notes.is_empty() { None } else { Some(notes) },
    });

    let intent_response = api.generate_intent(&intent_request)?;

    let payload_hash = intent_response
        .get("payloadHash")
        .and_then(|v| v.as_str())
        .ok_or_else(|| color_eyre::eyre::eyre!("No payloadHash in generate-intent response"))?;

    let signer_args = serde_json::json!({
        "request": {
            "path": treasury_id,
            "payload_v2": {
                "Eddsa": payload_hash,
            },
            "domain_id": 1,
        }
    });

    let args_base64 = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        serde_json::to_string(&signer_args)?.as_bytes(),
    );

    let description = "* Proposal Action: confidential <br>* Notes: Confidential proposal via private intents. Details are hidden for privacy.".to_string();

    let kind = serde_json::json!({
        "FunctionCall": {
            "receiver_id": "v1.signer",
            "actions": [
                {
                    "method_name": "sign",
                    "args": args_base64,
                    "deposit": "1",
                    "gas": "250000000000000",
                }
            ]
        }
    });

    tracing::info!("  Intent generated, payload hash: {}", payload_hash);

    Ok((description, kind))
}

fn resolve_token_id(token: &crate::types::SimplifiedToken) -> String {
    if token.symbol.eq_ignore_ascii_case("NEAR") {
        return String::new();
    }

    if let Some(contract_id) = &token.contract_id {
        contract_id
            .strip_prefix("nep141:")
            .unwrap_or(contract_id)
            .to_string()
    } else {
        String::new()
    }
}
