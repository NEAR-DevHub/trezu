import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Manage Treasuries",
};

export default function ManageTreasuriesLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return children;
}
