use serde::{Deserialize, Deserializer, de};

/// Deserializer for comma-separated values
/// Accepts either a comma-separated string or None
///
/// # Example
/// ```
/// use serde::Deserialize;
///
/// #[derive(Deserialize)]
/// struct MyStruct {
///     #[serde(default, deserialize_with = "crate::utils::serde::comma_separated")]
///     pub items: Option<Vec<String>>,
/// }
/// ```
pub fn comma_separated<'de, D>(deserializer: D) -> Result<Option<Vec<String>>, D::Error>
where
    D: Deserializer<'de>,
{
    let s: Option<String> = Option::deserialize(deserializer)?;
    Ok(s.map(|s| {
        s.split(',')
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
            .collect()
    }))
}

/// Deserialize an optional number that may be encoded as string or integer.
pub fn opt_u64_from_string_or_number<'de, D>(deserializer: D) -> Result<Option<u64>, D::Error>
where
    D: Deserializer<'de>,
{
    struct StringOrU64Visitor;

    impl<'de> de::Visitor<'de> for StringOrU64Visitor {
        type Value = Option<u64>;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("null, string, or integer")
        }

        fn visit_none<E>(self) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(None)
        }

        fn visit_unit<E>(self) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(None)
        }

        fn visit_some<D2>(self, deserializer: D2) -> Result<Self::Value, D2::Error>
        where
            D2: Deserializer<'de>,
        {
            opt_u64_from_string_or_number(deserializer)
        }

        fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(Some(value))
        }

        fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            if value < 0 {
                return Err(de::Error::custom("expected non-negative integer"));
            }
            Ok(Some(value as u64))
        }

        fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            value.parse::<u64>().map(Some).map_err(de::Error::custom)
        }
    }

    deserializer.deserialize_any(StringOrU64Visitor)
}

/// Deserialize an optional u32 that may be encoded as string or integer.
pub fn opt_u32_from_string_or_number<'de, D>(deserializer: D) -> Result<Option<u32>, D::Error>
where
    D: Deserializer<'de>,
{
    let maybe_u64 = opt_u64_from_string_or_number(deserializer)?;
    maybe_u64
        .map(|v| u32::try_from(v).map_err(|_| de::Error::custom("number is out of u32 range")))
        .transpose()
}

/// Deserialize an optional u128-like value and store as string.
/// Accepts null, string, or integer and returns decimal string form.
pub fn opt_u128_string_from_string_or_number<'de, D>(
    deserializer: D,
) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    struct StringOrU128Visitor;

    impl<'de> de::Visitor<'de> for StringOrU128Visitor {
        type Value = Option<String>;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("null, string, or integer")
        }

        fn visit_none<E>(self) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(None)
        }

        fn visit_unit<E>(self) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(None)
        }

        fn visit_some<D2>(self, deserializer: D2) -> Result<Self::Value, D2::Error>
        where
            D2: Deserializer<'de>,
        {
            opt_u128_string_from_string_or_number(deserializer)
        }

        fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(Some(value.to_string()))
        }

        fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            if value < 0 {
                return Err(de::Error::custom("expected non-negative integer"));
            }
            Ok(Some(value.to_string()))
        }

        fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            value
                .parse::<u128>()
                .map(|v| Some(v.to_string()))
                .map_err(de::Error::custom)
        }
    }

    deserializer.deserialize_any(StringOrU128Visitor)
}
