import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { getLocaleDirection } from "@/i18n/config";
import "../globals.css";
import { generateMetadata as sharedMetadata } from "@/lib/metadata";

export async function generateMetadata(): Promise<Metadata> {
    // The geo-block interstitial carries the same metadata as every other page,
    // but must stay out of search results.
    return { ...(await sharedMetadata()), robots: "noindex, nofollow" };
}

export default async function BlockedLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const locale = await getLocale();
    const messages = await getMessages();
    const dir = getLocaleDirection(locale);

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
