import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "../globals.css";
import { GoogleAnalytics } from "@/components/google-analytics";
import { GleapWidget } from "@/components/gleap-widget";
import { Toaster } from "@/components/toaster";

const geistSans = Geist({
    variable: "--font-geist-sans",
    subsets: ["latin"],
});

const geistMono = Geist_Mono({
    variable: "--font-geist-mono",
    subsets: ["latin"],
});

export const metadata: Metadata = {
    title: {
        default: "Trezu | Cross-chain Treasury Management",
        template: "%s | Trezu",
    },
    description:
        "Manage your team's capital in minutes from a single dashboard without ever giving up your keys.",
    openGraph: {
        title: "Trezu | One multisig. Any crypto. Total control.",
        description:
            "Manage your team's capital in minutes from a single dashboard without ever giving up your keys.",
        images: [
            "https://framerusercontent.com/assets/3H8WN4PxElLu7XMiyq7jbNMH8es.png",
        ],
    },
    twitter: {
        card: "summary_large_image",
        title: "Trezu | One multisig. Any crypto. Total control.",
        description:
            "Manage your team's capital in minutes from a single dashboard without ever giving up your keys.",
        images: [
            "https://framerusercontent.com/assets/3H8WN4PxElLu7XMiyq7jbNMH8es.png",
        ],
    },
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html
            lang="en"
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
                {children}
                <Toaster />
                <GoogleAnalytics />
                <GleapWidget />
            </body>
        </html>
    );
}
