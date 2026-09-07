"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/modal";
import { TreasuryBalance, TreasuryLogo } from "@/components/treasury-info";
import { Skeleton } from "@/components/ui/skeleton";
import type { Treasury } from "@/lib/api";

interface DepositPayTreasuryModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    treasuries: Treasury[];
    /** Destination treasury — excluded so users don't pay into themselves. */
    excludeTreasuryId?: string;
    /** Confidential share: only list confidential member treasuries. */
    confidentialOnly?: boolean;
    isLoading?: boolean;
    onSelect: (daoId: string) => void;
}

export function DepositPayTreasuryModal({
    open,
    onOpenChange,
    treasuries,
    excludeTreasuryId,
    confidentialOnly = false,
    isLoading = false,
    onSelect,
}: DepositPayTreasuryModalProps) {
    const t = useTranslations("depositModal.transfer");
    const memberTreasuries = treasuries.filter((treasury) => {
        if (!treasury.isMember) return false;
        if (treasury.daoId === excludeTreasuryId) return false;
        if (confidentialOnly && !treasury.isConfidential) return false;
        return true;
    });

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                data-testid="deposit-pay-treasury-modal"
                className="min-h-0 gap-0 overflow-hidden sm:h-auto sm:max-h-[min(42rem,90vh)] sm:w-full sm:max-w-md!"
            >
                <DialogHeader
                    centerTitle={false}
                    className="sticky top-0 border-0 pb-0 text-left"
                >
                    <DialogTitle className="pr-8 text-left text-lg font-semibold">
                        {t("chooseTreasuryTitle")}
                    </DialogTitle>
                </DialogHeader>

                <div className="mt-4 flex min-h-0 flex-1 flex-col sm:mt-0">
                    {isLoading ? (
                        <div className="space-y-2">
                            <Skeleton className="h-14 w-full rounded-xl" />
                            <Skeleton className="h-14 w-full rounded-xl" />
                            <Skeleton className="h-14 w-full rounded-xl" />
                        </div>
                    ) : memberTreasuries.length === 0 ? (
                        <div className="rounded-xl bg-muted px-4 py-5 space-y-3 text-center">
                            <p className="text-sm text-muted-foreground">
                                {t("noMemberTreasuries")}
                            </p>
                            <Button
                                asChild
                                variant="secondary"
                                className="w-full"
                            >
                                <Link href="/create">
                                    {t("createTreasury")}
                                </Link>
                            </Button>
                        </div>
                    ) : (
                        <div className="min-h-0 flex-1 overflow-y-auto sm:max-h-140">
                            {memberTreasuries.map((treasury) => (
                                <button
                                    key={treasury.daoId}
                                    type="button"
                                    onClick={() => onSelect(treasury.daoId)}
                                    className="flex w-full cursor-pointer items-center gap-3 rounded-lg bg-transparent px-3 py-2.5 text-left transition-colors hover:bg-muted"
                                    data-testid="deposit-pay-treasury-option"
                                    data-dao-id={treasury.daoId}
                                >
                                    <TreasuryLogo
                                        logo={
                                            treasury.config?.metadata?.flagLogo
                                        }
                                        isConfidential={treasury.isConfidential}
                                        alt={
                                            treasury.config?.name ||
                                            treasury.daoId
                                        }
                                        imageClassName="size-9 rounded-full"
                                        fallbackClassName="size-9 rounded-full bg-green-700"
                                        fallbackIconClassName="size-5 text-white"
                                    />
                                    <div className="flex min-w-0 flex-col">
                                        <span className="truncate text-sm font-semibold">
                                            {treasury.config?.name ||
                                                treasury.daoId}
                                        </span>
                                        {/* Members see balances on confidential treasuries too. */}
                                        <TreasuryBalance
                                            daoId={treasury.daoId}
                                            className="text-xs"
                                            skeletonClassName="h-3 w-16"
                                        />
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
