import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { getLocaleDirection, isLocale } from "@/i18n/config";
import "../globals.css";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("blocked");
    return {
        title: `${t("title")} | Trezu`,
        description: t("description"),
        robots: "noindex, nofollow",
    };
}

export default async function BlockedLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const locale = await getLocale();
    const messages = await getMessages();
    const dir = isLocale(locale) ? getLocaleDirection(locale) : "ltr";

    return (
        <html lang={locale} dir={dir}>
            <body>
                <NextIntlClientProvider locale={locale} messages={messages}>
                    {children}
                </NextIntlClientProvider>
            </body>
        </html>
    );
}
