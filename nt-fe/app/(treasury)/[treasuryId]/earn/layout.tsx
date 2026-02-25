import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Earn",
};

export default function EarnLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return children;
}
