"use client";

import { useState } from "react";
import { Button } from "@/components/button";
import { StepperHeader } from "@/components/step-wizard";
import { Textarea } from "@/components/textarea";
import { FormValues, RecipientRow } from "./add-recipient-form";
import type { StepProps } from "@/components/step-wizard";
import type { RecipientDraft } from "../types";
import { SummaryBlock } from "@/components/summary-block";
import { Control, useWatch } from "react-hook-form";

interface ReviewRecipientsProps extends StepProps {
    control: Control<FormValues>;
    onSubmit: (notes: Record<number, string>) => void;
    isSubmitting?: boolean;
}

export function ReviewRecipients({
    handleBack,
    control,
    onSubmit,
    isSubmitting = false,
}: ReviewRecipientsProps) {
    const [notes, setNotes] = useState<Record<number, string>>({});
    const count = useWatch({ control, name: "recipients" }).length;

    return (
        <div className="flex flex-col gap-4">
            <StepperHeader title="Review Details" handleBack={handleBack} />

            <div className="flex flex-col gap-3">
                <SummaryBlock
                    title="You're adding"
                    secondRow={
                        <p className="text-2xl font-semibold text-foreground">{`${count} recipient${count !== 1 ? "s" : ""}`}</p>
                    }
                />
                <p className="text-sm font-semibold">Recipients</p>

                {Array.from({ length: count }, (_, i) => i).map((i) => (
                    <div key={i} className="flex flex-col gap-2">
                        <RecipientRow control={control} index={i} />
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
