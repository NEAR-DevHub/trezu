import type { Metadata } from "next";
import { LegalPage } from "@/features/landing/components/legal-page";

// English-only, like the rest of the marketing pages, so the copy stays out
// of the i18n catalogue.
export const metadata: Metadata = {
    title: "Privacy Policy",
    description: "How NEAR Business handles your data.",
};

export default function PrivacyPolicyPage() {
    return <LegalPage title={["Privacy", "Policy"]} />;
}
