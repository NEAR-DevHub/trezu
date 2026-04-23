import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import {
    defaultLocale,
    isLocale,
    LOCALE_COOKIE,
    pickLocaleFromAcceptLanguage,
} from "./config";

export default getRequestConfig(async () => {
    const cookieStore = await cookies();
    const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;

    let locale = isLocale(cookieLocale) ? cookieLocale : undefined;

    if (!locale) {
        const hdrs = await headers();
        locale = pickLocaleFromAcceptLanguage(hdrs.get("accept-language"));
    }

    const resolved = locale ?? defaultLocale;

    const messages = (await import(`../messages/${resolved}.json`)).default;

    return {
        locale: resolved,
        messages,
    };
});
