/// Get the 1Click API key from environment.
pub fn oneclick_api_key() -> Option<String> {
    std::env::var("ONECLICK_API_KEY")
        .ok()
        .filter(|s| !s.is_empty())
}
