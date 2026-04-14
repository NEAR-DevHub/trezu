use color_eyre::eyre::{Result, WrapErr};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrezuConfig {
    pub api_base: String,
    pub auth_token: Option<String>,
    pub account_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_treasury: Option<String>,
}

impl Default for TrezuConfig {
    fn default() -> Self {
        Self {
            api_base: "https://api.trezu.app".to_string(),
            auth_token: None,
            account_id: None,
            selected_treasury: None,
        }
    }
}

impl TrezuConfig {
    fn config_dir() -> Result<PathBuf> {
        let dir = dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("trezu");
        std::fs::create_dir_all(&dir).wrap_err("Failed to create config directory")?;
        Ok(dir)
    }

    fn config_path() -> Result<PathBuf> {
        Ok(Self::config_dir()?.join("config.json"))
    }

    pub fn load() -> Result<Self> {
        let path = Self::config_path()?;
        if path.exists() {
            let data = std::fs::read_to_string(&path).wrap_err("Failed to read config")?;
            serde_json::from_str(&data).wrap_err("Failed to parse config")
        } else {
            Ok(Self::default())
        }
    }

    pub fn save(&self) -> Result<()> {
        let path = Self::config_path()?;
        let data = serde_json::to_string_pretty(self)?;
        std::fs::write(&path, data).wrap_err("Failed to write config")?;
        Ok(())
    }

    pub fn require_auth(&self) -> Result<(&str, &str)> {
        let token = self
            .auth_token
            .as_deref()
            .ok_or_else(|| color_eyre::eyre::eyre!("Not logged in. Run `trezu login` first."))?;
        let account = self
            .account_id
            .as_deref()
            .ok_or_else(|| color_eyre::eyre::eyre!("No account ID in config."))?;
        Ok((token, account))
    }
}

#[derive(Debug, Clone)]
pub struct TrezuContext {
    pub config: TrezuConfig,
    pub global_context: near_cli_rs::GlobalContext,
}

#[derive(Debug, Clone)]
pub struct TreasuryContext {
    pub config: TrezuConfig,
    pub global_context: near_cli_rs::GlobalContext,
    pub treasury_id: String,
}

pub fn input_treasury_id(context: &TrezuContext) -> color_eyre::eyre::Result<Option<String>> {
    let (_, account_id) = context.config.require_auth()?;
    let api = crate::api::ApiClient::new(&context.config);
    let treasuries = api.list_treasuries(account_id)?;

    if treasuries.is_empty() {
        return Err(color_eyre::eyre::eyre!(
            "No treasuries found for this account."
        ));
    }

    let recent = RecentTreasuries::load();

    let mut sorted: Vec<_> = treasuries.iter().collect();
    sorted.sort_by(|a, b| {
        let a_ts = recent.last_used(&a.dao_id);
        let b_ts = recent.last_used(&b.dao_id);
        match (a_ts, b_ts) {
            (Some(a_t), Some(b_t)) => b_t.cmp(&a_t),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => a.dao_id.cmp(&b.dao_id),
        }
    });

    let options: Vec<String> = sorted
        .iter()
        .map(|t| {
            let name = t.config.name.as_deref().unwrap_or("Unnamed");
            format!("{} ({})", t.dao_id, name)
        })
        .collect();

    let selection = inquire::Select::new("Select a treasury:", options).prompt()?;
    let treasury_id = selection.split(' ').next().unwrap().to_string();
    Ok(Some(treasury_id))
}

pub fn touch_treasury(treasury_id: &str) {
    let mut recent = RecentTreasuries::load();
    recent.touch(treasury_id);
    let _ = recent.save();
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct RecentTreasuries {
    #[serde(flatten)]
    entries: HashMap<String, u64>,
}

impl RecentTreasuries {
    fn path() -> Option<PathBuf> {
        let dir = dirs::config_dir()?.join("trezu");
        Some(dir.join("recent_treasuries.json"))
    }

    fn load() -> Self {
        Self::path()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|data| serde_json::from_str(&data).ok())
            .unwrap_or_default()
    }

    fn save(&self) -> Option<()> {
        let path = Self::path()?;
        let data = serde_json::to_string_pretty(self).ok()?;
        std::fs::write(path, data).ok()
    }

    fn last_used(&self, treasury_id: &str) -> Option<u64> {
        self.entries.get(treasury_id).copied()
    }

    fn touch(&mut self, treasury_id: &str) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        self.entries.insert(treasury_id.to_string(), now);
    }
}
