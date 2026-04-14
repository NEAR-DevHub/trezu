use crate::api::ApiClient;
use crate::config::TrezuContext;
use colored::Colorize;

#[derive(Debug, Clone, interactive_clap::InteractiveClap)]
#[interactive_clap(input_context = TrezuContext)]
#[interactive_clap(output_context = MembersContext)]
pub struct Members {
    #[interactive_clap(skip_default_input_arg)]
    /// Treasury (DAO) account ID
    treasury_id: String,
}

impl Members {
    fn input_treasury_id(context: &TrezuContext) -> color_eyre::eyre::Result<Option<String>> {
        crate::config::input_treasury_id(context)
    }
}

#[derive(Debug, Clone)]
pub struct MembersContext;

impl MembersContext {
    #[tracing::instrument(name = "Fetching treasury members ...", skip_all)]
    pub fn from_previous_context(
        previous_context: TrezuContext,
        scope: &<Members as interactive_clap::ToInteractiveClapContextScope>::InteractiveClapContextScope,
    ) -> color_eyre::eyre::Result<Self> {
        let treasury_id = &scope.treasury_id;
        crate::config::touch_treasury(treasury_id);

        let api = ApiClient::new(&previous_context.config);
        let policy = api.get_treasury_policy(treasury_id)?;

        tracing::info!("{}", format!("Members of {}", treasury_id).cyan().bold());

        for role in &policy.roles {
            tracing::info!("{}", format!("Role: {}", role.name).green().bold());

            match &role.kind {
                serde_json::Value::Object(obj) => {
                    if let Some(serde_json::Value::Array(members)) = obj.get("Group") {
                        for member in members {
                            if let serde_json::Value::String(account) = member {
                                tracing::info!("  {}", account);
                            }
                        }
                        if members.is_empty() {
                            tracing::info!("  {}", "(no members)".dimmed());
                        }
                    } else if obj.contains_key("Everyone") {
                        tracing::info!("  {}", "(everyone)".dimmed());
                    }
                }
                serde_json::Value::String(s) if s == "Everyone" => {
                    tracing::info!("  {}", "(everyone)".dimmed());
                }
                _ => {
                    tracing::info!("  {}", "(unknown role kind)".dimmed());
                }
            }
        }

        Ok(Self)
    }
}
