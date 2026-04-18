use crate::api::ApiClient;
use crate::config::TrezuConfig;
use colored::Colorize;

#[tracing::instrument(name = "Building relay callback ...", skip_all)]
pub fn build_relay_callback(
    config: TrezuConfig,
    treasury_id: String,
    proposal_type: Option<String>,
    proposal_id: Option<u64>,
) -> near_cli_rs::transaction_signature_options::OnSendingDelegateActionCallback {
    std::sync::Arc::new(move |signed_delegate_action, _network_config| {
        let delegate_action_base64 =
            near_cli_rs::types::signed_delegate_action::SignedDelegateActionAsBase64::from(
                signed_delegate_action,
            )
            .to_string();

        tracing::info!("Relaying delegate action to Trezu...");

        let api = ApiClient::new(&config);
        let mut relay_body = serde_json::json!({
            "treasuryId": treasury_id,
            "signedDelegateAction": delegate_action_base64,
            "storageBytes": "0",
        });
        if let Some(pt) = &proposal_type {
            relay_body.as_object_mut().unwrap().insert(
                "proposalType".to_string(),
                serde_json::Value::String(pt.clone()),
            );
        }

        let resp = api.relay_delegate_action(&relay_body)?;
        let success = resp
            .get("success")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        if success {
            tracing::info!(
                "{} Delegate action relayed successfully!",
                "✓".green().bold()
            );

            let pid = proposal_id.or_else(|| {
                resp.get("proposalId")
                    .and_then(|v| v.as_u64())
                    .or_else(|| resp.get("proposal_id").and_then(|v| v.as_u64()))
                    .or_else(|| resp.get("lastProposalId").and_then(|v| v.as_u64()))
            });

            if let Some(pid) = pid {
                tracing::info!(
                    "View proposal: {}",
                    format!("https://trezu.app/{}/requests/{}", treasury_id, pid).cyan()
                );
            } else {
                tracing::info!(
                    "View treasury: {}",
                    format!("https://trezu.app/{}/requests", treasury_id).cyan()
                );
            }
        } else {
            let error = resp
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown error");
            return Err(color_eyre::eyre::eyre!("Relay failed: {}", error));
        }

        Ok(())
    })
}
