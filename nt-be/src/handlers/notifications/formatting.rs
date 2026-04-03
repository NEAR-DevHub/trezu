use crate::handlers::token::metadata::TokenMetadata;
use bigdecimal::BigDecimal;
use std::{collections::HashMap, str::FromStr};

/// Escape text for Telegram `parse_mode=HTML` (`<`, `>`, `&`).
pub fn escape_telegram_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

pub fn format_token_label(token_id: &str) -> &str {
    // Strip intents prefix for display: "intents.near:nep141:usdc.near" -> "usdc.near"
    if let Some(rest) = token_id.strip_prefix("intents.near:nep141:") {
        return rest;
    }
    if let Some(rest) = token_id.strip_prefix("intents.near:") {
        return rest;
    }
    token_id
}

pub fn format_raw_amount(raw_amount: &str, decimals: u8) -> Option<String> {
    let raw = BigDecimal::from_str(raw_amount).ok()?;
    let divisor = BigDecimal::from_str(&format!("1{}", "0".repeat(decimals as usize))).ok()?;
    Some(decimal_to_string(&(raw / divisor).normalized()))
}

pub fn format_usd(usd: f64) -> String {
    format!("${usd:.2}")
}

pub fn token_meta_for_id<'a>(
    token_id: &str,
    metadata_map: &'a HashMap<String, TokenMetadata>,
) -> Option<&'a TokenMetadata> {
    metadata_map.get(token_id).or_else(|| {
        if token_id.eq_ignore_ascii_case("near") {
            metadata_map.get("intents.near:nep141:wrap.near")
        } else {
            None
        }
    })
}

fn decimal_to_string(value: &BigDecimal) -> String {
    let raw = value.to_string();
    let plain = scientific_to_plain_string(&raw);
    let trimmed = plain.trim_end_matches('0').trim_end_matches('.');
    if trimmed.is_empty() || trimmed == "-0" {
        "0".to_string()
    } else {
        trimmed.to_string()
    }
}

fn scientific_to_plain_string(raw: &str) -> String {
    let Some((mantissa, exponent)) = raw.split_once(['e', 'E']) else {
        return raw.to_string();
    };

    let exponent: i64 = exponent.parse().unwrap_or(0);
    let negative = mantissa.starts_with('-');
    let unsigned = mantissa.strip_prefix('-').unwrap_or(mantissa);
    let (integer, fractional) = unsigned.split_once('.').unwrap_or((unsigned, ""));
    let digits = format!("{}{}", integer, fractional);
    let decimal_pos = integer.len() as i64;
    let new_decimal_pos = decimal_pos + exponent;

    let result = if new_decimal_pos <= 0 {
        format!("0.{}{}", "0".repeat((-new_decimal_pos) as usize), digits)
    } else if new_decimal_pos as usize >= digits.len() {
        format!(
            "{}{}",
            digits,
            "0".repeat(new_decimal_pos as usize - digits.len())
        )
    } else {
        format!(
            "{}.{}",
            &digits[..new_decimal_pos as usize],
            &digits[new_decimal_pos as usize..]
        )
    };

    if negative {
        format!("-{result}")
    } else {
        result
    }
}
