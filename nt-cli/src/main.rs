#![allow(clippy::large_enum_variant, clippy::enum_variant_names)]

use color_eyre::owo_colors::OwoColorize;
use interactive_clap::ToCliArgs;
use strum::{EnumDiscriminants, EnumIter, EnumMessage};

mod address_book;
mod api;
mod assets;
mod auth;
mod config;
mod members;
mod payments;
mod relay;
mod requests;
mod treasury;
mod types;

pub use config::TrezuContext;

type TrezuConfigContext = (config::TrezuConfig, near_cli_rs::config::Config);

#[derive(Debug, Clone, interactive_clap::InteractiveClap)]
#[interactive_clap(input_context = TrezuConfigContext)]
#[interactive_clap(output_context = CmdContext)]
struct Cmd {
    /// TEACH-ME mode: verbose output for troubleshooting
    #[interactive_clap(long)]
    teach_me: bool,
    #[interactive_clap(subcommand)]
    command: Command,
}

#[derive(Debug, Clone)]
struct CmdContext(TrezuContext);

impl CmdContext {
    fn from_previous_context(
        previous_context: TrezuConfigContext,
        scope: &<Cmd as interactive_clap::ToInteractiveClapContextScope>::InteractiveClapContextScope,
    ) -> color_eyre::eyre::Result<Self> {
        let verbosity = if scope.teach_me {
            near_cli_rs::Verbosity::TeachMe
        } else {
            near_cli_rs::Verbosity::Interactive
        };
        let global_context = near_cli_rs::GlobalContext {
            config: previous_context.1,
            offline: false,
            verbosity,
        };
        Ok(Self(TrezuContext {
            config: previous_context.0,
            global_context,
        }))
    }
}

impl From<CmdContext> for TrezuContext {
    fn from(item: CmdContext) -> Self {
        item.0
    }
}

#[derive(Debug, EnumDiscriminants, Clone, interactive_clap::InteractiveClap)]
#[interactive_clap(context = TrezuContext)]
#[strum_discriminants(derive(EnumMessage, EnumIter))]
#[interactive_clap(disable_back)]
/// What would you like to do? (use arrow keys to select, Enter to confirm)
pub enum Command {
    #[strum_discriminants(strum(message = "treasury       -   Manage treasuries (list, info)"))]
    /// Manage treasuries
    Treasury(self::treasury::Treasury),
    #[strum_discriminants(strum(message = "assets         -   View treasury assets and balances"))]
    /// View treasury assets and balances
    Assets(self::assets::Assets),
    #[strum_discriminants(strum(
        message = "requests       -   View and manage proposals/requests"
    ))]
    /// View and manage proposals/requests
    Requests(self::requests::Requests),
    #[strum_discriminants(strum(message = "payments       -   Create payment proposals"))]
    /// Create payment proposals
    Payments(self::payments::Payments),
    #[strum_discriminants(strum(message = "address-book   -   Manage address book"))]
    /// Manage address book
    AddressBook(self::address_book::AddressBook),
    #[strum_discriminants(strum(message = "members        -   View treasury members"))]
    /// View treasury members
    Members(self::members::Members),
    #[strum_discriminants(strum(message = "activity       -   View recent transaction activity"))]
    /// View recent transaction activity
    Activity(self::assets::Activity),
    #[strum_discriminants(strum(message = "auth           -   Login, logout, and account info"))]
    /// Login, logout, and account info
    Auth(self::auth::Auth),
}

fn main() -> color_eyre::eyre::Result<()> {
    inquire::set_global_render_config(near_cli_rs::get_global_render_config());

    #[cfg(not(debug_assertions))]
    let display_env_section = false;
    #[cfg(debug_assertions)]
    let display_env_section = true;
    color_eyre::config::HookBuilder::default()
        .display_env_section(display_env_section)
        .install()?;

    let config = config::TrezuConfig::load()?;
    let near_config = near_cli_rs::config::Config::get_config_toml()?;

    let cli = match Cmd::try_parse() {
        Ok(cli) => cli,
        Err(error) => error.exit(),
    };

    let verbosity = if cli.teach_me {
        near_cli_rs::Verbosity::TeachMe
    } else {
        near_cli_rs::Verbosity::Interactive
    };
    near_cli_rs::setup_tracing_with_extra_directives(verbosity, &["trezu=info"])?;

    match <Cmd as interactive_clap::FromCli>::from_cli(Some(cli), (config, near_config)) {
        interactive_clap::ResultFromCli::Ok(cli_cmd)
        | interactive_clap::ResultFromCli::Cancel(Some(cli_cmd)) => {
            eprintln!(
                "\n{}  {} {}",
                "Your console command:".dimmed(),
                "trezu".green(),
                shell_words::join(cli_cmd.to_cli_args()).green()
            );
            Ok(())
        }
        interactive_clap::ResultFromCli::Cancel(None) => {
            eprintln!("Goodbye!");
            Ok(())
        }
        interactive_clap::ResultFromCli::Back => {
            unreachable!("Top-level command does not support back")
        }
        interactive_clap::ResultFromCli::Err(optional_cli_cmd, err) => {
            if let Some(cli_cmd) = optional_cli_cmd {
                eprintln!(
                    "\n{}  {} {}",
                    "Your console command:".dimmed(),
                    "trezu".green(),
                    shell_words::join(cli_cmd.to_cli_args()).green()
                );
            }
            Err(err)
        }
    }
}
