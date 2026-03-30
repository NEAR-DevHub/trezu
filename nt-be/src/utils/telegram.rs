use teloxide::{
    Bot,
    payloads::SendMessageSetters,
    requests::Requester,
    types::{ChatId, InlineKeyboardButton, InlineKeyboardMarkup},
};
use url::Url;

/// Telegram bot client wrapping teloxide's Bot.
///
/// Provides helper methods for common messaging patterns used across the app:
/// - `send_message`: send a plain notification to the configured internal alerts channel
/// - `send_message_to_chat`: send a plain message to any chat by ID
/// - `send_message_with_button`: send a message with an inline URL button to any chat
///
/// All methods silently succeed when the bot is not configured (missing token).
#[derive(Clone, Debug)]
pub struct TelegramClient {
    pub(crate) bot: Option<Bot>,
    notification_chat_id: Option<String>,
}

impl TelegramClient {
    /// Create a new TelegramClient.
    ///
    /// - `bot_token`: the Telegram Bot API token (from `TELEGRAM_BOT_TOKEN`)
    /// - `chat_id`: the internal alerts channel chat ID (from `TELEGRAM_CHAT_ID`)
    pub fn new(bot_token: Option<String>, chat_id: Option<String>) -> Self {
        Self {
            bot: bot_token.filter(|s| !s.is_empty()).map(Bot::new),
            notification_chat_id: chat_id,
        }
    }

    /// Expose the inner teloxide Bot, if configured.
    pub fn bot(&self) -> Option<&Bot> {
        self.bot.as_ref()
    }

    /// Send a plain-text notification to the configured internal alerts channel.
    ///
    /// This is the legacy method used for internal operational alerts (user creation,
    /// treasury creation, whitelist requests). The chat ID comes from `TELEGRAM_CHAT_ID`.
    pub async fn send_message(
        &self,
        message: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let (bot, chat_id_str) = match (&self.bot, &self.notification_chat_id) {
            (Some(b), Some(c)) => (b, c),
            _ => {
                log::warn!(
                    "Telegram client not configured. Please set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID. Message ignored: {}",
                    message
                );
                return Ok(());
            }
        };

        let chat_id: i64 = chat_id_str
            .parse()
            .map_err(|_| format!("Invalid TELEGRAM_CHAT_ID: {}", chat_id_str))?;

        bot.send_message(ChatId(chat_id), message).await?;
        Ok(())
    }

    /// Send a plain-text message to an arbitrary Telegram chat.
    pub async fn send_message_to_chat(
        &self,
        chat_id: i64,
        text: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let bot = match &self.bot {
            Some(b) => b,
            None => {
                log::warn!(
                    "Telegram bot not configured (TELEGRAM_BOT_TOKEN not set). Message to chat {} ignored.",
                    chat_id
                );
                return Ok(());
            }
        };

        bot.send_message(ChatId(chat_id), text).await?;
        Ok(())
    }

    /// Send a message with a single inline URL button to an arbitrary Telegram chat.
    pub async fn send_message_with_button(
        &self,
        chat_id: i64,
        text: &str,
        button_label: &str,
        button_url: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let bot = match &self.bot {
            Some(b) => b,
            None => {
                log::warn!(
                    "Telegram bot not configured (TELEGRAM_BOT_TOKEN not set). Message with button to chat {} ignored.",
                    chat_id
                );
                return Ok(());
            }
        };

        let parsed_url: Url = button_url
            .parse()
            .map_err(|_| format!("Invalid button URL: {}", button_url))?;

        let keyboard =
            InlineKeyboardMarkup::new([[InlineKeyboardButton::url(button_label, parsed_url)]]);

        bot.send_message(ChatId(chat_id), text)
            .reply_markup(keyboard)
            .await?;
        Ok(())
    }
}

impl Default for TelegramClient {
    fn default() -> Self {
        Self {
            bot: None,
            notification_chat_id: None,
        }
    }
}
