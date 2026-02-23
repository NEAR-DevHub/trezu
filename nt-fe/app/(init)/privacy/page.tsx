import { LegalMarkdownPage } from "@/components/legal-markdown-page";
import fs from "node:fs";
import path from "node:path";

export default function PrivacyPage() {
    const content = fs.readFileSync(
        path.join(process.cwd(), "app/(init)/privacy/privacy-content.md"),
        "utf8",
    );

    return <LegalMarkdownPage title="Privacy Policy" content={content} />;
}
