"use client";

import { prettyJson } from "../format";

/** Read-only pretty JSON block for raw sections and generic tx fields. */
export function JsonBlock({ value }: { value: unknown }) {
    return (
        <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 text-xs max-h-[420px] max-w-full min-w-0">
            <code className="text-foreground/90 whitespace-pre-wrap break-all wrap-anywhere">
                {prettyJson(value)}
            </code>
        </pre>
    );
}
