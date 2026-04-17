use crate::api::ApiClient;
use crate::config::TrezuContext;
use colored::Colorize;
use strum::{EnumDiscriminants, EnumIter, EnumMessage};

#[derive(Debug, Clone, interactive_clap::InteractiveClap)]
#[interactive_clap(context = TrezuContext)]
pub struct Treasury {
    #[interactive_clap(subcommand)]
    command: TreasuryCommand,
}

#[derive(Debug, EnumDiscriminants, Clone, interactive_clap::InteractiveClap)]
#[interactive_clap(context = TrezuContext)]
#[strum_discriminants(derive(EnumMessage, EnumIter))]
/// Select treasury action
pub enum TreasuryCommand {
    #[strum_discriminants(strum(message = "list     -   List your treasuries"))]
    /// List your treasuries
    List(TreasuryList),
    #[strum_discriminants(strum(message = "info     -   Show treasury details"))]
    /// Show treasury details
    Info(TreasuryInfo),
}

// --- List ---

#[derive(Debug, Clone, interactive_clap::InteractiveClap)]
#[interactive_clap(input_context = TrezuContext)]
#[interactive_clap(output_context = TreasuryListContext)]
pub struct TreasuryList {}

#[derive(Debug, Clone)]
pub struct TreasuryListContext;

impl TreasuryListContext {
    #[tracing::instrument(name = "Listing treasuries ...", skip_all)]
    pub fn from_previous_context(
        previous_context: TrezuContext,
        _scope: &<TreasuryList as interactive_clap::ToInteractiveClapContextScope>::InteractiveClapContextScope,
    ) -> color_eyre::eyre::Result<Self> {
        let (_, account_id) = previous_context.config.require_auth()?;
        let api = ApiClient::new(&previous_context.config);
        let treasuries = api.list_treasuries(account_id)?;

        if treasuries.is_empty() {
            tracing::info!("{}", "No treasuries found.".dimmed());
            return Ok(Self);
        }

        let mut table = prettytable::Table::new();
        table.set_format(*prettytable::format::consts::FORMAT_BOX_CHARS);
        table.set_titles(prettytable::row![bFc => "DAO ID", "Name", "Member", "Saved"]);

        for t in &treasuries {
            let name = t.config.name.as_deref().unwrap_or("-");
            table.add_row(prettytable::row![
                t.dao_id,
                name,
                if t.is_member { "yes" } else { "no" },
                if t.is_saved { "yes" } else { "no" },
            ]);
        }
        tracing_indicatif::suspend_tracing_indicatif(|| table.printstd());

        Ok(Self)
    }
}

// --- Info ---

#[derive(Debug, Clone, interactive_clap::InteractiveClap)]
#[interactive_clap(input_context = TrezuContext)]
#[interactive_clap(output_context = TreasuryInfoContext)]
pub struct TreasuryInfo {
    #[interactive_clap(skip_default_input_arg)]
    /// Treasury (DAO) account ID
    treasury_id: String,
}

impl TreasuryInfo {
    fn input_treasury_id(context: &TrezuContext) -> color_eyre::eyre::Result<Option<String>> {
        crate::config::input_treasury_id(context)
    }
}

#[derive(Debug, Clone)]
pub struct TreasuryInfoContext;

impl TreasuryInfoContext {
    #[tracing::instrument(name = "Fetching treasury info ...", skip_all)]
    pub fn from_previous_context(
        previous_context: TrezuContext,
        scope: &<TreasuryInfo as interactive_clap::ToInteractiveClapContextScope>::InteractiveClapContextScope,
    ) -> color_eyre::eyre::Result<Self> {
        crate::config::touch_treasury(&scope.treasury_id);

        let api = ApiClient::new(&previous_context.config);
        let config = api.get_treasury_config(&scope.treasury_id)?;

        tracing::info!(
            "{}",
            format!("Treasury: {}", scope.treasury_id).cyan().bold()
        );
        tracing::info!("Name:           {}", config.name.as_deref().unwrap_or("-"));
        tracing::info!(
            "Purpose:        {}",
            config.purpose.as_deref().unwrap_or("-")
        );
        tracing::info!(
            "Confidential:   {}",
            if config.is_confidential { "yes" } else { "no" }
        );

        match api.get_treasury_policy(&scope.treasury_id) {
            Ok(policy) => {
                tracing::info!("{}", "Roles:".bold());
                for role in &policy.roles {
                    let member_count = match &role.kind {
                        serde_json::Value::Object(obj) => {
                            if let Some(serde_json::Value::Array(members)) = obj.get("Group") {
                                format!("{} members", members.len())
                            } else {
                                "everyone".to_string()
                            }
                        }
                        serde_json::Value::String(s) => s.clone(),
                        _ => "unknown".to_string(),
                    };
                    tracing::info!("  {} ({})", role.name.green(), member_count);
                }

                if let Some(bond) = &policy.proposal_bond {
                    tracing::info!("Proposal bond:  {} yoctoNEAR", bond);
                }
                if let Some(period) = &policy.proposal_period {
                    match period.parse::<u64>() {
                        Ok(nanos) => {
                            let days = nanos / (1_000_000_000 * 60 * 60 * 24);
                            tracing::info!("Proposal period: {} days", days);
                        }
                        Err(_) => {
                            tracing::info!("Proposal period: unknown (invalid value: {})", period);
                        }
                    }
                }
            }
            Err(e) => {
                tracing::info!("{}", format!("Could not fetch policy: {}", e).dimmed());
            }
        }

        Ok(Self)
    }
}
