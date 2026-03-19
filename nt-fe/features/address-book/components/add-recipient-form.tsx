"use client";

import { useState, useMemo } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { InputBlock } from "@/components/input-block";
import { LargeInput } from "@/components/large-input";
import AccountInput from "@/components/account-input";
import { Button } from "@/components/button";
import { StepperHeader } from "@/components/step-wizard";
import { NetworkBadge } from "@/components/network-badge";
import { getBlockchainType } from "@/lib/blockchain-utils";
import { useChains } from "../chains";
import {
    SelectModal,
    type SelectOption,
} from "@/app/(treasury)/[treasuryId]/dashboard/components/select-modal";
import type { StepProps } from "@/components/step-wizard";
import { NumberBadge } from "@/components/number-badge";
import { Address } from "@/components/address";

export interface RecipientDraft {
    name: string;
    networks: string[];
    address: string;
}

interface AddRecipientFormProps extends StepProps {
    recipients: RecipientDraft[];
    onRecipientsChange: (recipients: RecipientDraft[]) => void;
}

function NetworkSelect({
    selected,
    onChange,
}: {
    selected: string[];
    onChange: (networks: string[]) => void;
}) {
    const { data: chains = [], isLoading } = useChains();
    const [open, setOpen] = useState(false);

    const selectedType =
        selected.length > 0 ? getBlockchainType(selected[0]) : null;

    const options = chains
        .filter(
            (c) =>
                selectedType === null ||
                getBlockchainType(c.key) === selectedType,
        )
        .map((c) => ({
            id: c.key,
            name: c.name,
            icon: c.iconLight,
        }));

    const selectedChains = chains.filter((c) => selected.includes(c.key));

    const handleSelect = (option: SelectOption) => {
        if (selected.includes(option.id)) {
            onChange(selected.filter((k) => k !== option.id));
        } else {
            onChange([...selected, option.id]);
        }
    };

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="flex items-center w-full py-1 focus:outline-none"
            >
                {selectedChains.length === 0 ? (
                    <span className="text-muted-foreground text-lg">
                        Select network
                    </span>
                ) : (
                    <div className="flex flex-wrap gap-1.5">
                        {selectedChains.map((c) => (
                            <NetworkBadge
                                key={c.name}
                                name={c.name}
                                variant="ghost"
                                size="lg"
                                iconDark={c.iconDark}
                                iconLight={c.iconLight}
                            />
                        ))}
                    </div>
                )}
            </button>
            <SelectModal
                multiSelect
                isOpen={open}
                fixNear
                onClose={() => setOpen(false)}
                onSelect={handleSelect}
                title="Select Networks"
                options={options}
                searchPlaceholder="Search networks…"
                isLoading={isLoading}
                selectedIds={selected}
                roundIcons={false}
            />
        </>
    );
}

export function RecipientRow({
    recipient,
    index,
    onEdit,
    onRemove,
}: {
    recipient: RecipientDraft;
    index: number;
    onEdit?: () => void;
    onRemove?: () => void;
}) {
    const { data: chains = [] } = useChains();

    const recipientChains = chains.filter((c) =>
        recipient.networks.includes(c.key),
    );

    return (
        <div className="flex flex-col gap-2">
            <div className="flex gap-2 items-start py-0.5">
                <div className="my-auto">
                    <NumberBadge number={index + 1} variant="secondary" />
                </div>
                <div className="flex flex-1 flex-col items-end min-w-0">
                    <div className="flex items-center gap-2 w-full">
                        <div className="flex flex-1 flex-col gap-0.5 min-w-0">
                            <p className="text-xs font-semibold leading-[14px]">
                                {recipient.name}
                            </p>
                            <Address address={recipient.address} />
                        </div>
                        <div className="flex flex-wrap gap-1 shrink-0">
                            {recipientChains.map((c) => (
                                <NetworkBadge
                                    key={c.key}
                                    name={c.name}
                                    size="sm"
                                    iconDark={c.iconDark}
                                    iconLight={c.iconLight}
                                />
                            ))}
                        </div>
                    </div>
                </div>
            </div>
            {(onEdit || onRemove) && (
                <div className="flex gap-0.5 py-1 justify-end">
                    {onEdit && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:text-foreground"
                            onClick={onEdit}
                        >
                            <Pencil className="size-4" />
                            Edit
                        </Button>
                    )}
                    {onRemove && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:text-foreground"
                            onClick={onRemove}
                        >
                            <Trash2 className="size-4" />
                            Remove
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
}

const EMPTY_DRAFT: RecipientDraft = { name: "", networks: [], address: "" };

export function AddRecipientForm({
    handleBack,
    handleNext,
    recipients,
    onRecipientsChange,
}: AddRecipientFormProps) {
    const [draft, setDraft] = useState<RecipientDraft>(EMPTY_DRAFT);
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [isAddressValid, setIsAddressValid] = useState(false);
    const [isAddressValidating, setIsAddressValidating] = useState(false);

    const blockchainType = useMemo(
        () => getBlockchainType(draft.networks[0] ?? "near"),
        [draft.networks],
    );

    const isDraftValid =
        draft.name.trim().length > 0 &&
        draft.networks.length > 0 &&
        draft.address.trim().length > 0 &&
        isAddressValid &&
        !isAddressValidating;

    const commitDraft = () => {
        if (!isDraftValid) return;
        if (editingIndex !== null) {
            const updated = [...recipients];
            updated[editingIndex] = draft;
            onRecipientsChange(updated);
            setEditingIndex(null);
        } else {
            onRecipientsChange([...recipients, draft]);
        }
        setDraft(EMPTY_DRAFT);
    };

    const handleEdit = (index: number) => {
        if (draft.name || draft.address) {
            if (isDraftValid) {
                const updated = [...recipients];
                if (editingIndex !== null) updated[editingIndex] = draft;
                onRecipientsChange(updated);
            }
        }
        setDraft(recipients[index]);
        setEditingIndex(index);
    };

    const handleRemove = (index: number) => {
        onRecipientsChange(recipients.filter((_, i) => i !== index));
        if (editingIndex === index) {
            setDraft(EMPTY_DRAFT);
            setEditingIndex(null);
        }
    };

    const handleReview = () => {
        if (isDraftValid) commitDraft();
        setTimeout(() => handleNext?.(), 0);
    };

    const canProceed = recipients.length > 0 || isDraftValid;

    return (
        <div className="flex flex-col gap-4">
            <StepperHeader title="Add Recipient" handleBack={handleBack} />

            <div className="flex flex-col gap-2">
                <InputBlock title="Recipient Name" invalid={false} interactive>
                    <LargeInput
                        borderless
                        placeholder="Alice"
                        value={draft.name}
                        onChange={(e) =>
                            setDraft((d) => ({ ...d, name: e.target.value }))
                        }
                    />
                </InputBlock>

                <InputBlock
                    title="Network"
                    info="Select the blockchain networks this address is valid for"
                    invalid={false}
                    interactive
                >
                    <NetworkSelect
                        selected={draft.networks}
                        onChange={(networks) => {
                            setDraft((d) => ({ ...d, networks, address: "" }));
                            setIsAddressValid(false);
                        }}
                    />
                </InputBlock>

                <InputBlock
                    title="Recipient Address"
                    invalid={false}
                    interactive
                >
                    <AccountInput
                        key={blockchainType}
                        blockchain={blockchainType}
                        value={draft.address}
                        setValue={(v) =>
                            setDraft((d) => ({ ...d, address: v }))
                        }
                        setIsValid={setIsAddressValid}
                        setIsValidating={setIsAddressValidating}
                        borderless
                    />
                </InputBlock>
            </div>

            <Button
                variant="ghost"
                type="button"
                className="w-full justify-start rounded-b-xl"
                disabled={!isDraftValid}
                tooltipContent={
                    !isDraftValid
                        ? "You must fill out all fields to add a recipient."
                        : undefined
                }
                onClick={commitDraft}
            >
                <Plus className="size-4 text-foreground" />
                <span className="text-foreground">Add Another Recipient</span>
            </Button>

            {recipients.length > 0 && (
                <div className="flex flex-col divide-y">
                    {recipients.map((r, i) =>
                        editingIndex !== i ? (
                            <RecipientRow
                                key={i}
                                index={i}
                                recipient={r}
                                onEdit={() => handleEdit(i)}
                                onRemove={() => handleRemove(i)}
                            />
                        ) : null,
                    )}
                </div>
            )}

            <div className="rounded-lg border bg-card p-0 overflow-hidden">
                <Button
                    className="w-full"
                    disabled={!canProceed}
                    onClick={handleReview}
                >
                    Review Details
                </Button>
            </div>
        </div>
    );
}
