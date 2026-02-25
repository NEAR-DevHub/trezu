import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Vesting",
};

export default function VestingLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return children;
}
