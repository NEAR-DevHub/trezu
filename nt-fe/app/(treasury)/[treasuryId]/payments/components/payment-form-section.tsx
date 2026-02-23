"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { Button } from "@/components/button";
import { useToken, useTokenBalance } from "@/hooks/use-treasury-queries";
import { useTreasury } from "@/hooks/use-treasury";
import { cn, formatBalance, formatCurrency } from "@/lib/utils";
import TokenSelect, { SelectedTokenData } from "@/components/token-select";
import { LargeInput } from "@/components/large-input";
import { InputBlock } from "@/components/input-block";
import { getBlockchainType } from "@/lib/blockchain-utils";
import AccountInput from "@/components/account-input";
import { CreateRequestButton } from "@/components/create-request-button";

interface PaymentFormSectionProps {
    // Token and amount
    selectedToken: SelectedTokenData | null;
    amount: string;
    onAmountChange: (amount: string) => void;
    onTokenChange?: (token: SelectedTokenData) => void;

    // Recipient
    recipient: string;
    onRecipientChange: (recipient: string) => void;

    // Options
    tokenLocked?: boolean;
    showBalance?: boolean;
    validateOnMount?: boolean; // Force validation on mount (for edit screens)

    // Actions
    saveButtonText: string;
    onSave: () => void;
    isSubmitting?: boolean;
}

export function PaymentFormSection({
    selectedToken,
    amount,
    onAmountChange,
    onTokenChange,
    recipient,
    onRecipientChange,
    tokenLocked = false,
    showBalance = true,
    validateOnMount = false,
    saveButtonText,
    onSave,
    isSubmitting = false,
}: PaymentFormSectionProps) {
    const { treasuryId } = useTreasury();
    const [isRecipientValid, setIsRecipientValid] = useState(!!recipient);
    const [isValidatingRecipient, setIsValidatingRecipient] = useState(false);
    const prevBlockchainTypeRef = useRef<string | null>(null);

    // Determine blockchain type from selected token
    const blockchainType = useMemo(() => {
        if (!selectedToken?.network) return "near";
        return getBlockchainType(selectedToken.network);
    }, [selectedToken?.network]);

    // Reset recipient address when blockchain type changes
    useEffect(() => {
        // Skip on initial mount
        if (prevBlockchainTypeRef.current === null) {
            prevBlockchainTypeRef.current = blockchainType;
            return;
        }

        // Only clear if blockchain type actually changed
        if (prevBlockchainTypeRef.current !== blockchainType && recipient) {
            onRecipientChange("");
            setIsRecipientValid(false);
        }

        prevBlockchainTypeRef.current = blockchainType;
    }, [blockchainType, recipient, onRecipientChange]);

    // Get token price for USD estimation
    const { data: tokenData, isLoading: isTokenLoading } = useToken(
        selectedToken?.address || "",
    );
    const { data: tokenBalanceData, isLoading: isTokenBalanceLoading } =
        useTokenBalance(
            treasuryId,
            selectedToken?.address || "",
            selectedToken?.network || "",
        );

    const estimatedUSDValue = useMemo(() => {
        if (
            !tokenData?.price ||
            !amount ||
            isNaN(Number(amount)) ||
            Number(amount) <= 0
        ) {
            return null;
        }
        return Number(amount) * tokenData.price;
    }, [amount, tokenData?.price]);

    // Handle save button click
    const handleSave = () => {
        // Validation is handled by AccountInput component
        if (isRecipientValid && recipient && amount) {
            onSave();
        }
    };

    // Check if save button should be disabled
    const isSaveDisabled =
        !recipient || !amount || !isRecipientValid || isValidatingRecipient;

    return (
        <>
            {/* You send section */}
            <InputBlock
                title="Send"
                invalid={false}
                topRightContent={
                    showBalance &&
                        tokenBalanceData &&
                        selectedToken?.decimals ? (
                        <div className="flex items-center gap-2">
                            <p className="text-xs text-muted-foreground">
                                Balance:{" "}
                                {formatBalance(
                                    tokenBalanceData.balance,
                                    selectedToken.decimals,
                                )}{" "}
                                {selectedToken?.symbol?.toUpperCase()}
                            </p>
                            <Button
                                type="button"
                                variant="secondary"
                                className="bg-muted-foreground/10 hover:bg-muted-foreground/20"
                                size="sm"
                                onClick={() => {
                                    if (
                                        tokenBalanceData &&
                                        selectedToken.decimals
                                    ) {
                                        onAmountChange(
                                            formatBalance(
                                                tokenBalanceData.balance,
                                                selectedToken.decimals,
                                            ),
                                        );
                                    }
                                }}
                            >
                                MAX
                            </Button>
                        </div>
                    ) : null
                }
            >
                <div className="flex justify-between items-center">
                    <div className="flex-1">
                        <LargeInput
                            type="number"
                            borderless
                            onChange={(e) =>
                                onAmountChange(
                                    e.target.value.replace(/^0+(?=\d)/, ""),
                                )
                            }
                            value={amount}
                            placeholder="0"
                            className="text-3xl!"
                        />
                    </div>
                    <TokenSelect
                        disabled={tokenLocked || !onTokenChange}
                        locked={tokenLocked}
                        selectedToken={selectedToken}
                        setSelectedToken={(token) => {
                            if (onTokenChange) {
                                onTokenChange(token);
                            }
                        }}
                    />
                </div>
                <p
                    className={cn(
                        "text-muted-foreground text-xs invisible",
                        estimatedUSDValue !== null &&
                        estimatedUSDValue > 0 &&
                        "visible",
                    )}
                >
                    {!isTokenLoading &&
                        estimatedUSDValue !== null &&
                        estimatedUSDValue > 0
                        ? `≈ ${formatCurrency(estimatedUSDValue)}`
                        : isTokenLoading
                            ? "Loading price..."
                            : "Invisible"}
                </p>
            </InputBlock>

            {/* To section */}
            <InputBlock title="To" invalid={!!recipient && !isRecipientValid}>
                <AccountInput
                    blockchain={blockchainType}
                    value={recipient}
                    setValue={onRecipientChange}
                    setIsValid={setIsRecipientValid}
                    setIsValidating={setIsValidatingRecipient}
                    borderless
                    validateOnMount={validateOnMount}
                />
            </InputBlock>

            {/* Save Button */}
            <CreateRequestButton
                onClick={handleSave}
                disabled={isSaveDisabled}
                isSubmitting={isSubmitting}
                idleMessage={saveButtonText}
                permissions={{
                    kind: "transfer",
                    action: "AddProposal",
                }}
            />
        </>
    );
}
