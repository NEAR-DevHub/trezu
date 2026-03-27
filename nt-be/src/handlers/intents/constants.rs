/// Base URL for the 1Click confidential intents API.
/// Confidential operations use the test endpoint which supports the confidential intents protocol.
pub const CONFIDENTIAL_API_URL: &str = "https://1click-test.chaindefuser.com";

/// Get the 1Click API key from environment.
pub fn oneclick_api_key() -> Option<String> {
    std::env::var("ONECLICK_API_KEY").ok().filter(|s| !s.is_empty())
}
