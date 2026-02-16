import type { SubscriptionStatus } from "@/lib/subscription-api";
import {
    getBatchPaymentCreditLimit,
    isTrialPlan,
} from "@/lib/subscription-api";
import { Button } from "@/components/button";
import { CreditsQuotaDisplay } from "@/components/credits-quota-display";

interface BulkPaymentCreditsDisplayProps {
    credits: {
        creditsAvailable: number;
        creditsUsed: number;
        totalCredits: number;
    };
    subscription: SubscriptionStatus;
}

/**
 * Component to display bulk payment credits status with plan information
 * Shows progress bar, credit counts, and appropriate info messages
 */
export function BulkPaymentCreditsDisplay({
    credits,
    subscription,
}: BulkPaymentCreditsDisplayProps) {
    const { creditsAvailable, creditsUsed, totalCredits } = credits;
    const batchPaymentCreditLimit = getBatchPaymentCreditLimit(
        subscription.planConfig,
    );
    const isTrial = isTrialPlan(subscription.planConfig);
    const isFree = subscription.planType === "free";

    const isUnlimited = batchPaymentCreditLimit === null;

    // Format period display
    const periodDisplay = isTrial ? "one-time trial" : "month";

    return (
        <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Bulk Payments</h3>
                <span className="text-sm font-medium border py-1 px-2 rounded-lg border-general-border bg-general-unofficial-outline">
                    {isUnlimited
                        ? "Unlimited"
                        : `${batchPaymentCreditLimit || totalCredits} / ${periodDisplay}`}
                </span>
            </div>

            {/* Credits Display - Only show if not unlimited */}
            {!isUnlimited && (
                <CreditsQuotaDisplay
                    creditsAvailable={creditsAvailable}
                    creditsUsed={creditsUsed}
                    creditsTotal={batchPaymentCreditLimit || totalCredits}
                    creditsResetAt={subscription.creditsResetAt}
                    isFree={isFree}
                    isUnlimited={isUnlimited}
                />
            )}

            {/* Upgrade CTA - Only show if not unlimited */}
            {!isUnlimited && (
                <div className="flex items-center justify-between">
                    <span className="text-sm text-secondary-foreground">
                        Looking for more flexibility?
                    </span>
                    <Button
                        variant="default"
                        className="px-2! py-3!"
                        size='sm'
                    >
                        Contact Us
                    </Button>
                </div>
            )}
        </div>
    );
}
