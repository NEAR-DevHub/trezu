"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useTranslations } from "next-intl";
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
import { InfoAlert } from "@/components/info-alert";
import { getBlockchainType } from "@/lib/blockchain-utils";
import { useTreasury } from "@/hooks/use-treasury";
import { useAddressBook, AddressBookEntry } from "@/features/address-book";
import { SelectModal } from "@/app/(treasury)/[treasuryId]/dashboard/components/select-modal";
import { useChains, ChainInfo } from "@/features/address-book/chains";
import { NetworkList } from "@/components/network-list";
import { Button } from "@/components/button";
import { UserWithData } from "@/components/user";

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
    feeErrorMessage?: string | null;

    saveButtonText: string;
    onSave: () => void;
    isSubmitting?: boolean;
    validatedRecipients?: React.MutableRefObject<Set<string>>;
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
    feeErrorMessage = null,
    saveButtonText,
    onSave,
    isSubmitting = false,
    validatedRecipients,
}: PaymentFormSectionProps<TFieldValues, TTokenPath>) {
    const t = useTranslations("paymentFormSection");
    const { setValue, setError, clearErrors } = useFormContext<TFieldValues>();
    const [isRecipientValid, setIsRecipientValid] = useState(false);
    const [isValidatingRecipient, setIsValidatingRecipient] = useState(false);
    const [isContactModalOpen, setIsContactModalOpen] = useState(false);
    const [selectedContact, setSelectedContact] =
        useState<AddressBookEntry | null>(null);

    const { data: addressBook = [] } = useAddressBook();
    const { data: chains = [] } = useChains();

    const chainMap = useMemo(() => {
        const map = new Map<string, ChainInfo>();
        for (const chain of chains) map.set(chain.key, chain);
        return map;
    }, [chains]);

    const token = useWatch({ control, name: tokenName }) as Token | null;
    const recipient = useWatch({ control, name: recipientName }) as string;
    const setRecipientValue = useCallback(
        (value: PathValue<TFieldValues, Path<TFieldValues>>) => {
            setValue(recipientName, value, {
                shouldDirty: true,
                shouldTouch: true,
                shouldValidate: true,
            });
        },
        [recipientName, setValue],
    );

    const { isConfidential } = useTreasury();

    const blockchainType = useMemo(() => {
        // Confidential payments always target NEAR accounts
        if (isConfidential) return "near";
        if (!token?.network) return "near";
        return getBlockchainType(token.network);
    }, [token?.network, isConfidential]);

    const recipientCacheKey = useMemo(
        () => `${blockchainType}:${(recipient || "").trim().toLowerCase()}`,
        [blockchainType, recipient],
    );
    const hasCachedValidRecipient =
        !!recipient && !!validatedRecipients?.current.has(recipientCacheKey);

    // Restore cached validation on remount (e.g. stepping back from review).
    useEffect(() => {
        if (!hasCachedValidRecipient) return;
        setIsValidatingRecipient(false);
        setIsRecipientValid(true);
    }, [hasCachedValidRecipient]);

    // Cache successful validations so they survive remount.
    useEffect(() => {
        if (!recipient || !isRecipientValid || isValidatingRecipient) return;
        validatedRecipients?.current.add(recipientCacheKey);
    }, [
        recipient,
        isRecipientValid,
        isValidatingRecipient,
        recipientCacheKey,
        validatedRecipients,
    ]);

    // Sync fee coverage error into the amount field.
    useEffect(() => {
        if (!feeErrorMessage) {
            clearErrors(amountName);
            return;
        }

        setError(amountName, { type: "manual", message: feeErrorMessage });
    }, [amountName, clearErrors, feeErrorMessage, setError]);

    // When a contact is selected, sync the address into the form field
    useEffect(() => {
        if (selectedContact) {
            setRecipientValue(
                selectedContact.address as PathValue<
                    TFieldValues,
                    Path<TFieldValues>
                >,
            );
        }
    }, [selectedContact, setRecipientValue]);

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
            setRecipientValue(
                "" as PathValue<TFieldValues, Path<TFieldValues>>,
            );
            setIsRecipientValid(false);
        }
    }, [blockchainType, selectedContact, setRecipientValue]);

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
        !recipient ||
        (!isRecipientValid && !hasCachedValidRecipient) ||
        isValidatingRecipient ||
        !!feeErrorMessage ||
        isSubmitting;

    const handleClearContact = () => {
        setSelectedContact(null);
        setRecipientValue("" as PathValue<TFieldValues, Path<TFieldValues>>);
        setIsRecipientValid(false);
    };

    return (
        <>
            <TokenInput
                control={control}
                title={t("send")}
                amountName={amountName}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                tokenName={tokenName as any}
                tokenSelect={{
                    locked: tokenLocked,
                    disabled: tokenLocked,
                    showOnlyOwnedAssets: false,
                }}
                showInsufficientBalance={!feeErrorMessage}
            />

            <InputBlock
                interactive={!selectedContact}
                title={t("to")}
                className="relative"
                invalid={
                    !selectedContact &&
                    !!recipient &&
                    !isRecipientValid &&
                    !hasCachedValidRecipient &&
                    !isValidatingRecipient
                }
            >
                {selectedContact ? (
                    <div className="flex items-center justify-between gap-2 pt-1">
                        <div className="flex flex-col gap-1 min-w-0">
                            <UserWithData
                                name={selectedContact.name}
                                address={selectedContact.address}
                                useAddressBook
                                size="md"
                                withLink={false}
                            />
                            {selectedContact.networks.length > 0 && (
                                <NetworkList
                                    chains={
                                        selectedContact.networks
                                            .map((key) => chainMap.get(key))
                                            .filter(Boolean) as ChainInfo[]
                                    }
                                    badgeSize="sm"
                                    maxVisible={2}
                                />
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
                                setRecipientValue(
                                    val as PathValue<
                                        TFieldValues,
                                        Path<TFieldValues>
                                    >,
                                )
                            }
                            setIsValid={setIsRecipientValid}
                            setIsValidating={setIsValidatingRecipient}
                            borderless
                            validateOnMount={
                                !!recipient && !hasCachedValidRecipient
                            }
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

            {isConfidential && (
                <InfoAlert message={t("privateNetworkAlert")} />
            )}

            <SelectModal
                isOpen={isContactModalOpen}
                onClose={() => setIsContactModalOpen(false)}
                title={t("selectRecipient")}
                options={contactOptions}
                searchPlaceholder={t("searchByNameOrAddress")}
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
                                useAddressBook
                                size="sm"
                                withLink={false}
                            />
                            {entryChains.length > 0 && (
                                <NetworkList
                                    chains={entryChains}
                                    className="shrink-0"
                                    badgeVariant="secondary"
                                    badgeSize="icon"
                                    maxVisible={2}
                                    badgeIconOnly
                                />
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
