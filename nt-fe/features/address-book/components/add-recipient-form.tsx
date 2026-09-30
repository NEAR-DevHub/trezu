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
import {
    type ReactNode,
    useCallback,
    useEffect,
    useId,
    useMemo,
    useState,
} from "react";
import {
    type Control,
    useFieldArray,
    useFormContext,
    useWatch,
} from "react-hook-form";
import { z } from "zod";
import {
    SelectModal,
    type SelectOption,
} from "@/app/(treasury)/[treasuryId]/dashboard/components/select-modal";
import AccountInput from "@/components/account-input";
import { Button } from "@/components/button";
import { Icon } from "@/components/icon";
import { NameField, NameFieldButton, NoteField } from "@/components/name-field";
import { NetworkList } from "@/components/network-list";
import { Pill } from "@/components/pill";
import { SelectListIcon } from "@/components/select-list";
import { EmptySelectorIcon } from "@/components/selector-field";
import { StepperHeader } from "@/components/step-wizard";
import { FormField, FormItem, FormMessage } from "@/components/ui/form";
import { NEAR_NETWORK_ID } from "@/constants/network-ids";
import { formatShortAddress } from "@/lib/format-short-address";
import { hasNearComAddressPrefix } from "@/lib/nearcom-address";
import { WALLET_ADDRESS_INPUT_PROPS } from "@/lib/wallet-address-input-props";
import { useChains } from "../chains";
import { getCompatibleChains } from "../compatible-chains";
import {
    type AddressBookEntry,
    buildRecipientSchema,
    RECIPIENT_NAME_MAX_LENGTH,
} from "../types";
import { duplicateRecipientIndexes } from "../utils/duplicate-recipients";
import { formatAddressBookDisplayAddress } from "../utils/find-entry";

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

    const selectedId = selected[0];
    const options = compatibleChains.map((c) => ({
        id: c.key,
        name: c.name,
        icon: c.icon,
    }));
    const orderedOptions = selectedId
        ? [
              ...options.filter((option) => option.id === selectedId),
              ...options.filter((option) => option.id !== selectedId),
          ]
        : options;

    const selectedChain =
        chains.find((chain) => chain.key === selected[0]) ?? null;
    const networkLabel = selectedChain?.name ?? tForm("selectNetwork");

    const handleSelect = (option: SelectOption) => {
        onChange([option.id]);
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
                leading={
                    selectedChain?.icon ? (
                        <SelectListIcon
                            icon={selectedChain.icon}
                            alt={selectedChain.name}
                        />
                    ) : (
                        <EmptySelectorIcon />
                    )
                }
                empty={!selectedChain}
                invalid={invalid}
                aria-disabled={disabled}
                onClick={() => {
                    if (!disabled) setOpen(true);
                }}
            >
                {networkLabel}
            </NameFieldButton>
            <SelectModal
                isOpen={open}
                onClose={() => setOpen(false)}
                onSelect={handleSelect}
                title={tForm("selectNetwork")}
                options={orderedOptions}
                searchPlaceholder={tForm("searchNetworksPlaceholder")}
                isLoading={isLoading}
                selectedId={selectedChain?.key}
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
    /** Import edit returns to the review list. */
    onReview?: (notes?: Record<number, string>) => void;
    /** Manual add saves without a review step. */
    onSave?: (notes?: Record<number, string>) => void | Promise<void>;
    existingEntries?: AddressBookEntry[];
    isSubmitting?: boolean;
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
    onSave,
    existingEntries = [],
    isSubmitting = false,
    onImport,
    hideHeader = false,
    note,
    onNoteChange,
    editOnly = false,
}: AddRecipientInputProps) {
    const tForm = useTranslations("addressBook.form");
    const tReview = useTranslations("addressBook.review");
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
    const existingAddresses = useMemo(
        () => new Set(existingEntries.map((entry) => entry.address.trim())),
        [existingEntries],
    );
    const duplicateIndexes = useMemo(
        () => duplicateRecipientIndexes(allRecipients, existingAddresses),
        [allRecipients, existingAddresses],
    );
    const duplicateIndexSet = useMemo(
        () => new Set(duplicateIndexes),
        [duplicateIndexes],
    );
    const duplicateCount = duplicateIndexes.length;
    const newRecipientCount = allRecipients.filter(
        (recipient, index) =>
            !!recipient?.name?.trim() &&
            !!recipient?.address?.trim() &&
            (recipient?.networks?.length ?? 0) > 0 &&
            !duplicateIndexSet.has(index),
    ).length;
    const hasOnlyDuplicates =
        duplicateCount > 0 &&
        newRecipientCount === 0 &&
        allRecipients.some(
            (recipient) =>
                !!recipient?.name?.trim() &&
                !!recipient?.address?.trim() &&
                (recipient?.networks?.length ?? 0) > 0,
        );
    const activeIsDuplicate = duplicateIndexSet.has(activeIndex);

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
                const stillValid = currentNetworks
                    .filter((n) => compatibleKeys.includes(n))
                    .slice(0, 1);
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
                                invalid={
                                    !!fieldState.error || activeIsDuplicate
                                }
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
                                    // `nearcom:` is the near.com route. Without
                                    // this, the prefix is rejected as not
                                    // allowed on a plain NEAR address.
                                    requireNearComPrefix={hasNearComAddressPrefix(
                                        activeAddress,
                                    )}
                                    value={activeAddress}
                                    setValue={field.onChange}
                                    setIsValid={handleAddressValid}
                                    setIsValidating={setIsAddressValidating}
                                    validateOnMount={!!activeAddress}
                                    borderless
                                />
                            </div>
                            <FormMessage />
                            {activeIsDuplicate && !fieldState.error ? (
                                <p className="text-sm font-medium text-general-info-foreground">
                                    {tReview("duplicated")}
                                </p>
                            ) : null}
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
                    className="h-11 w-full"
                    disabled={!isActiveValid}
                    onClick={() => onReview?.()}
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
                                        nameBadge={
                                            duplicateIndexSet.has(i) ? (
                                                <span className="flex min-h-6 items-center justify-center gap-1.5 rounded-sm border border-general-warning-border bg-general-warning-background-faded px-2 py-0.75 text-xs font-medium text-general-warning-foreground">
                                                    {tReview("duplicated")}
                                                </span>
                                            ) : undefined
                                        }
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

                    {duplicateCount > 0 ? (
                        <p className="text-sm font-medium text-general-info-foreground">
                            {allRecipients.some(
                                (recipient, index) =>
                                    !!recipient?.address?.trim() &&
                                    !duplicateIndexSet.has(index),
                            )
                                ? tReview("manualSomeDuplicates", {
                                      duplicates: duplicateCount,
                                      total: allRecipients.filter((recipient) =>
                                          recipient?.address?.trim(),
                                      ).length,
                                  })
                                : tReview("manualAllDuplicates", {
                                      count: duplicateCount,
                                  })}
                        </p>
                    ) : null}

                    <Button
                        className="h-11 w-full"
                        loading={isSubmitting}
                        disabled={!canProceed || hasOnlyDuplicates}
                        tooltipContent={
                            hasOnlyDuplicates
                                ? tReview("manualAllDuplicatesTooltip", {
                                      count: duplicateCount,
                                  })
                                : !canProceed
                                  ? tForm("reviewTooltip")
                                  : undefined
                        }
                        onClick={() => {
                            if (onSave) {
                                void onSave(notes);
                                return;
                            }
                            onReview?.(notes);
                        }}
                    >
                        {isSubmitting
                            ? tReview("adding")
                            : tForm("saveContact")}
                    </Button>
                </>
            )}
        </div>
    );
}
