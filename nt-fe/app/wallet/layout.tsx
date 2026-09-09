import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { getLocaleDirection } from "@/i18n/config";
import "../globals.css";
import { QueryProvider } from "@/components/query-provider";
import { figtree } from "@/lib/fonts";

export { generateMetadata } from "@/lib/metadata";

export default async function WalletLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const locale = await getLocale();
    const messages = await getMessages();
    const dir = getLocaleDirection(locale);

    return (
        <html
            lang={locale}
            dir={dir}
            suppressHydrationWarning
            className={figtree.variable}
        >
            <body
                className={`${figtree.variable} antialiased bg-background text-foreground`}
            >
                <NextIntlClientProvider locale={locale} messages={messages}>
                    <QueryProvider>{children}</QueryProvider>
                </NextIntlClientProvider>
            </body>
        </html>
    );
}
