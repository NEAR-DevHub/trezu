//! Request URLs built from a configured base and a path, never by string
//! concatenation: the base parses once, every path segment is percent
//! encoded, and query values go through `Url::query_pairs_mut`.

use axum::http::StatusCode;
use url::{ParseError, Url};

/// `base` with the `/`-separated segments of `path` appended. A trailing
/// slash on the base or a leading slash on the path makes no difference,
/// and a base that carries its own path (`https://host/api`) keeps it.
pub fn api_url(base: &str, path: &str) -> Result<Url, ParseError> {
    let mut url = Url::parse(base)?;
    url.path_segments_mut()
        .map_err(|_| ParseError::RelativeUrlWithCannotBeABaseBase)?
        .pop_if_empty()
        .extend(path.split('/').filter(|segment| !segment.is_empty()));
    Ok(url)
}

/// `api_url` inside a handler: a configured base that does not parse is a
/// deployment fault, reported as 500 rather than as the upstream's failure.
pub fn api_url_or_500(base: &str, path: &str) -> Result<Url, (StatusCode, String)> {
    api_url(base, path).map_err(|error| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("invalid API base URL {base:?}: {error}"),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joins_regardless_of_slashes_and_keeps_the_base_path() {
        for base in ["https://api.example.com", "https://api.example.com/"] {
            assert_eq!(
                api_url(base, "v0/quote").unwrap().as_str(),
                "https://api.example.com/v0/quote"
            );
            assert_eq!(
                api_url(base, "/v0/quote").unwrap().as_str(),
                "https://api.example.com/v0/quote"
            );
        }
        assert_eq!(
            api_url(
                "https://host/api/",
                "prices/current/coingecko:near,coingecko:bitcoin"
            )
            .unwrap()
            .as_str(),
            "https://host/api/prices/current/coingecko:near,coingecko:bitcoin"
        );
    }

    #[test]
    fn segments_cannot_escape_or_inject_a_query() {
        assert_eq!(
            api_url("https://host", "repos/a b/x?y#z").unwrap().as_str(),
            "https://host/repos/a%20b/x%3Fy%23z"
        );
        assert!(api_url("not a url", "v0").is_err());
        assert_eq!(
            api_url_or_500("not a url", "v0").unwrap_err().0,
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }
}
