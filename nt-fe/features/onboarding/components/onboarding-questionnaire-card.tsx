"use client";

import { ArrowLeftIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/button";
import { PageCard } from "@/components/card";
import {
    SelectableOptionButton,
    type SelectableOption,
} from "@/components/selectable-option-button";
import { Textarea } from "@/components/ui/textarea";

interface OnboardingQuestionOption extends SelectableOption {
    id: string;
}

interface OnboardingQuestionnaireCardProps {
    question: {
        title: string;
        text: string;
        progressLabel: string;
        options: OnboardingQuestionOption[];
        selectedValues: string[];
        indicatorType: "checkbox" | "radio";
        showOtherInput: boolean;
        otherValue: string;
        otherPlaceholder: string;
        canContinue: boolean;
    };
    actions: {
        onBack: () => void;
        onOptionClick: (optionId: string) => void;
        onOtherChange: (value: string) => void;
        onContinue: () => void;
        onSkip: () => void;
    };
    showBack: boolean;
}

export function OnboardingQuestionnaireCard({
    question,
    actions,
    showBack,
}: OnboardingQuestionnaireCardProps) {
    const t = useTranslations("onboarding.questionnaire");
    return (
        <PageCard>
            <div className="flex flex-col gap-5">
                <div className="flex items-center gap-2">
                    {showBack && (
                        <Button
                            variant="ghost"
                            size="icon"
                            type="button"
                            onClick={actions.onBack}
                            className="shrink-0 mt-[5px]"
                        >
                            <ArrowLeftIcon className="size-4" />
                        </Button>
                    )}
                    <div className="flex items-center justify-between gap-4 w-full">
                        <div className="flex flex-col gap-1">
                            <p className="text-muted-foreground text-md">
                                {question.title}
                            </p>
                            <h3 className="font-semibold text-base leading-tight">
                                {question.text}
                            </h3>
                        </div>
                        <p className="text-muted-foreground shrink-0 text-sm">
                            {question.progressLabel}
                        </p>
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {question.options.map((option) => (
                        <SelectableOptionButton
                            key={option.id}
                            option={option}
                            selected={question.selectedValues.includes(
                                option.id,
                            )}
                            indicatorType={question.indicatorType}
                            onClick={() => actions.onOptionClick(option.id)}
                        />
                    ))}
                </div>
                {question.showOtherInput && (
                    <Textarea
                        value={question.otherValue}
                        onChange={(event) =>
                            actions.onOtherChange(event.target.value)
                        }
                        className="min-h-24 bg-background border-input"
                        placeholder={question.otherPlaceholder}
                    />
                )}
                <div className="flex flex-col gap-2">
                    <div className="rounded-lg border bg-card p-0 overflow-hidden">
                        <Button
                            type="button"
                            className="w-full rounded-none border-0"
                            onClick={actions.onContinue}
                            disabled={!question.canContinue}
                        >
                            {t("continue")}
                        </Button>
                    </div>
                    <Button
                        type="button"
                        variant="ghost"
                        className="w-full"
                        onClick={actions.onSkip}
                    >
                        {t("skip")}
                    </Button>
                </div>
            </div>
        </PageCard>
    );
}
