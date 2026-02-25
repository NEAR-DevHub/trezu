import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Privacy Policy",
};

export default function PrivacyLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return children;
}
