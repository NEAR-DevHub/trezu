"use client";

import { useSystemStatus } from "@/hooks/use-system-status";
import { WarningAlert } from "@/components/warning-alert";
import { cn } from "@/lib/utils";

interface SystemStatusBannerProps {
    className?: string;
}

function stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, "").trim();
}

export function SystemStatusBanner({ className }: SystemStatusBannerProps) {
    const { data: posts } = useSystemStatus();

    if (!posts?.length) return null;

    return (
        <div className={cn("flex flex-col gap-2", className)}>
            {posts.map((post) => (
                <WarningAlert
                    key={post.id}
                    title={post.title}
                    message={stripHtml(post.message)}
                />
            ))}
        </div>
    );
}
