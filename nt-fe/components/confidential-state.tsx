import { Shield } from "lucide-react";
import { EmptyState } from "./empty-state";

export function ConfidentialState({
    skeleton,
}: {
    skeleton?: React.ReactNode;
}) {
    return (
        <div className="relative **:data-[slot=skeleton]:animate-none!">
            {skeleton}
            <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2">
                <EmptyState
                    icon={<Shield className="size-4 text-white" />}
                    title="Confidential"
                    description="Only treasury members have access."
                    className="py-0"
                    iconWrapperClassName="size-10 bg-black"
                    descriptionClassName="whitespace-nowrap"
                />
            </div>
        </div>
    );
}
