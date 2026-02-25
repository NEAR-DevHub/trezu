import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Create Treasury",
};

export default function NewTreasuryLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return children;
}
