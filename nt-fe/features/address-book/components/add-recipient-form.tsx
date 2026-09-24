"use client";

import {
    Delete01Icon,
    Edit03Icon,
    File02Icon,
    FileDownIcon,
    UserIcon,
    Wallet03Icon,
} from "@hugeicons/core-free-icons";
import { useTranslations } from "next-intl";
import { useState, useEffect, useCallback, type ReactNode, useId } from "react";
import {
    useWatch,
    useFieldArray,
    useFormContext,
    type Control,
} from "react-hook-form";
import { z } from "zod";
import AccountInput from "@/components/account-input";
import { Button } from "@/components/button";
import { Icon } from "@/components/icon";
import { NameField, NameFieldButton, NoteField } from "@/components/name-field";
import { NetworkList } from "@/components/network-list";
import { SelectListIcon } from "@/components/select-list";
import { EmptySelectorIcon } from "@/components/selector-field";
import { StepperHeader } from "@/components/step-wizard";
import { WALLET_ADDRESS_INPUT_PROPS } from "@/lib/wallet-address-input-props";
import { useChains } from "../chains";
import { getCompatibleChains } from "../compatible-chains";
import {
    SelectModal,
    type SelectOption,
} from "@/app/(treasury)/[treasuryId]/dashboard/components/select-modal";
import { FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Pill } from "@/components/pill";
import { buildRecipientSchema, RECIPIENT_NAME_MAX_LENGTH } from "../types";
import { formatAddressBookDisplayAddress } from "../utils/find-entry";
import { formatShortAddress } from "@/lib/format-short-address";
import { NEAR_NETWORK_ID } from "@/constants/network-ids";
import { hasNearComAddressPrefix } from "@/lib/nearcom-address";

// ─── Form schema ───────────────────────────────────────────────────────────────

export function buildFormSchema(messages: {
    nameRequired: string;
    nameMax: string;
    addressRequired: string;
    networksRequired: string;
}) {
    return z.object({
        recipients: z.array(buildRecipientSchema(messages)),
    });
}

const _formSchemaForType = buildFormSchema({
    nameRequired: "",
    nameMax: "",
    addressRequired: "",
    networksRequired: "",
});

export type FormValues = z.infer<typeof _formSchemaForType>;

// ─── NetworkSelect ─────────────────────────────────────────────────────────────

function NetworkSelect({
    address,
    selected,
    onChange,
    disabled,
    invalid,
}: {
    address: string;
    selected: string[];
    onChange: (networks: string[]) => void;
    disabled?: boolean;
    invalid?: boolean;
}) {
    const tForm = useTranslations("addressBook.form");
    const { data: chains = [], isLoading } = useChains();
    const [open, setOpen] = useState(false);

    const compatibleChains = getCompatibleChains(address, chains);

    const options = compatibleChains.map((c) => ({
        id: c.key,
        name: c.name,
        icon: c.icon,
    }));

    const selectedChains = chains.filter((c) => selected.includes(c.key));
    const networkLabel =
        selectedChains.length === 0
            ? tForm("selectNetwork")
            : selectedChains.map((chain) => chain.name).join(", ");

    const handleSelect = (option: SelectOption) => {
        if (selected.includes(option.id)) {
            onChange(selected.filter((k) => k !== option.id));
        } else {
            onChange([...selected, option.id]);
        }
    };

    useEffect(() => {
        if (
            !disabled &&
            compatibleChains.length === 1 &&
            selected.length === 0
        ) {
            handleSelect({
                id: compatibleChains[0].key,
                name: compatibleChains[0].name,
                icon: compatibleChains[0].icon,
            });
        }
    }, [compatibleChains.length]);

    return (
        <>
            <NameFieldButton
                wrap
                leading={
                    selectedChains[0]?.icon ? (
                        <SelectListIcon
                            icon={selectedChains[0].icon}
                            alt={selectedChains[0].name}
                        />
                    ) : (
                        <EmptySelectorIcon />
                    )
                }
                empty={selectedChains.length === 0}
                invalid={invalid}
                aria-disabled={disabled}
                onClick={() => {
                    if (!disabled) setOpen(true);
                }}
            >
                {networkLabel}
            </NameFieldButton>
            <SelectModal
                multiSelect
                isOpen={open}
                onClose={() => setOpen(false)}
                onSelect={handleSelect}
                title={tForm("selectNetworksTitle")}
                options={options}
                searchPlaceholder={tForm("searchNetworksPlaceholder")}
                isLoading={isLoading}
                selectedIds={selected}
            />
        </>
    );
}

// ─── RecipientRow ──────────────────────────────────────────────────────────────

export function RecipientRow({
    control,
    index,
    note,
    onEdit,
    onRemove,
    nameBadge,
    invalid,
    label,
}: {
    control: Control<FormValues>;
    index: number;
    note?: string;
    onEdit?: () => void;
    onRemove?: () => void;
    nameBadge?: ReactNode;
    invalid?: boolean;
    /** Review list label, e.g. "Contact 1". Actions sit on this row. */
    label?: string;
}) {
    const tForm = useTranslations("addressBook.form");
    const tCommon = useTranslations("common");
    const { data: chains = [] } = useChains();
    const name = useWatch({ control, name: `recipients.${index}.name` });
    const address = useWatch({ control, name: `recipients.${index}.address` });
    const networks = useWatch({
        control,
        name: `recipients.${index}.networks`,
    });

    const recipientChains = chains.filter((c) => networks.includes(c.key));
    const displayAddress = formatShortAddress(
        formatAddressBookDisplayAddress({ address, networks }),
    );
    const actions = (onEdit || onRemove) && (
        <div className="flex shrink-0 items-center gap-1">
            {onEdit && (
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-general-unofficial-ghost-foreground"
                    aria-label={tCommon("edit")}
                    onClick={onEdit}
                >
                    <Icon icon={Edit03Icon} />
                </Button>
            )}
            {onRemove && (
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-general-unofficial-ghost-foreground"
                    aria-label={tCommon("remove")}
                    onClick={onRemove}
                >
                    <Icon icon={Delete01Icon} />
                </Button>
            )}
        </div>
    );

    const identity = (
        <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-general-indigo-border bg-general-indigo-background-faded">
                    <Icon
                        icon={Wallet03Icon}
                        className="size-4 text-general-indigo-foreground"
                    />
                </span>
                <div className="min-w-0">
                    <p className="truncate text-sm font-semibold leading-normal text-foreground">
                        {name}
                    </p>
                    <p className="truncate text-xs leading-normal text-muted-foreground">
                        {displayAddress}
                    </p>
                </div>
                {!label && nameBadge}
                {invalid && (
                    <Pill
                        title={tForm("incomplete")}
                        className="bg-destructive/10 text-destructive"
                    />
                )}
            </div>
            <NetworkList
                chains={recipientChains}
                className="min-w-0 shrink-0 flex-wrap justify-end"
                badgeVariant="outline"
                maxVisible={2}
                overflow="tooltip"
            />
        </div>
    );

    if (label) {
        return (
            <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                        <p className="text-sm font-medium leading-normal text-general-secondary-foreground">
                            {label}
                        </p>
                        {nameBadge}
                    </div>
                    {actions}
                </div>
                {identity}
                {note ? (
                    <p className="whitespace-pre-wrap wrap-break-word pl-11 text-sm leading-normal text-general-secondary-foreground">
                        {note}
                    </p>
                ) : null}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-2">
            {identity}
            <div className="flex items-end justify-between gap-3 pl-11">
                {note ? (
                    <p className="min-w-0 flex-1 whitespace-pre-wrap wrap-break-word text-sm leading-normal text-general-secondary-foreground">
                        {note}
                    </p>
                ) : (
                    <span className="flex-1" />
                )}
                {actions}
            </div>
        </div>
    );
}


// ─── AddRecipientInput ─────────────────────────────────────────────────────────

const EMPTY_RECIPIENT = { name: "", networks: [] as string[], address: "" };

interface AddRecipientInputProps {
    control: Control<FormValues>;
    activeIndex: number;
    setActiveIndex: (index: number) => void;
    handleBack?: () => void;
    onReview: (notes?: Record<number, string>) => void;
    onImport?: () => void;
    /** Page header owns the title and import action. */
    hideHeader?: boolean;
    /** Controlled note for the active row. Used while editing from review. */
    note?: string;
    onNoteChange?: (note: string) => void;
    /** When true, only show the form fields + a "Done" button — hides the committed list, "Add Another", stepper header, and "Save contact". */
    editOnly?: boolean;
}

export function AddRecipientInput({
    control,
    activeIndex,
    setActiveIndex,
    handleBack,
    onReview,
    onImport,
    hideHeader = false,
    note,
    onNoteChange,
    editOnly = false,
}: AddRecipientInputProps) {
    const tForm = useTranslations("addressBook.form");
    const { data: chains = [] } = useChains();
    const [isAddressValid, setIsAddressValid] = useState(false);
    const [isAddressValidating, setIsAddressValidating] = useState(false);
    const [notes, setNotes] = useState<Record<number, string>>({});
    const noteValue = onNoteChange ? (note ?? "") : (notes[activeIndex] ?? "");

    const { formState, setError, clearErrors, getValues, setValue } =
        useFormContext<FormValues>();

    const { fields, append, remove } = useFieldArray({
        control,
        name: "recipients",
    });
    const id = useId();

    const activeAddress = useWatch({
        control,
        name: `recipients.${activeIndex}.address`,
    });
    const activeFormKey = `${activeIndex}-${id}`;
    const activeNetworks = useWatch({
        control,
        name: `recipients.${activeIndex}.networks`,
    });
    const allRecipients = useWatch({ control, name: "recipients" }) ?? [];

    const isActiveValid =
        !formState.errors.recipients?.[activeIndex] &&
        !!getValues(`recipients.${activeIndex}.name`)?.trim() &&
        isAddressValid &&
        !isAddressValidating &&
        activeNetworks?.length > 0;

    const isEntryComplete = (i: number) => {
        const r = allRecipients[i];
        if (!r) return false;
        return (
            !!r.name?.trim() &&
            !!r.address &&
            r.networks?.length > 0 &&
            !formState.errors.recipients?.[i]
        );
    };

    const activeRecipient = allRecipients[activeIndex];
    const activeIsEmpty =
        !activeRecipient?.name?.trim() &&
        !activeRecipient?.address?.trim() &&
        !(activeRecipient?.networks?.length > 0);
    const canProceed =
        (isActiveValid || activeIsEmpty) &&
        fields.every((_, i) => i === activeIndex || isEntryComplete(i)) &&
        fields.some((_, i) =>
            i === activeIndex ? isActiveValid : isEntryComplete(i),
        );

    const handleAddressValid = useCallback(
        (valid: boolean) => {
            if (!valid) {
                setIsAddressValid(false);
                if (activeAddress) {
                    setError(`recipients.${activeIndex}.address`, {
                        message: tForm("invalidAddress"),
                    });
                }
                return;
            }
            const compatible = getCompatibleChains(activeAddress, chains);
            if (compatible.length > 0) {
                setIsAddressValid(true);
                clearErrors(`recipients.${activeIndex}.address`);
                const compatibleKeys = compatible.map((c) => c.key);
                const currentNetworks = getValues(
                    `recipients.${activeIndex}.networks`,
                );
                const stillValid = currentNetworks.filter((n) =>
                    compatibleKeys.includes(n),
                );
                if (stillValid.length !== currentNetworks.length) {
                    setValue(`recipients.${activeIndex}.networks`, stillValid);
                }
            } else {
                setIsAddressValid(false);
                setError(`recipients.${activeIndex}.address`, {
                    message: tForm("noCompatibleNetworks"),
                });
            }
        },
        [
            activeAddress,
            chains,
            activeIndex,
            setError,
            clearErrors,
            getValues,
            setValue,
        ],
    );

    const handleCommit = () => {
        if (!isActiveValid) return;
        append(EMPTY_RECIPIENT);
        setActiveIndex(fields.length);
        setIsAddressValid(false);
    };

    const handleEdit = (index: number) => {
        setActiveIndex(index);
        setIsAddressValid(false);
    };

    const handleRemove = (index: number) => {
        remove(index);
        setNotes((prev) => {
            const next: Record<number, string> = {};
            for (const [key, value] of Object.entries(prev)) {
                const noteIndex = Number(key);
                if (noteIndex < index) next[noteIndex] = value;
                else if (noteIndex > index) next[noteIndex - 1] = value;
            }
            return next;
        });
        const nextLength = fields.length - 1;
        const nextActive = activeIndex > index ? activeIndex - 1 : activeIndex;
        setActiveIndex(Math.max(0, Math.min(nextActive, nextLength - 1)));
    };

    const handleAddressChange = (value: string) => {
        const next = value.replace(/\s/g, "");
        setValue(`recipients.${activeIndex}.address`, next, {
            shouldDirty: true,
        });
        if (!next) {
            setIsAddressValid(false);
            setValue(`recipients.${activeIndex}.networks`, []);
            clearErrors(`recipients.${activeIndex}.address`);
        }
    };

    const setNoteValue = (value: string) => {
        if (onNoteChange) {
            onNoteChange(value);
            return;
        }
        setNotes((prev) => ({ ...prev, [activeIndex]: value }));
    };

    return (
        <div className="flex flex-col gap-6">
            {hideHeader ? null : (
                <div className="flex items-center justify-between gap-3">
                    <StepperHeader
                        title={
                            editOnly
                                ? tForm("editRecipient")
                                : tForm("addRecipient")
                        }
                        handleBack={handleBack}
                    />
                    {!editOnly && onImport && (
                        <Button variant="secondary" onClick={onImport}>
                            <Icon icon={FileDownIcon} /> {tForm("import")}
                        </Button>
                    )}
                </div>
            )}

            <div key={activeFormKey} className="flex flex-col gap-3">
                <FormField
                    control={control}
                    name={`recipients.${activeIndex}.name`}
                    render={({ field, fieldState }) => (
                        <FormItem className="gap-1">
                            <NameField
                                ref={field.ref}
                                name={field.name}
                                icon={UserIcon}
                                invalid={!!fieldState.error}
                                value={field.value ?? ""}
                                maxLength={RECIPIENT_NAME_MAX_LENGTH}
                                placeholder={tForm("enterName")}
                                clearLabel={tForm("clearName")}
                                onBlur={field.onBlur}
                                onChange={field.onChange}
                                onClear={() => field.onChange("")}
                            />
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={control}
                    name={`recipients.${activeIndex}.address`}
                    render={({ field, fieldState }) => (
                        <FormItem className="gap-1">
                            <NameField
                                {...WALLET_ADDRESS_INPUT_PROPS}
                                ref={field.ref}
                                icon={Wallet03Icon}
                                invalid={!!fieldState.error}
                                value={field.value ?? ""}
                                placeholder={tForm("enterAddress")}
                                clearLabel={tForm("clearAddress")}
                                onBlur={field.onBlur}
                                onChange={(event) =>
                                    handleAddressChange(event.target.value)
                                }
                                onClear={() => handleAddressChange("")}
                            />
                            <div className="hidden" aria-hidden>
                                <AccountInput
                                    blockchain={
                                        hasNearComAddressPrefix(activeAddress)
                                            ? NEAR_NETWORK_ID
                                            : "unknown"
                                    }
                                    value={activeAddress}
                                    setValue={field.onChange}
                                    setIsValid={handleAddressValid}
                                    setIsValidating={setIsAddressValidating}
                                    validateOnMount={!!activeAddress}
                                    borderless
                                />
                            </div>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={control}
                    name={`recipients.${activeIndex}.networks`}
                    render={({ field, fieldState }) => (
                        <FormItem className="gap-1">
                            <NetworkSelect
                                address={activeAddress}
                                selected={field.value ?? []}
                                onChange={field.onChange}
                                disabled={!isAddressValid}
                                invalid={!!fieldState.error}
                            />
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <NoteField
                    icon={File02Icon}
                    value={noteValue}
                    placeholder={tForm("note")}
                    clearLabel={tForm("clearNote")}
                    onChange={(event) => setNoteValue(event.target.value)}
                    onClear={() => setNoteValue("")}
                />
            </div>

            {editOnly ? (
                <Button
                    className="h-11 w-full rounded-2xl"
                    disabled={!isActiveValid}
                    onClick={() => onReview()}
                >
                    {tForm("done")}
                </Button>
            ) : (
                <>
                    {fields.some((_, index) => index !== activeIndex) && (
                        <div className="flex flex-col gap-6">
                            {fields.map((field, i) =>
                                i !== activeIndex ? (
                                    <RecipientRow
                                        key={field.id}
                                        index={i}
                                        control={control}
                                        note={notes[i]}
                                        onEdit={() => handleEdit(i)}
                                        onRemove={() => handleRemove(i)}
                                        invalid={!isEntryComplete(i)}
                                    />
                                ) : null,
                            )}
                        </div>
                    )}

                    <Button
                        variant="link"
                        type="button"
                        className="h-auto self-center p-0 text-muted-foreground"
                        onClick={handleCommit}
                    >
                        {tForm("addAnother")}
                    </Button>

                    <Button
                        className="h-11 w-full rounded-2xl"
                        disabled={!canProceed}
                        tooltipContent={
                            !canProceed ? tForm("reviewTooltip") : undefined
                        }
                        onClick={() => onReview(notes)}
                    >
                        {tForm("saveContact")}
                    </Button>
                </>
            )}
        </div>
    );
}
