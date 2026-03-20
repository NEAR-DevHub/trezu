"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/button";
import { StepperHeader } from "@/components/step-wizard";
import { Textarea } from "@/components/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
    AddRecipientInput,
    FormValues,
    RecipientRow,
} from "./add-recipient-form";
import type { StepProps } from "@/components/step-wizard";
import { SummaryBlock } from "@/components/summary-block";
import { Control, useFieldArray, useWatch } from "react-hook-form";
import type { AddressBookEntry } from "../types";

function normalizeAddress(address: string) {
    return address.trim();
}

interface ReviewRecipientsProps extends StepProps {
    control: Control<FormValues>;
    existingEntries?: AddressBookEntry[];
    onSubmit: (
        notes: Record<number, string>,
        includedIndexes: number[],
    ) => void;
    isSubmitting?: boolean;
    initialNotes?: Record<number, string>;
}

export function ReviewRecipients({
    handleBack,
    control,
    existingEntries = [],
    onSubmit,
    isSubmitting = false,
    initialNotes,
}: ReviewRecipientsProps) {
    const [notes, setNotes] = useState<Record<number, string>>(
        initialNotes ?? {},
    );
    const [skipDuplicates, setSkipDuplicates] = useState(true);
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const { fields, remove } = useFieldArray({ control, name: "recipients" });
    const recipients = useWatch({ control, name: "recipients" }) ?? [];
    const count = recipients.length;
    const existingAddresses = useMemo(
        () =>
            new Set(
                existingEntries.map((entry) => normalizeAddress(entry.address)),
            ),
        [existingEntries],
    );
    const duplicateIndexes = useMemo(
        () =>
            recipients.reduce<number[]>((duplicates, recipient, index) => {
                if (
                    recipient?.address &&
                    existingAddresses.has(normalizeAddress(recipient.address))
                ) {
                    duplicates.push(index);
                }

                return duplicates;
            }, []),
        [existingAddresses, recipients],
    );
    const duplicateIndexSet = useMemo(
        () => new Set(duplicateIndexes),
        [duplicateIndexes],
    );
    const includedRecipientIndexes = useMemo(
        () =>
            recipients.reduce<number[]>((included, _recipient, index) => {
                if (!duplicateIndexSet.has(index)) {
                    included.push(index);
                }

                return included;
            }, []),
        [duplicateIndexSet, recipients],
    );
    const duplicateCount = duplicateIndexes.length;
    const newRecipientCount = count - duplicateCount;
    const canSubmit =
        newRecipientCount > 0 && (duplicateCount === 0 || skipDuplicates);
    const networkCount = new Set(
        includedRecipientIndexes.flatMap(
            (index) => recipients[index]?.networks ?? [],
        ),
    ).size;

    if (editingIndex !== null) {
        return (
            <AddRecipientInput
                editOnly
                control={control}
                activeIndex={editingIndex}
                setActiveIndex={setEditingIndex}
                handleBack={() => setEditingIndex(null)}
                onReview={() => setEditingIndex(null)}
            />
        );
    }

    return (
        <div className="flex flex-col gap-4">
            <StepperHeader title="Review Details" handleBack={handleBack} />

            <div className="flex flex-col gap-3">
                <SummaryBlock
                    title="You're adding"
                    secondRow={
                        <p className="text-2xl font-semibold text-foreground">{`${newRecipientCount} new recipient${newRecipientCount !== 1 ? "s" : ""}`}</p>
                    }
                    // On x different networks
                    subRow={
                        count > 1 && (
                            <p className="text-sm text-muted-foreground">
                                on {networkCount} network
                                {networkCount !== 1 ? "s" : ""}
                            </p>
                        )
                    }
                />
                <div className="flex flex-col gap-1">
                    <p className="text-sm font-semibold">Recipients</p>
                    {duplicateCount > 0 && (
                        <p className="text-xs text-general-info-foreground font-medium">
                            {duplicateCount} duplicated recipients out of{" "}
                            {count} total recipients. Continue to upload only
                            the new recipients.
                        </p>
                    )}
                </div>

                {fields.map((field, i) => (
                    <div key={field.id} className="flex flex-col gap-2">
                        <RecipientRow
                            control={control}
                            index={i}
                            nameBadge={
                                duplicateIndexSet.has(i) ? (
                                    <span className="rounded-full bg-general-warning-background-faded px-2 py-0.5 text-xs font-medium text-general-warning-foreground">
                                        Duplicated
                                    </span>
                                ) : undefined
                            }
                            onEdit={() => setEditingIndex(i)}
                            onRemove={
                                count > 1
                                    ? () => {
                                          remove(i);
                                          setNotes((prev) => {
                                              const next: Record<
                                                  number,
                                                  string
                                              > = {};
                                              for (const [
                                                  k,
                                                  v,
                                              ] of Object.entries(prev)) {
                                                  const idx = Number(k);
                                                  if (idx < i) next[idx] = v;
                                                  else if (idx > i)
                                                      next[idx - 1] = v;
                                              }
                                              return next;
                                          });
                                      }
                                    : undefined
                            }
                        />
                        <Textarea
                            borderless
                            placeholder="Add a note to help identify this recipient (e.g. contractor payment, vesting distribution)."
                            value={notes[i] ?? ""}
                            onChange={(e) =>
                                setNotes((prev) => ({
                                    ...prev,
                                    [i]: e.target.value,
                                }))
                            }
                        />
                    </div>
                ))}
            </div>

            {duplicateCount > 0 && (
                <div className="flex items-start gap-3">
                    <Checkbox
                        id="skip-duplicates"
                        checked={skipDuplicates}
                        className="mt-0.5"
                        onCheckedChange={(checked) =>
                            setSkipDuplicates(checked === true)
                        }
                    />
                    <Label
                        htmlFor="skip-duplicates"
                        className="text-sm font-normal leading-relaxed cursor-pointer"
                    >
                        Skip duplicates and import only new ones.
                    </Label>
                </div>
            )}

            <Button
                className="w-full"
                disabled={isSubmitting || !canSubmit}
                onClick={() => onSubmit(notes, includedRecipientIndexes)}
            >
                {isSubmitting
                    ? "Adding…"
                    : newRecipientCount === 0
                      ? "No New Recipients"
                      : `Add Recipient${newRecipientCount !== 1 ? "s" : ""}`}
            </Button>
        </div>
    );
}
