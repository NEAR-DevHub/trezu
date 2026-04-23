export const locales = ["en", "es", "uk"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

export const localeNames: Record<Locale, string> = {
    en: "English",
    es: "Español",
    uk: "Українська",
};

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
