"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import {
    Control,
    FieldValues,
    Path,
    PathValue,
    useFormContext,
    useWatch,
} from "react-hook-form";
import { InputBlock } from "@/components/input-block";
import { TokenInput, Token } from "@/components/token-input";
import AccountInput from "@/components/account-input";
import { CreateRequestButton } from "@/components/create-request-button";
import { getBlockchainType } from "@/lib/blockchain-utils";

interface PaymentFormSectionProps<
    TFieldValues extends FieldValues = FieldValues,
    TTokenPath extends Path<TFieldValues> = Path<TFieldValues>,
> {
    control: Control<TFieldValues>;
    amountName: Path<TFieldValues>;
    tokenName: TTokenPath extends Path<TFieldValues>
        ? PathValue<TFieldValues, TTokenPath> extends Token
            ? TTokenPath
            : never
        : never;
    recipientName: Path<TFieldValues>;

    tokenLocked?: boolean;
    validateOnMount?: boolean;

    saveButtonText: string;
    onSave: () => void;
    isSubmitting?: boolean;
}

export function PaymentFormSection<
    TFieldValues extends FieldValues = FieldValues,
    TTokenPath extends Path<TFieldValues> = Path<TFieldValues>,
>({
    control,
    amountName,
    tokenName,
    recipientName,
    tokenLocked = false,
    validateOnMount = false,
    saveButtonText,
    onSave,
    isSubmitting = false,
}: PaymentFormSectionProps<TFieldValues, TTokenPath>) {
    const { setValue } = useFormContext<TFieldValues>();
    const [isRecipientValid, setIsRecipientValid] = useState(false);
    const [isValidatingRecipient, setIsValidatingRecipient] = useState(false);
    const prevBlockchainTypeRef = useRef<string | null>(null);

    const token = useWatch({ control, name: tokenName }) as Token | null;
    const recipient = useWatch({ control, name: recipientName }) as string;

    const blockchainType = useMemo(() => {
        if (!token?.network) return "near";
        return getBlockchainType(token.network);
    }, [token?.network]);

    // On first render, pre-seed validity for edit screens with a filled value
    useEffect(() => {
        if (prevBlockchainTypeRef.current === null) {
            setIsRecipientValid(!!recipient);
            prevBlockchainTypeRef.current = blockchainType;
            return;
        }

        // Blockchain type changed — clear validity so AccountInput re-validates
        if (prevBlockchainTypeRef.current !== blockchainType) {
            setIsRecipientValid(false);
        }

        prevBlockchainTypeRef.current = blockchainType;
    }, [blockchainType, recipient]);

    const isSaveDisabled =
        !recipient || !isRecipientValid || isValidatingRecipient;

    return (
        <>
            <TokenInput
                control={control}
                title="Send"
                amountName={amountName}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                tokenName={tokenName as any}
                tokenSelect={{
                    locked: tokenLocked,
                    disabled: tokenLocked,
                    showOnlyOwnedAssets: false,
                }}
                showInsufficientBalance={true}
                dynamicFontSize={true}
            />

            <InputBlock
                interactive
                title="To"
                invalid={!!recipient && !isRecipientValid}
            >
                <AccountInput
                    blockchain={blockchainType}
                    value={recipient}
                    setValue={(val) =>
                        setValue(
                            recipientName,
                            val as PathValue<TFieldValues, Path<TFieldValues>>,
                        )
                    }
                    setIsValid={setIsRecipientValid}
                    setIsValidating={setIsValidatingRecipient}
                    borderless
                    validateOnMount={validateOnMount}
                />
            </InputBlock>

            <CreateRequestButton
                onClick={onSave}
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
