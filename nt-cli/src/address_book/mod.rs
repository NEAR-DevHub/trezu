use crate::api::{ApiClient, CreateAddressBookEntryRequest};
use crate::config::{TreasuryContext, TrezuContext};
use colored::Colorize;
use strum::{EnumDiscriminants, EnumIter, EnumMessage};

#[derive(Debug, Clone, interactive_clap::InteractiveClap)]
#[interactive_clap(input_context = TrezuContext)]
#[interactive_clap(output_context = AddressBookTreasuryContext)]
pub struct AddressBook {
    #[interactive_clap(skip_default_input_arg)]
    /// Treasury (DAO) account ID
    treasury_id: String,
    #[interactive_clap(subcommand)]
    command: AddressBookCommand,
}

impl AddressBook {
    fn input_treasury_id(context: &TrezuContext) -> color_eyre::eyre::Result<Option<String>> {
        crate::config::input_treasury_id(context)
    }
}

#[derive(Debug, Clone)]
pub struct AddressBookTreasuryContext(TreasuryContext);

impl AddressBookTreasuryContext {
    pub fn from_previous_context(
        previous_context: TrezuContext,
        scope: &<AddressBook as interactive_clap::ToInteractiveClapContextScope>::InteractiveClapContextScope,
    ) -> color_eyre::eyre::Result<Self> {
        crate::config::touch_treasury(&scope.treasury_id);
        Ok(Self(TreasuryContext {
            config: previous_context.config,
            global_context: previous_context.global_context,
            treasury_id: scope.treasury_id.clone(),
        }))
    }
}

impl From<AddressBookTreasuryContext> for TreasuryContext {
    fn from(item: AddressBookTreasuryContext) -> Self {
        item.0
    }
}

#[derive(Debug, EnumDiscriminants, Clone, interactive_clap::InteractiveClap)]
#[interactive_clap(context = TreasuryContext)]
#[strum_discriminants(derive(EnumMessage, EnumIter))]
/// Select address book action
pub enum AddressBookCommand {
    #[strum_discriminants(strum(message = "list     -   List address book entries"))]
    /// List address book entries
    List(AddressBookList),
    #[strum_discriminants(strum(message = "add      -   Add a new address book entry"))]
    /// Add a new address book entry
    Add(AddressBookAdd),
    #[strum_discriminants(strum(message = "remove   -   Remove an address book entry"))]
    /// Remove an address book entry
    Remove(AddressBookRemove),
}

// --- List ---

#[derive(Debug, Clone, interactive_clap::InteractiveClap)]
#[interactive_clap(input_context = TreasuryContext)]
#[interactive_clap(output_context = AddressBookListContext)]
pub struct AddressBookList {}

#[derive(Debug, Clone)]
pub struct AddressBookListContext;

impl AddressBookListContext {
    #[tracing::instrument(name = "Fetching address book ...", skip_all)]
    pub fn from_previous_context(
        previous_context: TreasuryContext,
        _scope: &<AddressBookList as interactive_clap::ToInteractiveClapContextScope>::InteractiveClapContextScope,
    ) -> color_eyre::eyre::Result<Self> {
        let treasury_id = &previous_context.treasury_id;
        previous_context.config.require_auth()?;
        let api = ApiClient::new(&previous_context.config);
        let entries = api.list_address_book(treasury_id)?;

        if entries.is_empty() {
            tracing::info!("{}", "Address book is empty.".dimmed());
            return Ok(Self);
        }

        let mut table = prettytable::Table::new();
        table.set_format(*prettytable::format::consts::FORMAT_BOX_CHARS);
        table.set_titles(prettytable::row![bFc => "Name", "Address", "Networks", "Note"]);

        for entry in &entries {
            table.add_row(prettytable::row![
                entry.name,
                entry.address,
                entry.networks.join(", "),
                entry.note.as_deref().unwrap_or("-"),
            ]);
        }
        tracing_indicatif::suspend_tracing_indicatif(|| table.printstd());

        Ok(Self)
    }
}

// --- Add ---

#[derive(Debug, Clone, interactive_clap::InteractiveClap)]
#[interactive_clap(input_context = TreasuryContext)]
#[interactive_clap(output_context = AddressBookAddContext)]
pub struct AddressBookAdd {
    /// Contact name
    name: String,
    /// Account/wallet address
    address: String,
    #[interactive_clap(skip_default_input_arg)]
    /// Network (e.g. near, ethereum)
    network: String,
}

impl AddressBookAdd {
    fn input_network(_context: &TreasuryContext) -> color_eyre::eyre::Result<Option<String>> {
        let options = vec!["near", "ethereum", "bitcoin", "solana", "other"];
        let selection = inquire::Select::new("Select network:", options).prompt()?;
        if selection == "other" {
            let custom = inquire::Text::new("Enter network name:").prompt()?;
            Ok(Some(custom))
        } else {
            Ok(Some(selection.to_string()))
        }
    }
}

#[derive(Debug, Clone)]
pub struct AddressBookAddContext;

impl AddressBookAddContext {
    #[tracing::instrument(name = "Adding address book entry ...", skip_all)]
    pub fn from_previous_context(
        previous_context: TreasuryContext,
        scope: &<AddressBookAdd as interactive_clap::ToInteractiveClapContextScope>::InteractiveClapContextScope,
    ) -> color_eyre::eyre::Result<Self> {
        let treasury_id = &previous_context.treasury_id;
        previous_context.config.require_auth()?;
        let api = ApiClient::new(&previous_context.config);

        let entry = CreateAddressBookEntryRequest {
            name: scope.name.clone(),
            address: scope.address.clone(),
            networks: vec![scope.network.clone()],
            note: None,
        };

        api.create_address_book_entries(treasury_id, vec![entry])?;

        tracing::info!(
            "{} Added {} ({}) to address book",
            "✓".green().bold(),
            scope.name.cyan(),
            scope.address
        );

        Ok(Self)
    }
}

// --- Remove ---

#[derive(Debug, Clone, interactive_clap::InteractiveClap)]
#[interactive_clap(input_context = TreasuryContext)]
#[interactive_clap(output_context = AddressBookRemoveContext)]
pub struct AddressBookRemove {
    #[interactive_clap(skip_default_input_arg)]
    /// Entry ID to remove
    entry_id: String,
}

impl AddressBookRemove {
    fn input_entry_id(context: &TreasuryContext) -> color_eyre::eyre::Result<Option<String>> {
        let treasury_id = &context.treasury_id;
        context.config.require_auth()?;
        let api = ApiClient::new(&context.config);
        let entries = api.list_address_book(treasury_id)?;

        if entries.is_empty() {
            return Err(color_eyre::eyre::eyre!("Address book is empty."));
        }

        let options: Vec<String> = entries
            .iter()
            .map(|e| format!("{} - {} ({})", e.id, e.name, e.address))
            .collect();

        let selection = inquire::Select::new("Select entry to remove:", options).prompt()?;
        let id = selection.split(' ').next().unwrap().to_string();
        Ok(Some(id))
    }
}

#[derive(Debug, Clone)]
pub struct AddressBookRemoveContext;

impl AddressBookRemoveContext {
    #[tracing::instrument(name = "Removing address book entry ...", skip_all)]
    pub fn from_previous_context(
        previous_context: TreasuryContext,
        scope: &<AddressBookRemove as interactive_clap::ToInteractiveClapContextScope>::InteractiveClapContextScope,
    ) -> color_eyre::eyre::Result<Self> {
        previous_context.config.require_auth()?;
        let api = ApiClient::new(&previous_context.config);

        let id: uuid::Uuid = scope
            .entry_id
            .parse()
            .map_err(|e| color_eyre::eyre::eyre!("Invalid UUID: {}", e))?;

        api.delete_address_book_entries(vec![id])?;

        tracing::info!("{} Entry removed", "✓".green().bold());

        Ok(Self)
    }
}
