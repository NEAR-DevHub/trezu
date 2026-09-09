"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/button";
import { NumberBadge } from "@/components/number-badge";
import { useProposals } from "@/hooks/use-proposals";
import { useTreasury } from "@/hooks/use-treasury";

interface PendingButtonProps {
    /** High-level category types from backend: "Payments", "Exchange", "Change Policy", etc. */
    types?: string[];
    id?: string;
}

export function PendingButton({ types, id }: PendingButtonProps) {
    const t = useTranslations("proposals.status");
    const { treasuryId } = useTreasury();
    const router = useRouter();

    const { data: pendingProposals } = useProposals(treasuryId, {
        statuses: ["InProgress"],
        types,
        sort_direction: "desc",
        sort_by: "CreationTime",
    });

    const count = pendingProposals?.proposals?.length ?? 0;
    if (count === 0) return null;

    return (
        <Button
            id={id}
            type="button"
            onClick={() =>
                router.push(`/${treasuryId}/requests?tab=InProgress`)
            }
            variant="pill"
            className="gap-2"
        >
            {t("pending")}
            <NumberBadge number={count} shape="pill" />
        </Button>
    );
}
