"use client";

import { useTranslations } from "next-intl";
import { EmptyState } from "./empty-state";
import { TreasuryTypeIcon } from "./icons/shield";

export function ConfidentialState({
    skeleton,
}: {
    skeleton?: React.ReactNode;
}) {
    const t = useTranslations("confidentialState");
    return (
        <div className="relative **:data-[slot=skeleton]:animate-none!">
            {skeleton}
            <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 flex items-center justify-center max-h-[96px]">
                <EmptyState
                    icon={<TreasuryTypeIcon type="confidential" />}
                    title={t("title")}
                    description={t("description")}
                />
            </div>
        </div>
    );
}
