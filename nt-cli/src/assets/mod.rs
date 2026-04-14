use crate::api::ApiClient;
use crate::config::TrezuContext;
use crate::types::Balance;
use colored::Colorize;

// --- Assets ---

#[derive(Debug, Clone, interactive_clap::InteractiveClap)]
#[interactive_clap(input_context = TrezuContext)]
#[interactive_clap(output_context = AssetsContext)]
pub struct Assets {
    #[interactive_clap(skip_default_input_arg)]
    /// Treasury (DAO) account ID
    treasury_id: String,
}

impl Assets {
    fn input_treasury_id(context: &TrezuContext) -> color_eyre::eyre::Result<Option<String>> {
        crate::config::input_treasury_id(context)
    }
}

#[derive(Debug, Clone)]
pub struct AssetsContext;

impl AssetsContext {
    #[tracing::instrument(name = "Fetching treasury assets ...", skip_all)]
    pub fn from_previous_context(
        previous_context: TrezuContext,
        scope: &<Assets as interactive_clap::ToInteractiveClapContextScope>::InteractiveClapContextScope,
    ) -> color_eyre::eyre::Result<Self> {
        let treasury_id = &scope.treasury_id;
        crate::config::touch_treasury(treasury_id);

        let api = ApiClient::new(&previous_context.config);
        let tokens = api.get_assets(treasury_id)?;

        if tokens.is_empty() {
            tracing::info!("{}", "No assets found.".dimmed());
            return Ok(Self);
        }

        tracing::info!("{}", format!("Assets for {}", treasury_id).cyan().bold());

        let mut table = prettytable::Table::new();
        table.set_format(*prettytable::format::consts::FORMAT_BOX_CHARS);
        table.set_titles(prettytable::row![bFc => "Token", "Symbol", "Balance", "Price", "Type"]);

        for token in &tokens {
            let balance_str = format_balance(&token.balance, token.decimals);
            table.add_row(prettytable::row![
                token.name,
                token.symbol,
                balance_str,
                if token.price == "0" {
                    "-".to_string()
                } else {
                    format!("${}", token.price)
                },
                token.residency.to_string(),
            ]);
        }
        tracing_indicatif::suspend_tracing_indicatif(|| table.printstd());

        Ok(Self)
    }
}

pub fn format_balance_human(balance: &Balance, decimals: u8) -> String {
    format_balance(balance, decimals)
}

fn format_balance(balance: &Balance, decimals: u8) -> String {
    let raw = match balance {
        Balance::Standard { total, .. } => total.clone(),
        Balance::Staked(s) => s.staked.clone(),
        Balance::Vested(v) => v.total.clone(),
    };

    format_yocto(&raw, decimals)
}

fn format_yocto(amount: &str, decimals: u8) -> String {
    if amount.is_empty() || amount == "0" {
        return "0".to_string();
    }

    let amount = amount.trim_start_matches('0');
    if amount.is_empty() {
        return "0".to_string();
    }

    let d = decimals as usize;
    if amount.len() <= d {
        let padded = format!("{:0>width$}", amount, width = d + 1);
        let (integer, fraction) = padded.split_at(padded.len() - d);
        let trimmed = fraction.trim_end_matches('0');
        if trimmed.is_empty() {
            integer.to_string()
        } else {
            format!("{}.{}", integer, &trimmed[..trimmed.len().min(6)])
        }
    } else {
        let (integer, fraction) = amount.split_at(amount.len() - d);
        let trimmed = fraction.trim_end_matches('0');
        if trimmed.is_empty() {
            integer.to_string()
        } else {
            format!("{}.{}", integer, &trimmed[..trimmed.len().min(6)])
        }
    }
}

// --- Activity ---

#[derive(Debug, Clone, interactive_clap::InteractiveClap)]
#[interactive_clap(input_context = TrezuContext)]
#[interactive_clap(output_context = ActivityContext)]
pub struct Activity {
    #[interactive_clap(skip_default_input_arg)]
    /// Treasury (DAO) account ID
    treasury_id: String,
}

impl Activity {
    fn input_treasury_id(context: &TrezuContext) -> color_eyre::eyre::Result<Option<String>> {
        crate::config::input_treasury_id(context)
    }
}

#[derive(Debug, Clone)]
pub struct ActivityContext;

impl ActivityContext {
    #[tracing::instrument(name = "Fetching recent activity ...", skip_all)]
    pub fn from_previous_context(
        previous_context: TrezuContext,
        scope: &<Activity as interactive_clap::ToInteractiveClapContextScope>::InteractiveClapContextScope,
    ) -> color_eyre::eyre::Result<Self> {
        let treasury_id = &scope.treasury_id;
        crate::config::touch_treasury(treasury_id);

        let api = ApiClient::new(&previous_context.config);
        let activity = api.get_recent_activity(treasury_id, Some(20))?;

        if activity.is_empty() {
            tracing::info!("{}", "No recent activity.".dimmed());
            return Ok(Self);
        }

        tracing::info!(
            "{}",
            format!("Recent activity for {}", treasury_id).cyan().bold()
        );

        let mut table = prettytable::Table::new();
        table.set_format(*prettytable::format::consts::FORMAT_BOX_CHARS);
        table.set_titles(
            prettytable::row![bFc => "Time", "Token", "Amount", "Counterparty", "USD Value"],
        );

        for entry in &activity {
            table.add_row(prettytable::row![
                &entry.block_time,
                &entry.token_id,
                entry.amount.to_string(),
                entry.counterparty.as_deref().unwrap_or("-"),
                entry
                    .value_usd
                    .map(|v| format!("${:.2}", v))
                    .unwrap_or_else(|| "-".to_string()),
            ]);
        }
        tracing_indicatif::suspend_tracing_indicatif(|| table.printstd());

        Ok(Self)
    }
}
