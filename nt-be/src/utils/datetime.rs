use chrono::{DateTime, Datelike, Months, Utc, Weekday};
use std::time::Duration;

/// Returns the next UTC month start (`YYYY-MM-01 00:00:00Z`) after `now`.
pub fn next_month_start_utc(now: DateTime<Utc>) -> DateTime<Utc> {
    let start_of_current_month = now
        .date_naive()
        .with_day(1)
        .expect("day 1 should always be valid")
        .and_hms_opt(0, 0, 0)
        .expect("00:00:00 should always be valid");

    let start_of_next_month = start_of_current_month
        .checked_add_months(Months::new(1))
        .expect("adding one month should always be valid");

    DateTime::<Utc>::from_naive_utc_and_offset(start_of_next_month, Utc)
}

/// Returns the next UTC midnight (`YYYY-MM-DD 00:00:00Z`) after `now`.
pub fn next_utc_midnight_after(now: DateTime<Utc>) -> DateTime<Utc> {
    let tomorrow = now
        .date_naive()
        .checked_add_days(chrono::Days::new(1))
        .expect("tomorrow should always be valid");

    let midnight = tomorrow
        .and_hms_opt(0, 0, 0)
        .expect("00:00:00 should always be valid");

    DateTime::<Utc>::from_naive_utc_and_offset(midnight, Utc)
}

/// Returns the next Monday at UTC midnight after `now`.
/// If `now` is already Monday, returns the following Monday (7 days later).
pub fn next_monday_utc_midnight(now: DateTime<Utc>) -> DateTime<Utc> {
    let today = now.date_naive();
    let days_until_monday = match today.weekday() {
        Weekday::Mon => 7,
        Weekday::Tue => 6,
        Weekday::Wed => 5,
        Weekday::Thu => 4,
        Weekday::Fri => 3,
        Weekday::Sat => 2,
        Weekday::Sun => 1,
    };

    let next_monday = today
        .checked_add_days(chrono::Days::new(days_until_monday))
        .expect("next Monday should always be valid");

    let midnight = next_monday
        .and_hms_opt(0, 0, 0)
        .expect("00:00:00 should always be valid");

    DateTime::<Utc>::from_naive_utc_and_offset(midnight, Utc)
}

/// Returns the sleep duration until the next Monday at UTC midnight.
pub fn duration_until_next_monday_utc_midnight(now: DateTime<Utc>) -> Duration {
    let next_monday = next_monday_utc_midnight(now);
    let sleep_duration = next_monday.signed_duration_since(now);
    sleep_duration
        .to_std()
        .unwrap_or_else(|_| Duration::from_secs(0))
}

/// Returns the sleep duration until the next UTC midnight.
pub fn duration_until_next_utc_midnight(now: DateTime<Utc>) -> Duration {
    let next_midnight = next_utc_midnight_after(now);
    let sleep_duration = next_midnight.signed_duration_since(now);

    sleep_duration
        .to_std()
        .unwrap_or_else(|_| Duration::from_secs(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_next_month_start_utc() {
        let now =
            DateTime::parse_from_rfc3339("2026-02-11T15:42:05Z").expect("timestamp should parse");
        let now = now.with_timezone(&Utc);
        let reset_at = next_month_start_utc(now);

        assert_eq!(reset_at.to_rfc3339(), "2026-03-01T00:00:00+00:00");
    }

    #[test]
    fn test_next_utc_midnight_after() {
        let now =
            DateTime::parse_from_rfc3339("2026-02-11T15:42:05Z").expect("timestamp should parse");
        let now = now.with_timezone(&Utc);
        let next_midnight = next_utc_midnight_after(now);

        assert_eq!(next_midnight.to_rfc3339(), "2026-02-12T00:00:00+00:00");
    }

    #[test]
    fn test_duration_until_next_utc_midnight() {
        let now =
            DateTime::parse_from_rfc3339("2026-02-11T23:59:30Z").expect("timestamp should parse");
        let now = now.with_timezone(&Utc);
        let duration = duration_until_next_utc_midnight(now);

        assert_eq!(
            duration,
            Duration::from_secs(30),
            "Expected 30 seconds until midnight"
        );
    }

    // 2026-03-30 is a Monday
    #[test]
    fn test_next_monday_utc_midnight_from_monday() {
        let now =
            DateTime::parse_from_rfc3339("2026-03-30T12:00:00Z").expect("timestamp should parse");
        let now = now.with_timezone(&Utc);
        // Monday → next Monday is 7 days later
        assert_eq!(
            next_monday_utc_midnight(now).to_rfc3339(),
            "2026-04-06T00:00:00+00:00"
        );
    }

    #[test]
    fn test_next_monday_utc_midnight_from_tuesday() {
        let now =
            DateTime::parse_from_rfc3339("2026-03-31T09:00:00Z").expect("timestamp should parse");
        let now = now.with_timezone(&Utc);
        // Tuesday → next Monday is 6 days later
        assert_eq!(
            next_monday_utc_midnight(now).to_rfc3339(),
            "2026-04-06T00:00:00+00:00"
        );
    }

    #[test]
    fn test_next_monday_utc_midnight_from_sunday() {
        let now =
            DateTime::parse_from_rfc3339("2026-04-05T22:00:00Z").expect("timestamp should parse");
        let now = now.with_timezone(&Utc);
        // Sunday → next Monday is 1 day later
        assert_eq!(
            next_monday_utc_midnight(now).to_rfc3339(),
            "2026-04-06T00:00:00+00:00"
        );
    }

    #[test]
    fn test_duration_until_next_monday_utc_midnight() {
        // Friday 2026-04-03 at 00:00:00 UTC → next Monday 2026-04-06 = 3 days exactly
        let now =
            DateTime::parse_from_rfc3339("2026-04-03T00:00:00Z").expect("timestamp should parse");
        let now = now.with_timezone(&Utc);
        let duration = duration_until_next_monday_utc_midnight(now);
        assert_eq!(duration, Duration::from_secs(3 * 24 * 60 * 60));
    }
}
