import { LegalMarkdownPage } from "@/components/legal-markdown-page";
import fs from "node:fs";
import path from "node:path";

export default function TermsPage() {
    const content = fs.readFileSync(
        path.join(process.cwd(), "app/(init)/terms/terms-content.md"),
        "utf8",
    );

    return <LegalMarkdownPage title="Terms of Service" content={content} />;
}
