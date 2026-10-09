"use client";

import { Button } from "@/components/button";
import { useTranslations } from "next-intl";
import { useProposals } from "@/hooks/use-proposals";
import { useTreasury } from "@/hooks/use-treasury";
import { useRouter } from "next/navigation";

interface PendingButtonProps {
    /** High-level category types from backend: "Payments", "Exchange", "Change Policy", etc. */
    types?: string[];
    id?: string;
}

/** Pending proposals shown by `PendingButton`; shares its query cache. */
export function usePendingProposals(types?: string[]) {
    const { treasuryId } = useTreasury();
    return useProposals(treasuryId, {
        statuses: ["InProgress"],
        types,
        sort_direction: "desc",
        sort_by: "CreationTime",
    });
}

export function PendingButton({ types, id }: PendingButtonProps) {
    const t = useTranslations("proposals.status");
    const { treasuryId } = useTreasury();
    const router = useRouter();

    const { data: pendingProposals } = usePendingProposals(types);

    return (
        <Button
            id={id}
            type="button"
            onClick={() =>
                router.push(`/${treasuryId}/requests?tab=InProgress`)
            }
            variant="ghost"
            className="flex items-center gap-2 border-2"
        >
            {t("pending")}
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs">
                {pendingProposals?.proposals?.length || 0}
            </span>
        </Button>
    );
}
