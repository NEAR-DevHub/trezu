//! Ondo stock trading hours, mirroring near.com `swapRestrictions.ts`.
//!
//! Most Ondo stocks only trade during Ondo's 24/5 window (Sunday 20:00 ET
//! through Friday 19:59 ET). The ones in [`ONDO_24_7_AIDS`] trade around the
//! clock. Ondo market holidays are not modelled.

use chrono::{DateTime, Datelike, Duration, NaiveDate, TimeZone, Timelike, Utc, Weekday};

use crate::constants::intents_tokens::find_token_by_defuse_asset_id;

pub const MARKET_CLOSED_MESSAGE: &str =
    "This market is closed. Trading resumes when the market reopens.";

/// Ondo `offhours.tradable` assets (https://status.ondo.finance/market).
/// Re-check when adding Ondo stocks to the catalog.
const ONDO_24_7_AIDS: &[&str] = &[
    "aaplon", "crclon", "googlon", "intcon", "metaon", "mrvlon", "msfton", "nvdaon", "qqqon",
    "spyon", "tslaon",
];

const WEEKLY_OPEN_MINUTE: u32 = 20 * 60;
const WEEKLY_CLOSE_MINUTE: u32 = 19 * 60 + 59;

fn has_tag(tags: &[String], tag: &str) -> bool {
    tags.iter().any(|t| t.eq_ignore_ascii_case(tag))
}

/// True for Ondo stocks that only trade during Ondo's 24/5 window.
pub fn is_market_hours_stock_tags(tags: &[String]) -> bool {
    if !has_tag(tags, "type:rwa") || !has_tag(tags, "provider:ondo") {
        return false;
    }
    !tags.iter().any(|tag| {
        tag.strip_prefix("aid:")
            .is_some_and(|aid| ONDO_24_7_AIDS.contains(&aid.to_ascii_lowercase().as_str()))
    })
}

pub fn is_market_hours_stock(asset_id: &str) -> bool {
    find_token_by_defuse_asset_id(asset_id)
        .and_then(|token| token.tags.as_deref())
        .is_some_and(is_market_hours_stock_tags)
}

fn nth_sunday(year: i32, month: u32, n: u32) -> NaiveDate {
    let first = NaiveDate::from_ymd_opt(year, month, 1).expect("valid date");
    let offset = (7 - first.weekday().num_days_from_sunday()) % 7;
    first + Duration::days(i64::from(offset + 7 * (n - 1)))
}

/// US Eastern offset: EDT (UTC-4) from the second Sunday of March 02:00 local
/// until the first Sunday of November 02:00 local, otherwise EST (UTC-5).
fn eastern_offset_hours(now: DateTime<Utc>) -> i64 {
    let year = now.year();
    let dst_start = Utc.from_utc_datetime(
        &nth_sunday(year, 3, 2)
            .and_hms_opt(7, 0, 0)
            .expect("valid time"),
    );
    let dst_end = Utc.from_utc_datetime(
        &nth_sunday(year, 11, 1)
            .and_hms_opt(6, 0, 0)
            .expect("valid time"),
    );
    if now >= dst_start && now < dst_end {
        -4
    } else {
        -5
    }
}

pub fn is_ondo_weekly_market_open(now: DateTime<Utc>) -> bool {
    let eastern = now.naive_utc() + Duration::hours(eastern_offset_hours(now));
    let minute = eastern.hour() * 60 + eastern.minute();
    match eastern.weekday() {
        Weekday::Sun => minute >= WEEKLY_OPEN_MINUTE,
        Weekday::Mon | Weekday::Tue | Weekday::Wed | Weekday::Thu => true,
        Weekday::Fri => minute < WEEKLY_CLOSE_MINUTE,
        Weekday::Sat => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn weekly_window_follows_eastern_time() {
        // Summer (EDT): Sunday 20:00 ET = 00:00 UTC Monday.
        assert!(!is_ondo_weekly_market_open(at("2026-07-12T23:59:00Z")));
        assert!(is_ondo_weekly_market_open(at("2026-07-13T00:00:00Z")));
        // Friday 19:59 ET = 23:59 UTC is closed; 19:58 ET is open.
        assert!(is_ondo_weekly_market_open(at("2026-07-17T23:58:00Z")));
        assert!(!is_ondo_weekly_market_open(at("2026-07-17T23:59:00Z")));
        assert!(!is_ondo_weekly_market_open(at("2026-07-18T15:00:00Z")));
        // Winter (EST): Sunday 20:00 ET = 01:00 UTC Monday.
        assert!(!is_ondo_weekly_market_open(at("2026-01-12T00:59:00Z")));
        assert!(is_ondo_weekly_market_open(at("2026-01-12T01:00:00Z")));
    }

    #[test]
    fn only_non_24_7_ondo_stocks_follow_market_hours() {
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
