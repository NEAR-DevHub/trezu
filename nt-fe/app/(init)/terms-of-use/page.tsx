import type { Metadata } from "next";
import { LegalPage } from "@/features/landing/components/legal-page";

// English-only, like the rest of the marketing pages, so the copy stays out
// of the i18n catalogue.
export const metadata: Metadata = {
    title: "Terms of Use",
    description: "The terms that govern your use of NEAR Business.",
};

export default function TermsOfUsePage() {
    return <LegalPage title={["Terms", "of Use"]} />;
}
