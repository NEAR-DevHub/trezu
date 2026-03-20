"use client";

import { useState, useEffect, useMemo } from "react";
import {
    Control,
    FieldValues,
    Path,
    PathValue,
    useFormContext,
    useWatch,
} from "react-hook-form";
import { ContactRound, X } from "lucide-react";
import { InputBlock } from "@/components/input-block";
import { TokenInput, Token } from "@/components/token-input";
import AccountInput from "@/components/account-input";
import { CreateRequestButton } from "@/components/create-request-button";
import { getBlockchainType } from "@/lib/blockchain-utils";
import { validateMinimumWithdrawal } from "@/lib/payment-validation";
import { useTreasury } from "@/hooks/use-treasury";
import { useAddressBook, AddressBookEntry } from "@/features/address-book";
import { SelectModal } from "@/app/(treasury)/[treasuryId]/dashboard/components/select-modal";
import { useChains, ChainInfo } from "@/features/address-book/chains";
import { NetworkBadge } from "@/components/network-badge";
import { Button } from "@/components/button";
import { UserWithData } from "@/components/user";
import { useNear } from "@/stores/near-store";

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
    saveButtonText,
    onSave,
    isSubmitting = false,
}: PaymentFormSectionProps<TFieldValues, TTokenPath>) {
    const { setValue, setError, clearErrors } = useFormContext<TFieldValues>();
    const [isRecipientValid, setIsRecipientValid] = useState(false);
    const [isValidatingRecipient, setIsValidatingRecipient] = useState(false);
    const [isContactModalOpen, setIsContactModalOpen] = useState(false);
    const [selectedContact, setSelectedContact] =
        useState<AddressBookEntry | null>(null);

    const { treasuryId } = useTreasury();
    const { data: addressBook = [] } = useAddressBook(treasuryId);
    const { data: chains = [] } = useChains();

    const chainMap = useMemo(() => {
        const map = new Map<string, ChainInfo>();
        for (const chain of chains) map.set(chain.key, chain);
        return map;
    }, [chains]);

    const token = useWatch({ control, name: tokenName }) as Token | null;
    const recipient = useWatch({ control, name: recipientName }) as string;
    const amount = useWatch({ control, name: amountName }) as string;

    const blockchainType = useMemo(() => {
        if (!token?.network) return "near";
        return getBlockchainType(token.network);
    }, [token?.network]);

    // Validate amount against minimum withdrawal for intents tokens
    useEffect(() => {
        clearErrors(amountName);
        if (!amount || !token) return;

        const error = validateMinimumWithdrawal(
            amount,
            token.minWithdrawalAmount,
            token.decimals,
            token.symbol,
        );

        if (error) {
            setError(amountName, { type: "manual", message: error });
        }
    }, [amount, token, amountName, setError, clearErrors]);

    // When a contact is selected, sync the address into the form field
    useEffect(() => {
        if (selectedContact) {
            setValue(
                recipientName,
                selectedContact.address as PathValue<
                    TFieldValues,
                    Path<TFieldValues>
                >,
            );
        }
    }, [selectedContact, recipientName, setValue]);

    // Clear selected contact if it's incompatible with the current blockchain
    useEffect(() => {
        if (!selectedContact) return;
        const isCompatible =
            selectedContact.networks.length === 0 ||
            selectedContact.networks.some(
                (key) => getBlockchainType(key) === blockchainType,
            );
        if (!isCompatible) {
            setSelectedContact(null);
            setValue(
                recipientName,
                "" as PathValue<TFieldValues, Path<TFieldValues>>,
            );
            setIsRecipientValid(false);
        }
    }, [blockchainType, selectedContact, setValue, recipientName]);

    const filteredAddressBook = useMemo(
        () =>
            addressBook.filter(
                (entry) =>
                    entry.networks.length === 0 ||
                    entry.networks.some(
                        (key) => getBlockchainType(key) === blockchainType,
                    ),
            ),
        [addressBook, blockchainType],
    );

    // When recipient is pre-filled (e.g. stepping back from review), check if it matches an address book entry
    useEffect(() => {
        if (!recipient || selectedContact || filteredAddressBook.length === 0)
            return;
        const match = filteredAddressBook.find(
            (e) => e.address.toLowerCase() === recipient.toLowerCase(),
        );
        if (match) setSelectedContact(match);
    }, [recipient, filteredAddressBook, selectedContact]);

    const showContactButton = filteredAddressBook.length > 0;

    const contactOptions = useMemo(
        () =>
            filteredAddressBook.map((entry) => ({
                id: entry.id,
                name: entry.name,
                symbol: entry.address,
                icon: "",
            })),
        [filteredAddressBook],
    );

    const isSaveDisabled =
        !recipient || !isRecipientValid || isValidatingRecipient;

    const handleClearContact = () => {
        setSelectedContact(null);
        setValue(
            recipientName,
            "" as PathValue<TFieldValues, Path<TFieldValues>>,
        );
        setIsRecipientValid(false);
    };

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
                interactive={!selectedContact}
                title="To"
                className="relative"
                invalid={
                    !selectedContact &&
                    !!recipient &&
                    !isRecipientValid &&
                    !isValidatingRecipient
                }
            >
                {selectedContact ? (
                    <div className="flex items-center justify-between gap-2 pt-1">
                        <div className="flex flex-col gap-1 min-w-0">
                            <UserWithData
                                name={selectedContact.name}
                                address={selectedContact.address}
                                size="md"
                                withLink={false}
                            />
                            {selectedContact.networks.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                    {selectedContact.networks
                                        .map((key) => chainMap.get(key))
                                        .filter(Boolean)
                                        .map((chain) => (
                                            <NetworkBadge
                                                key={chain!.key}
                                                name={chain!.name}
                                                iconDark={chain!.iconDark}
                                                iconLight={chain!.iconLight}
                                                size="sm"
                                            />
                                        ))}
                                </div>
                            )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                            <Button
                                variant="card"
                                size="icon-sm"
                                onClick={() => setIsContactModalOpen(true)}
                                type="button"
                            >
                                <ContactRound className="size-4" />
                            </Button>
                            <Button
                                variant="secondary"
                                size="icon-sm"
                                onClick={handleClearContact}
                                type="button"
                            >
                                <X className="size-3.5" />
                            </Button>
                        </div>
                    </div>
                ) : (
                    <>
                        <AccountInput
                            key={blockchainType}
                            blockchain={blockchainType}
                            value={recipient}
                            setValue={(val) =>
                                setValue(
                                    recipientName,
                                    val as PathValue<
                                        TFieldValues,
                                        Path<TFieldValues>
                                    >,
                                )
                            }
                            setIsValid={setIsRecipientValid}
                            setIsValidating={setIsValidatingRecipient}
                            borderless
                            validateOnMount={!!recipient}
                        />
                        {showContactButton && (
                            <Button
                                variant="card"
                                size="icon-sm"
                                className="absolute top-1/2 -translate-y-1/2 right-3"
                                onClick={() => setIsContactModalOpen(true)}
                                type="button"
                            >
                                <ContactRound className="size-4" />
                            </Button>
                        )}
                    </>
                )}
                {selectedContact && (
                    <div className="hidden" aria-hidden>
                        <AccountInput
                            key={`${recipient}-${blockchainType}`}
                            blockchain={blockchainType}
                            value={recipient}
                            setValue={() => {}}
                            setIsValid={setIsRecipientValid}
                            setIsValidating={setIsValidatingRecipient}
                            borderless
                            validateOnMount
                        />
                    </div>
                )}
            </InputBlock>

            <SelectModal
                isOpen={isContactModalOpen}
                onClose={() => setIsContactModalOpen(false)}
                title="Select Recipient"
                options={contactOptions}
                searchPlaceholder="Search by name or address"
                onSelect={(option) => {
                    const entry = filteredAddressBook.find(
                        (e) => e.id === option.id,
                    );
                    if (entry) setSelectedContact(entry);
                    setIsContactModalOpen(false);
                }}
                renderIcon={() => null}
                renderContent={(option) => {
                    const entry = filteredAddressBook.find(
                        (e) => e.id === option.id,
                    );
                    if (!entry) return null;
                    const entryChains = entry.networks
                        .map((key) => chainMap.get(key))
                        .filter(Boolean) as ChainInfo[];
                    return (
                        <div className="flex items-center justify-between w-full gap-2">
                            <UserWithData
                                name={entry.name}
                                address={entry.address}
                                size="sm"
                                withLink={false}
                            />
                            {entryChains.length > 0 && (
                                <div className="flex items-center gap-3.5 shrink-0">
                                    {entryChains.map((chain) => (
                                        <NetworkBadge
                                            key={chain.key}
                                            name={chain.name}
                                            iconDark={chain.iconDark}
                                            iconLight={chain.iconLight}
                                            variant="secondary"
                                            size="icon"
                                            iconOnly
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                }}
            />

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
