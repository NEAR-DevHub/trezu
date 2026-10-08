//! Stock trading hours, mirroring near.com `swapRestrictions.ts`. Stocks are
//! tokenized by Ondo, which sets the hours.
//!
//! Most stocks only trade during the 24/5 window (Sunday 20:00 ET through
//! Friday 19:59 ET). The ones in [`ALWAYS_OPEN_STOCK_AIDS`] trade around the
//! clock. The window itself is checked in the frontend, where the final vote
//! is cast.

/// Stocks that also trade outside the 24/5 window (`offhours.tradable` on
/// https://status.ondo.finance/market). Keep in sync with near.com
/// `swapRestrictions.ts`. A stock missing here is treated as market-hours only.
const ALWAYS_OPEN_STOCK_AIDS: &[&str] = &[
    "aaplon", "crclon", "googlon", "intcon", "metaon", "mrvlon", "msfton", "nvdaon", "qqqon",
    "spyon", "tslaon",
];

fn has_tag(tags: &[String], tag: &str) -> bool {
    tags.iter().any(|t| t.eq_ignore_ascii_case(tag))
}

/// True for stocks that only trade during the 24/5 window.
pub fn is_market_hours_stock_tags(tags: &[String]) -> bool {
    if !has_tag(tags, "type:rwa") || !has_tag(tags, "provider:ondo") {
        return false;
    }
    !tags.iter().any(|tag| {
        tag.strip_prefix("aid:")
            .is_some_and(|aid| ALWAYS_OPEN_STOCK_AIDS.contains(&aid.to_ascii_lowercase().as_str()))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_non_24_7_stocks_follow_market_hours() {
        let tags = |aid: &str| {
            vec![
                format!("aid:{aid}"),
                "type:rwa".to_string(),
                "provider:ondo".to_string(),
            ]
        };
        assert!(is_market_hours_stock_tags(&tags("gldon")));
        assert!(!is_market_hours_stock_tags(&tags("aaplon")));
        assert!(!is_market_hours_stock_tags(&[
            "aid:usdon".to_string(),
            "type:stablecoin".to_string(),
            "provider:ondo".to_string(),
        ]));
    }
}
