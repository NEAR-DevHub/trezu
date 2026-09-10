import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { getLocaleDirection } from "@/i18n/config";
import "../../globals.css";
import { AuthProvider } from "@/components/auth-provider";
import { NearInitializer } from "@/components/near-initializer";
import { QueryProvider } from "@/components/query-provider";
import { Toaster } from "@/components/toaster";
import { WarningsProvider } from "@/components/warnings-provider";
import { figtree } from "@/lib/fonts";

export { generateMetadata } from "@/lib/metadata";

export default async function JoinLayout({
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
            <body className={`${figtree.variable} antialiased`}>
                <NextIntlClientProvider locale={locale} messages={messages}>
                    <QueryProvider>
                        <WarningsProvider>
                            <NearInitializer />
                            <AuthProvider>{children}</AuthProvider>
                            <Toaster />
                        </WarningsProvider>
                    </QueryProvider>
                </NextIntlClientProvider>
            </body>
        </html>
    );
}
