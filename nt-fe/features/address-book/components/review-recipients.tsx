"use client";

import { useState } from "react";
import { Button } from "@/components/button";
import { StepperHeader } from "@/components/step-wizard";
import { Textarea } from "@/components/textarea";
import {
    AddRecipientInput,
    FormValues,
    RecipientRow,
} from "./add-recipient-form";
import type { StepProps } from "@/components/step-wizard";
import { SummaryBlock } from "@/components/summary-block";
import { Control, useFieldArray } from "react-hook-form";

interface ReviewRecipientsProps extends StepProps {
    control: Control<FormValues>;
    onSubmit: (notes: Record<number, string>) => void;
    isSubmitting?: boolean;
    initialNotes?: Record<number, string>;
}

export function ReviewRecipients({
    handleBack,
    control,
    onSubmit,
    isSubmitting = false,
    initialNotes,
}: ReviewRecipientsProps) {
    const [notes, setNotes] = useState<Record<number, string>>(
        initialNotes ?? {},
    );
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const { fields, remove } = useFieldArray({ control, name: "recipients" });
    const count = fields.length;
    const networkCount = new Set(fields.flatMap((field) => field.networks))
        .size;
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
                        <p className="text-2xl font-semibold text-foreground">{`${count} recipient${count !== 1 ? "s" : ""}`}</p>
                    }
                    // On x different networks
                    subRow={
                        count > 1 && (
                            <p className="text-sm text-muted-foreground">
                                on {networkCount} different network
                                {networkCount !== 1 ? "s" : ""}
                            </p>
                        )
                    }
                />
                <p className="text-sm font-semibold">Recipients</p>

                {fields.map((field, i) => (
                    <div key={field.id} className="flex flex-col gap-2">
                        <RecipientRow
                            control={control}
                            index={i}
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

            <Button
                className="w-full"
                disabled={isSubmitting}
                onClick={() => onSubmit(notes)}
            >
                {isSubmitting ? "Adding…" : "Add Recipient"}
            </Button>
        </div>
    );
}
