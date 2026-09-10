import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { getLocaleDirection } from "@/i18n/config";
import "../globals.css";
import { GoogleAnalytics } from "@/components/google-analytics";
import { GoogleTagManager } from "@/components/google-tag-manager";
import { QueryProvider } from "@/components/query-provider";
import { SupportChatWidget } from "@/components/support-chat-widget";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/toaster";
import { WarningsProvider } from "@/components/warnings-provider";
import { figtree } from "@/lib/fonts";

export { generateMetadata } from "@/lib/metadata";

export default async function RootLayout({
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
                    <ThemeProvider>
                        <QueryProvider>
                            <WarningsProvider>
                                {children}
                                <Toaster />
                                <GoogleAnalytics />
                                <GoogleTagManager />
                            </WarningsProvider>
                        </QueryProvider>
                        <SupportChatWidget />
                    </ThemeProvider>
                </NextIntlClientProvider>
            </body>
        </html>
    );
}
