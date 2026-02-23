import { PageCard } from "@/components/card";
import { LegalPageLayout } from "@/components/legal-page-layout";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";

interface LegalMarkdownPageProps {
    title: string;
    content: string;
}

export function LegalMarkdownPage({ title, content }: LegalMarkdownPageProps) {
    return (
        <LegalPageLayout title={title}>
            <PageCard className="max-w-4xl mx-auto">
                <article className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
                    <ReactMarkdown rehypePlugins={[rehypeRaw]}>
                        {content}
                    </ReactMarkdown>
                </article>
            </PageCard>
        </LegalPageLayout>
    );
}
