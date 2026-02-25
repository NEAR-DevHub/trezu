import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Exchange",
};

export default function ExchangeLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return children;
}
