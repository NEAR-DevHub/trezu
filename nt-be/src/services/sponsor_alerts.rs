use std::collections::HashMap;
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use near_api::{AccountId, NearToken, Tokens};
use tokio::sync::RwLock;

use crate::{AppState, constants::ALERT_LOW_BALANCE_THRESHOLD, utils::telegram::TelegramClient};

const ALERT_COOLDOWN: Duration = Duration::from_secs(3600);

/// Passkey executor relayer. Its full-access key ships in the public executor
/// and pays gas for every passkey wallet transaction. Mainnet only.
const PASSKEY_SPONSOR_ACCOUNT_ID: &str = "helper.trezu.near";
/// Open passkey phonebook. Its function-call key pays gas for `register`.
const PASSKEY_REGISTRY_ACCOUNT_ID: &str = "passkeys-registry.near";

static LAST_ALERT_SENT_AT: LazyLock<RwLock<HashMap<String, Instant>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

/// An operational account whose liquid NEAR we page on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WatchedAccount {
    pub label: &'static str,
    pub account_id: String,
}

/// Returns true when liquid balance is below the low-balance threshold.
pub(crate) fn is_balance_low(liquid: NearToken) -> bool {
    liquid < ALERT_LOW_BALANCE_THRESHOLD
}

/// Returns true when enough time has passed since the last alert to send another.
pub(crate) fn cooldown_allows_alert(last_sent: Option<Instant>, now: Instant) -> bool {
    match last_sent {
        None => true,
        Some(sent_at) => now.duration_since(sent_at) >= ALERT_COOLDOWN,
    }
}

/// Accounts this process should page for.
///
/// The signer and the bulk-payment contract are this deployment's own
/// spenders. Passkey accounts are shared mainnet relayers (the executor is
/// mainnet-only), so sandbox and testnet deployments skip them.
pub(crate) fn accounts_to_watch(
    signer_id: &str,
    bulk_payment_contract_id: &str,
    include_passkeys: bool,
) -> Vec<WatchedAccount> {
    let mut accounts = Vec::new();
    push_unique(
        &mut accounts,
        WatchedAccount {
            label: "Sponsor",
            account_id: signer_id.to_string(),
        },
    );
    push_unique(
        &mut accounts,
        WatchedAccount {
            label: "Bulk payment",
            account_id: bulk_payment_contract_id.to_string(),
        },
    );
    if include_passkeys {
        push_unique(
            &mut accounts,
            WatchedAccount {
                label: "Passkey sponsor",
                account_id: PASSKEY_SPONSOR_ACCOUNT_ID.to_string(),
            },
        );
        push_unique(
            &mut accounts,
            WatchedAccount {
                label: "Passkey registry",
                account_id: PASSKEY_REGISTRY_ACCOUNT_ID.to_string(),
            },
        );
    }
    accounts
}

fn push_unique(accounts: &mut Vec<WatchedAccount>, account: WatchedAccount) {
    if accounts
        .iter()
        .any(|existing| existing.account_id == account.account_id)
    {
        return;
    }
    accounts.push(account);
}

pub(crate) fn format_low_balance_message(
    label: &str,
    account_id: &str,
    liquid: NearToken,
) -> String {
    format!(
        "⚠️ {} balance low\nAccount: {}\nLiquid: {} (threshold: {})",
        label, account_id, liquid, ALERT_LOW_BALANCE_THRESHOLD,
    )
}

/// Missing accounts are skipped: sandbox may not have every mainnet contract.
pub(crate) fn is_missing_account(err: &str) -> bool {
    let err = err.to_ascii_lowercase();
    err.contains("does not exist")
        || err.contains("doesn't exist")
        || err.contains("unknown_account")
        || err.contains("account not found")
}

pub async fn fetch_liquid_balance(
    state: &AppState,
    account_id: &AccountId,
) -> Result<NearToken, Box<dyn std::error::Error + Send + Sync>> {
    let balance = Tokens::account(account_id.clone())
        .near_balance()
        .fetch_from(&state.network)
        .await?;

    Ok(NearToken::from_yoctonear(
        balance
            .total
            .as_yoctonear()
            .saturating_sub(balance.storage_locked.as_yoctonear()),
    ))
}

pub async fn run_sponsor_monitor_cycle(
    state: &Arc<AppState>,
    telegram_client: &TelegramClient,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let now = Instant::now();
    let include_passkeys = state.network.network_name == "mainnet";
    let accounts = accounts_to_watch(
        state.signer_id.as_str(),
        state.bulk_payment_contract_id.as_str(),
        include_passkeys,
    );

    let mut first_error: Option<Box<dyn std::error::Error + Send + Sync>> = None;
    for account in accounts {
        let last_sent = LAST_ALERT_SENT_AT
            .read()
            .await
            .get(&account.account_id)
            .copied();
        if !cooldown_allows_alert(last_sent, now) {
            continue;
        }

        let account_id: AccountId = match account.account_id.parse() {
            Ok(id) => id,
            Err(e) => {
                tracing::error!("Invalid watched account {}: {}", account.account_id, e);
                if first_error.is_none() {
                    first_error =
                        Some(format!("invalid account {}: {}", account.account_id, e).into());
                }
                continue;
            }
        };

        let liquid = match fetch_liquid_balance(state, &account_id).await {
            Ok(liquid) => liquid,
            Err(e) => {
                if is_missing_account(&e.to_string()) {
                    tracing::warn!(
                        "Skipping low-balance check for {} ({}): account does not exist",
                        account.label,
                        account.account_id,
                    );
                    continue;
                }
                tracing::error!(
                    "Failed to fetch liquid balance for {} ({}): {}",
                    account.label,
                    account.account_id,
                    e,
                );
                if first_error.is_none() {
                    first_error = Some(e);
                }
                continue;
            }
        };

        if !is_balance_low(liquid) {
            continue;
        }

        let message = format_low_balance_message(&account.label, &account.account_id, liquid);
        if let Err(e) = telegram_client.send_message(&message).await {
            tracing::error!(
                "Failed to send low-balance alert for {} ({}): {}",
                account.label,
                account.account_id,
                e,
            );
            if first_error.is_none() {
                first_error = Some(e);
            }
            continue;
        }

        LAST_ALERT_SENT_AT
            .write()
            .await
            .insert(account.account_id.clone(), now);
        tracing::warn!(
            "Sent low-balance alert for {} ({}) (liquid: {})",
            account.label,
            account.account_id,
            liquid,
        );
    }

    match first_error {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_balance_low_when_below_threshold() {
        assert!(is_balance_low(NearToken::from_near(4)));
        assert!(!is_balance_low(NearToken::from_near(5)));
        assert!(!is_balance_low(NearToken::from_near(10)));
    }

    #[test]
    fn cooldown_allows_first_alert() {
        assert!(cooldown_allows_alert(None, Instant::now()));
    }

    #[test]
    fn cooldown_blocks_within_one_hour() {
        let now = Instant::now();
        let recent = now - Duration::from_secs(1800);
        assert!(!cooldown_allows_alert(Some(recent), now));
    }

    #[test]
    fn cooldown_allows_after_one_hour() {
        let now = Instant::now();
        let old = now - ALERT_COOLDOWN;
        assert!(cooldown_allows_alert(Some(old), now));
    }

    #[test]
    fn format_low_balance_message_includes_account_and_amounts() {
        let msg =
            format_low_balance_message("Sponsor", "sponsor.trezu.near", NearToken::from_near(3));
        assert!(msg.contains("Sponsor"));
        assert!(msg.contains("sponsor.trezu.near"));
        assert!(msg.contains(&NearToken::from_near(3).to_string()));
        assert!(msg.contains(&ALERT_LOW_BALANCE_THRESHOLD.to_string()));
    }

    #[test]
    fn accounts_to_watch_includes_signer_and_bulk_payment() {
        let accounts = accounts_to_watch("sponsor.trezu.near", "bulkpayment.near", false);
        assert_eq!(
            accounts,
            vec![
                WatchedAccount {
                    label: "Sponsor",
                    account_id: "sponsor.trezu.near".to_string(),
                },
                WatchedAccount {
                    label: "Bulk payment",
                    account_id: "bulkpayment.near".to_string(),
                },
            ]
        );
    }

    #[test]
    fn accounts_to_watch_dedupes_shared_account() {
        let accounts = accounts_to_watch("sandbox", "sandbox", false);
        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].label, "Sponsor");
    }

    #[test]
    fn accounts_to_watch_adds_passkey_accounts_on_mainnet() {
        let accounts = accounts_to_watch("sponsor.trezu.near", "bulkpayment.near", true);
        let ids: Vec<&str> = accounts.iter().map(|a| a.account_id.as_str()).collect();
        assert!(ids.contains(&"helper.trezu.near"));
        assert!(ids.contains(&"passkeys-registry.near"));
    }

    #[test]
    fn missing_account_errors_are_skipped() {
        assert!(is_missing_account(
            "Server error: Account bulkpayment.near does not exist"
        ));
        assert!(is_missing_account("UNKNOWN_ACCOUNT"));
        assert!(!is_missing_account("timeout talking to rpc"));
    }
}
