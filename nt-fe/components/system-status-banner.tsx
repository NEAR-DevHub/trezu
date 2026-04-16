"use client";

import { useSystemStatus } from "@/hooks/use-system-status";
import { WarningAlert } from "@/components/warning-alert";
import { cn } from "@/lib/utils";

interface SystemStatusBannerProps {
    className?: string;
    isSidebar?: boolean;
}

function stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, "").trim();
}

export function SystemStatusBanner({
    className,
    isSidebar,
}: SystemStatusBannerProps) {
    const { data: posts } = useSystemStatus();

    if (!posts?.length) return null;

    return (
        <div className={cn("flex flex-col gap-2", className)}>
            {posts.map((post) => (
                <WarningAlert
                    className={cn(isSidebar && "flex-col gap-2")}
                    key={post.id}
                    title="Under Maintenance"
                    message={
                        "We’re currently performing maintenance. Some features may be temporarily unavailable. Please check back soon."
                    }
                />
            ))}
        </div>
    );
}
