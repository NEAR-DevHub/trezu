import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import "../globals.css";
import { GleapWidget } from "@/components/gleap-widget";
import { GoogleAnalytics } from "@/components/google-analytics";
import { Toaster } from "@/components/toaster";

const geistSans = Geist({
    variable: "--font-geist-sans",
    subsets: ["latin"],
});

const geistMono = Geist_Mono({
    variable: "--font-geist-mono",
    subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("metadata");
    return {
        title: {
            default: t("landingTitle"),
            template: "%s | Trezu",
        },
        description: t("description"),
        openGraph: {
            title: t("ogTitle"),
            description: t("description"),
            images: [
                "https://framerusercontent.com/assets/3H8WN4PxElLu7XMiyq7jbNMH8es.png",
            ],
        },
        twitter: {
            card: "summary_large_image",
            title: t("ogTitle"),
            description: t("description"),
            images: [
                "https://framerusercontent.com/assets/3H8WN4PxElLu7XMiyq7jbNMH8es.png",
            ],
        },
    };
}

export default async function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const locale = await getLocale();
    const messages = await getMessages();

    return (
        <html
            lang={locale}
            suppressHydrationWarning
            className={`${geistSans.variable} ${geistMono.variable}`}
        >
            <head>
                <link
                    rel="icon"
                    href="/favicon_light.svg"
                    type="image/svg+xml"
                    media="(prefers-color-scheme: light)"
                />
                <link
                    rel="icon"
                    href="/favicon_dark.svg"
                    type="image/svg+xml"
                    media="(prefers-color-scheme: dark)"
                />
            </head>
            <body
                className={`${geistSans.variable} ${geistMono.variable} antialiased`}
            >
                <NextIntlClientProvider locale={locale} messages={messages}>
                    {children}
                    <Toaster />
                    <GoogleAnalytics />
                    <GleapWidget />
                </NextIntlClientProvider>
            </body>
        </html>
    );
}
