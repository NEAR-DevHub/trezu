export const locales = [
    "en",
    "es",
    "uk",
    "he",
    "de",
    "fr",
    "vi",
    "zh",
    "tr",
    "id",
    "pt",
    "ja",
    "ko",
] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

export const localeNames: Record<Locale, string> = {
    en: "English",
    es: "Español",
    uk: "Українська",
    he: "עברית",
    de: "Deutsch",
    fr: "Français",
    vi: "Tiếng Việt",
    zh: "中文",
    tr: "Türkçe",
    id: "Bahasa Indonesia",
    pt: "Português",
    ja: "日本語",
    ko: "한국어",
};

/** Right-to-left locales. */
export const rtlLocales: readonly Locale[] = ["he"];

export function getLocaleDirection(locale: Locale): "ltr" | "rtl" {
    return rtlLocales.includes(locale) ? "rtl" : "ltr";
}

export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isLocale(value: string | undefined | null): value is Locale {
    return !!value && (locales as readonly string[]).includes(value);
}

export function pickLocaleFromAcceptLanguage(header: string | null): Locale {
    if (!header) return defaultLocale;
    const parts = header
        .split(",")
        .map((part) => {
            const [tag, q] = part.trim().split(";q=");
            const parsedQ = q ? Number.parseFloat(q) : 1;
            const weight = Number.isFinite(parsedQ)
                ? Math.min(1, Math.max(0, parsedQ))
                : 0;
            return {
                tag: tag.toLowerCase(),
                q: weight,
            };
        })
        .sort((a, b) => b.q - a.q);

    for (const { tag } of parts) {
        const base = tag.split("-")[0];
        if (isLocale(base)) return base;
    }
    return defaultLocale;
}
