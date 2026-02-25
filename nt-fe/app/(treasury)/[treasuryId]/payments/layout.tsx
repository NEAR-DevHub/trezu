import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Payments",
};

export default function PaymentsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return children;
}
