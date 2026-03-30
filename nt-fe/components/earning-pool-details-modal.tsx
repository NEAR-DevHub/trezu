"use client";

import { Button } from "@/components/button";
import { InfoDisplay, type InfoItem } from "@/components/info-display";
import { Info } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/modal";
import type { TreasuryAsset } from "@/lib/api";
import Big from "@/lib/big";
import { formatBalance } from "@/lib/utils";
import { AmountSummary } from "./amount-summary";
import { useStakingValidator } from "@/hooks/use-staking-validator";
import { Skeleton } from "@/components/ui/skeleton";

interface EarningPoolDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    asset: TreasuryAsset | null;
    poolId: string | null;
}

export function EarningPoolDetailsModal({
    isOpen,
    onClose,
    asset,
    poolId,
}: EarningPoolDetailsModalProps) {
    if (!asset) return null;

    const stakingBalance =
        asset.balance.type === "Staked" ? asset.balance.staking : null;
    const lockupBalance =
        asset.balance.type === "Vested" ? asset.balance.lockup : null;
    const isDaoStaking = !!stakingBalance;
    const isLockupStaking = !!lockupBalance && lockupBalance.staked.gt(0);
    if (!isDaoStaking && !isLockupStaking) return null;

    const selectedPool = isDaoStaking
        ? stakingBalance?.pools.find((pool) => pool.poolId === poolId)
        : null;
    if (isDaoStaking && !selectedPool) return null;

    const lockupPoolId = isLockupStaking
        ? (lockupBalance?.stakingPoolId ?? "Lockup staking pool")
        : null;
    const resolvedPoolId = isDaoStaking
        ? (selectedPool?.poolId ?? null)
        : lockupPoolId;
    const validatorPoolId =
        resolvedPoolId && resolvedPoolId.includes(".") ? resolvedPoolId : null;

    const {
        data: validatorDetails,
        isLoading,
        isFetching,
    } = useStakingValidator(isOpen ? validatorPoolId : null);
    const isValidatorMetaLoading =
        !!validatorPoolId && (isLoading || isFetching);

    const stakedBalance = isDaoStaking
        ? (selectedPool?.stakedBalance ?? Big(0))
        : (lockupBalance?.staked ?? Big(0));
    const unstakedBalance = isDaoStaking
        ? (selectedPool?.unstakedBalance ?? Big(0))
        : (lockupBalance?.unstakedBalance ?? Big(0));
    const canWithdraw = isDaoStaking
        ? (selectedPool?.canWithdraw ?? false)
        : (lockupBalance?.canWithdraw ?? false);

    const poolTotal = stakedBalance.add(unstakedBalance);
    const pendingRelease = canWithdraw ? Big(0) : unstakedBalance;
    const availableForWithdraw = canWithdraw ? unstakedBalance : Big(0);

    const formatTokenBalance = (balance: Big) =>
        Big(formatBalance(balance, asset.decimals)).toString();

    const summaryUsd = poolTotal
        .div(Big(10).pow(asset.decimals))
        .mul(asset.price)
        .toNumber();

    const overviewItems: InfoItem[] = [
        {
            label: "Pending Release",
            value: `${formatTokenBalance(pendingRelease)} ${asset.symbol}`,
        },
        {
            label: "Available For Withdrawal",
            value: `${formatTokenBalance(availableForWithdraw)} ${asset.symbol}`,
        },
    ];

    const poolMetaItems: InfoItem[] = [
        {
            label: "APY",
            value: isValidatorMetaLoading ? (
                <Skeleton className="h-4 w-16" />
            ) : validatorDetails?.apy !== undefined ? (
                <span className="text-general-success-foreground">
                    {validatorDetails.apy.toFixed(2)}%
                </span>
            ) : (
                "N/A"
            ),
        },
        {
            label: "Fee",
            value: isValidatorMetaLoading ? (
                <Skeleton className="h-4 w-16" />
            ) : validatorDetails?.feePercent !== undefined ? (
                `${validatorDetails.feePercent.toFixed(2)}%`
            ) : (
                "N/A"
            ),
        },
    ];

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Earning Details</DialogTitle>
                </DialogHeader>

                <div className="flex flex-col gap-6">
                    <AmountSummary
                        title="Balance"
                        total={formatTokenBalance(poolTotal)}
                        totalUSD={summaryUsd}
                        token={{
                            address: asset.contractId || "",
                            symbol: asset.symbol,
                            decimals: asset.decimals,
                            name: asset.name,
                            icon: asset.icon,
                            network: asset.network,
                        }}
                    />

                    {isLockupStaking ? (
                        <div className="rounded-xl bg-muted/60 px-4 py-3 text-sm flex items-start gap-2">
                            <Info className="size-4 text-muted-foreground mt-0.5 shrink-0" />
                            <p className="text-foreground">
                                All assets in this position are from your
                                lockup. After you stop earning, some tokens may
                                still be locked and unavailable - check your
                                lockup schedule to see when they unlock.
                            </p>
                        </div>
                    ) : null}

                    <InfoDisplay
                        items={overviewItems}
                        hideSeparator
                        size="sm"
                    />
                    <div className="flex flex-col gap-2">
                        <div className="text-sm font-semibold">
                            {resolvedPoolId}
                        </div>
                        <InfoDisplay
                            items={poolMetaItems}
                            hideSeparator
                            size="sm"
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button
                        className="w-full"
                        disabled
                        tooltipContent="Coming soon"
                    >
                        Go To Earn
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
