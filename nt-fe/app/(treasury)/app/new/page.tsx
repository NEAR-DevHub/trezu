"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import {
    ArrowLeftIcon,
    Check,
    Clock10,
    Database,
    Globe,
    Minus,
    Plus,
    Shield,
    UsersRound,
    Vote,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { type ArrayPath, useForm, useFormContext } from "react-hook-form";
import z from "zod";
import { Alert, AlertDescription } from "@/components/alert";
import { Button } from "@/components/button";
import { PageCard } from "@/components/card";
import { CreationDisabledModal } from "@/components/creation-disabled-modal";
import { InputBlock } from "@/components/input-block";
import { LargeInput } from "@/components/large-input";
import {
    type Member,
    MemberInput,
    memberSchema,
} from "@/components/member-input";
import { PageComponentLayout } from "@/components/page-component-layout";
import { ROLES } from "@/components/role-selector";
import {
    InlineNextButton,
    type StepProps,
    StepperHeader,
    StepWizard,
} from "@/components/step-wizard";
import { Form, FormField, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { useTreasury } from "@/hooks/use-treasury";
import { useTreasuryCreationStatus } from "@/hooks/use-treasury-queries";
import { trackEvent } from "@/lib/analytics";
import {
    type CreateTreasuryRequest,
    type TreasuryOnboardingQuestionnaire,
    checkHandleUnused,
    createTreasuryStream,
    saveOnboardingQuestionnaireProgress,
} from "@/lib/api";
import {
    CreationProgressModal,
    type CreationStep,
} from "@/components/creation-progress-modal";
import { useNear } from "@/stores/near-store";
import { InfoAlert } from "@/components/info-alert";
import { TreasuryTypeIcon } from "@/components/icons/shield";
import { getNearIntentsNetworkIconSrc } from "@/constants/network-icons";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Pill } from "@/components/pill";
import { cn } from "@/lib/utils";

const questionnaireAnswerSchema = z.object({
    selected: z.array(z.string()),
    other: z.string().max(280).optional(),
});

const treasuryFormSchema = z
    .object({
        about: z.object({
            networks: questionnaireAnswerSchema,
            useCases: questionnaireAnswerSchema,
            discoverySources: questionnaireAnswerSchema,
        }),
        details: z
            .object({
                treasuryName: z
                    .string()
                    .min(2, "Treasury name should be at least 2 characters")
                    .max(64, "Treasury name must be less than 64 characters"),
                accountName: z
                    .string()
                    .min(2, "Account name should be at least 2 characters")
                    .max(64, "Account name must be less than 64 characters")
                    .regex(
                        /^[a-z0-9-]+$/,
                        "Account name can contain only Latin letters, numbers, and hyphens",
                    ),
                paymentThreshold: z.number().min(1).max(100),
                governanceThreshold: z.number().min(1).max(100),
            })
            .refine(
                async (data) => {
                    if (!data.accountName) return true;
                    const fullAccountId = `${data.accountName}.sputnik-dao.near`;
                    const result = await checkHandleUnused(fullAccountId);
                    return result?.unused === true;
                },
                {
                    message: "This account name is already taken",
                    path: ["accountName"],
                },
            ),
        isConfidential: z.boolean(),
        members: memberSchema,
    })
    .refine((data) => {
        const financialMembers = data.members.filter((m) =>
            m.roles.includes("financial"),
        ).length;
        return data.details.paymentThreshold <= financialMembers;
    });

type TreasuryFormValues = z.infer<typeof treasuryFormSchema>;

interface QuestionnaireOption {
    id: string;
    label: string;
    iconClassName?: string;
    iconSrc?: string;
}

type QuestionnaireBaseFieldName =
    | "about.networks"
    | "about.useCases"
    | "about.discoverySources";

type QuestionnaireFieldName =
    | `${QuestionnaireBaseFieldName}.selected`
    | `${QuestionnaireBaseFieldName}.other`;

const NETWORK_OPTIONS: QuestionnaireOption[] = [
    {
        id: "near",
        label: "NEAR",
        iconSrc:
            "https://s2.coinmarketcap.com/static/img/coins/128x128/6535.png",
    },
    {
        id: "bitcoin",
        label: "Bitcoin",
        iconSrc: getNearIntentsNetworkIconSrc("btc"),
    },
    {
        id: "ethereum",
        label: "Ethereum",
        iconSrc: getNearIntentsNetworkIconSrc("ethereum"),
    },
    {
        id: "solana",
        label: "Solana",
        iconSrc: getNearIntentsNetworkIconSrc("solana"),
    },
    {
        id: "arbitrum",
        label: "Arbitrum",
        iconSrc: getNearIntentsNetworkIconSrc("arbitrum"),
    },
    {
        id: "base",
        label: "Base",
        iconSrc: getNearIntentsNetworkIconSrc("base"),
    },
    {
        id: "optimism",
        label: "Optimism",
        iconSrc: getNearIntentsNetworkIconSrc("optimism"),
    },
    {
        id: "polygon",
        label: "Polygon",
        iconSrc: getNearIntentsNetworkIconSrc("polygon"),
    },
    {
        id: "gnosis",
        label: "Gnosis",
        iconSrc: getNearIntentsNetworkIconSrc("gnosis"),
    },
    {
        id: "avalanche",
        label: "Avalanche",
        iconSrc: getNearIntentsNetworkIconSrc("avalanche"),
    },
    {
        id: "bnb-chain",
        label: "BNB Chain",
        iconSrc: getNearIntentsNetworkIconSrc("bsc"),
    },
    {
        id: "other",
        label: "Other",
        iconClassName: "bg-general-secondary text-muted-foreground",
    },
];

const USE_CASE_OPTIONS: QuestionnaireOption[] = [
    {
        id: "team-payroll-grants",
        label: "Team payroll & grants",
    },
    {
        id: "company-assets-management",
        label: "Company assets management",
    },
    {
        id: "dao-treasury-management",
        label: "DAO treasury management",
    },
    {
        id: "investment-portfolio",
        label: "Investment portfolio",
    },
    {
        id: "operational-spending",
        label: "Operational spending",
    },
    {
        id: "other",
        label: "Other",
    },
];

const DISCOVERY_OPTIONS: QuestionnaireOption[] = [
    {
        id: "google-search",
        label: "Google Search",
    },
    {
        id: "youtube",
        label: "Youtube",
    },
    {
        id: "twitter",
        label: "Twitter",
    },
    {
        id: "recommendation",
        label: "Recommendation",
    },
    {
        id: "near-community",
        label: "Near Community",
    },
    {
        id: "other",
        label: "Other",
    },
];

const QUESTIONNAIRE_STEPS = [
    {
        title: "A few quick questions to begin.",
        question: "Which networks do you use most often?",
        progress: "1/3",
        fieldName: "about.networks" as const,
        placeholder: "Enter network name",
        options: NETWORK_OPTIONS,
    },
    {
        title: "",
        question: "What do you plan to use Trezu for?",
        progress: "2/3",
        fieldName: "about.useCases" as const,
        placeholder: "Describe your use case",
        options: USE_CASE_OPTIONS,
    },
    {
        title: "",
        question: "How did you hear about Trezu?",
        progress: "3/3",
        fieldName: "about.discoverySources" as const,
        placeholder: "Type your answer here",
        options: DISCOVERY_OPTIONS,
    },
];

function getQuestionKey(fieldName: QuestionnaireBaseFieldName): string {
    switch (fieldName) {
        case "about.networks":
            return "networks";
        case "about.useCases":
            return "use_cases";
        case "about.discoverySources":
            return "discovery_sources";
    }
}

function getQuestionnaireSummary(about: TreasuryFormValues["about"]) {
    return {
        networks_selected: about.networks.selected,
        networks_count: about.networks.selected.length,
        networks_other: about.networks.other?.trim() || undefined,
        use_cases_selected: about.useCases.selected,
        use_cases_count: about.useCases.selected.length,
        use_cases_other: about.useCases.other?.trim() || undefined,
        discovery_sources_selected: about.discoverySources.selected,
        discovery_sources_count: about.discoverySources.selected.length,
        discovery_sources_other:
            about.discoverySources.other?.trim() || undefined,
    };
}

function sanitizeQuestionAnswer(answer: {
    selected: string[];
    other?: string;
}) {
    return {
        selected: answer.selected,
        other: answer.other?.trim() ? answer.other.trim() : undefined,
    };
}

function buildOnboardingQuestionnaire(
    about: TreasuryFormValues["about"],
): TreasuryOnboardingQuestionnaire {
    return {
        networks: sanitizeQuestionAnswer(about.networks),
        useCases: sanitizeQuestionAnswer(about.useCases),
        discoverySources: sanitizeQuestionAnswer(about.discoverySources),
    };
}

/**
 * Helper to clear form errors before updating field value
 * Ensures errors disappear immediately when user starts typing
 */
function createClearErrorsOnChange<T>(
    form: ReturnType<typeof useFormContext<TreasuryFormValues>>,
    fieldName: string,
    hasError: boolean,
    onChange: (value: T) => void,
) {
    return (value: T) => {
        if (hasError) {
            form.clearErrors(fieldName as any);
        }
        onChange(value);
    };
}

function QuestionOptionButton({
    option,
    selected,
    onClick,
}: {
    option: QuestionnaireOption;
    selected: boolean;
    onClick: () => void;
}) {
    return (
        <Button
            type="button"
            variant="unstyled"
            onClick={onClick}
            className={cn(
                "w-full rounded-lg border px-3.5 py-2 h-auto justify-between hover:bg-general-secondary/30",
                selected
                    ? "border-foreground bg-general-secondary"
                    : "border-input",
            )}
        >
            <div className="flex items-center gap-3 min-w-0">
                {option.iconSrc ? (
                    <img
                        src={option.iconSrc}
                        alt={option.label}
                        className="size-6 rounded-full object-cover shrink-0"
                    />
                ) : option.iconClassName ? (
                    <div
                        className={cn(
                            "size-6 rounded-full grid place-content-center text-xs font-semibold shrink-0",
                            option.iconClassName,
                        )}
                    ></div>
                ) : null}
                <span className="text-base font-normal text-foreground truncate">
                    {option.label}
                </span>
            </div>
            <div
                className={cn(
                    "size-6 rounded-md border grid place-content-center shrink-0",
                    selected
                        ? "bg-foreground border-foreground text-background"
                        : "bg-muted/30 border-input text-transparent",
                )}
            >
                <Check className="size-4" />
            </div>
        </Button>
    );
}

function AboutYouStep({
    handleNext,
    onboardingSessionId,
    setOnboardingSessionId,
    accountId,
}: StepProps & {
    onboardingSessionId: string | null;
    setOnboardingSessionId: (id: string) => void;
    accountId: string | null;
}) {
    const form = useFormContext<TreasuryFormValues>();
    const [questionIndex, setQuestionIndex] = useState(0);
    const currentQuestion = QUESTIONNAIRE_STEPS[questionIndex];
    const questionKey = getQuestionKey(currentQuestion.fieldName);
    const currentValue = form.watch(currentQuestion.fieldName);
    const selectedValues = currentValue?.selected ?? [];
    const hasOtherSelected = selectedValues.includes("other");
    const hasValidOtherText = !!currentValue?.other?.trim();
    const canContinue =
        selectedValues.length > 0 && (!hasOtherSelected || hasValidOtherText);

    const updateSelection = (optionId: string) => {
        const isSelected = selectedValues.includes(optionId);
        const nextSelected = isSelected
            ? selectedValues.filter((id) => id !== optionId)
            : [...selectedValues, optionId];

        form.setValue(
            `${currentQuestion.fieldName}.selected` as QuestionnaireFieldName,
            nextSelected,
            { shouldDirty: true },
        );

        if (optionId === "other" && isSelected) {
            form.setValue(
                `${currentQuestion.fieldName}.other` as QuestionnaireFieldName,
                "",
                { shouldDirty: true },
            );
        }
    };

    const advanceQuestion = () => {
        if (questionIndex === QUESTIONNAIRE_STEPS.length - 1) {
            handleNext?.();
            return;
        }
        setQuestionIndex((prev) => prev + 1);
    };

    const moveNext = () => {
        trackEvent("onboarding-question-continued", {
            question_key: questionKey,
            question_index: questionIndex + 1,
            selected_count: selectedValues.length,
        });

        const about = form.getValues("about");
        const questionnaire = buildOnboardingQuestionnaire(about);
        void saveOnboardingQuestionnaireProgress({
            onboardingSessionId: onboardingSessionId ?? undefined,
            questionnaire,
            completedSteps: questionIndex + 1,
            accountId: accountId ?? undefined,
        })
            .then((response) => {
                if (!onboardingSessionId) {
                    setOnboardingSessionId(response.onboardingSessionId);
                }
            })
            .catch((error) => {
                console.error(
                    "Failed to save onboarding questionnaire progress",
                    error,
                );
            });

        advanceQuestion();
    };

    const handleSkip = () => {
        trackEvent("onboarding-question-skipped", {
            question_key: questionKey,
            question_index: questionIndex + 1,
            selected_count: selectedValues.length,
        });
        form.setValue(
            `${currentQuestion.fieldName}.selected` as QuestionnaireFieldName,
            [],
            { shouldDirty: true },
        );
        form.setValue(
            `${currentQuestion.fieldName}.other` as QuestionnaireFieldName,
            "",
            { shouldDirty: true },
        );
        advanceQuestion();
    };

    return (
        <PageCard>
            <div className="flex flex-col gap-5">
                <div className="flex items-center gap-2">
                    {questionIndex > 0 && (
                        <Button
                            variant="ghost"
                            size="icon"
                            type="button"
                            onClick={() => setQuestionIndex((prev) => prev - 1)}
                            className="shrink-0 mt-[5px]"
                        >
                            <ArrowLeftIcon className="size-4" />
                        </Button>
                    )}
                    <div className="flex items-start justify-between gap-4 w-full">
                        <div className="flex flex-col gap-1">
                            <p className="text-muted-foreground font-semibold">
                                {currentQuestion.title}
                            </p>
                            <h3 className="font-semibold leading-tight">
                                {currentQuestion.question}
                            </h3>
                        </div>
                        <p className="text-muted-foreground shrink-0 text-sm">
                            {currentQuestion.progress}
                        </p>
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {currentQuestion.options.map((option) => (
                        <QuestionOptionButton
                            key={option.id}
                            option={option}
                            selected={selectedValues.includes(option.id)}
                            onClick={() => updateSelection(option.id)}
                        />
                    ))}
                </div>
                {hasOtherSelected && (
                    <Textarea
                        value={currentValue?.other ?? ""}
                        onChange={(event) => {
                            form.setValue(
                                `${currentQuestion.fieldName}.other` as QuestionnaireFieldName,
                                event.target.value,
                                { shouldDirty: true },
                            );
                        }}
                        className="min-h-24 bg-background border-input"
                        placeholder={currentQuestion.placeholder}
                    />
                )}
                <div className="flex flex-col gap-2">
                    <div className="rounded-lg border bg-card p-0 overflow-hidden">
                        <Button
                            type="button"
                            className="w-full rounded-none border-0"
                            onClick={moveNext}
                            disabled={!canContinue}
                        >
                            Continue
                        </Button>
                    </div>
                    <Button
                        type="button"
                        variant="ghost"
                        className="w-full"
                        onClick={handleSkip}
                    >
                        Skip
                    </Button>
                </div>
            </div>
        </PageCard>
    );
}

function Step1({ handleNext, handleBack }: StepProps) {
    const form = useFormContext<TreasuryFormValues>();
    const [accountNameEdited, setAccountNameEdited] = useState(false);

    const handleContinue = async () => {
        const isValid = await form.trigger([
            "details.treasuryName",
            "details.accountName",
        ]);
        if (isValid && handleNext) {
            trackEvent("treasury-creation-step-1-completed");
            handleNext();
        }
    };

    return (
        <PageCard>
            <StepperHeader title="Create a Treasury" handleBack={handleBack} />

            <FormField
                control={form.control}
                name="details.treasuryName"
                render={({ field, fieldState }) => (
                    <InputBlock
                        title="Treasury Name"
                        invalid={!!fieldState.error}
                        interactive
                    >
                        <LargeInput
                            borderless
                            placeholder="My Treasury"
                            value={field.value}
                            onChange={(e) => {
                                // Clear errors and update field
                                createClearErrorsOnChange(
                                    form,
                                    "details.treasuryName",
                                    !!fieldState.error,
                                    field.onChange,
                                )(e);

                                // Auto-generate account name from treasury name only if user hasn't manually edited it
                                if (!accountNameEdited) {
                                    const generatedHandle = e.target.value
                                        .toLowerCase()
                                        .replace(/[^a-z0-9-]/g, "-")
                                        .replace(/-+/g, "-")
                                        .replace(/^-|-$/g, "")
                                        .slice(0, 64);
                                    form.setValue(
                                        "details.accountName",
                                        generatedHandle,
                                    );
                                    form.clearErrors("details.accountName");
                                }
                            }}
                        />
                        {fieldState.error ? (
                            <FormMessage />
                        ) : (
                            <p className="text-muted-foreground text-xs invisible">
                                Error placeholder
                            </p>
                        )}
                    </InputBlock>
                )}
            />

            <FormField
                control={form.control}
                name="details.accountName"
                render={({ field, fieldState }) => (
                    <InputBlock
                        title="Account Name"
                        interactive
                        info="This is your account's unique name. It will be used in your Treasury URL and shown in transactions to identify who sent the payment. Choose a short, recognizable name for your account."
                        invalid={!!fieldState.error}
                    >
                        <LargeInput
                            borderless
                            placeholder="my-treasury"
                            suffix=".sputnik-dao.near"
                            value={field.value}
                            onChange={(e) => {
                                setAccountNameEdited(true);
                                const input = e.target.value
                                    .toLowerCase()
                                    .replace(/[^a-z0-9_-]/g, "")
                                    .slice(0, 64);
                                field.onChange(input);
                                form.clearErrors("details.accountName");
                            }}
                        />
                        {fieldState.error ? (
                            <FormMessage />
                        ) : (
                            <p className="text-muted-foreground text-xs invisible">
                                Error placeholder
                            </p>
                        )}
                    </InputBlock>
                )}
            />

            <InlineNextButton text="Continue" onClick={handleContinue} />
        </PageCard>
    );
}

const MORE_MEMBERS_NEEDED =
    "You need more members to modify voting settings. Add another member to configure voting.";
const MINIMUM_NEEDED = "Minimum one approval vote required.";

function Threshold({
    title,
    description,
    value,
    onChange,
    max,
}: {
    title: string;
    description: string;
    value: number;
    onChange: (v: number) => void;
    max: number;
}) {
    const canDecrement = value > 1;
    const canIncrement = value < max;

    return (
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4">
            <div className="flex flex-col flex-1 min-w-0">
                <h3 className="font-medium text-sm">{title}</h3>
                <p className="text-sm text-muted-foreground">{description}</p>
            </div>
            <div className="flex items-center gap-4 shrink-0 w-full sm:w-auto justify-start sm:justify-end">
                <Button
                    type="button"
                    variant="secondary"
                    size="icon-sm"
                    onClick={() => onChange(value - 1)}
                    disabled={!canDecrement}
                    tooltipContent={canDecrement ? undefined : MINIMUM_NEEDED}
                >
                    <Minus className="size-4 text-secondary-foreground" />
                </Button>
                <span className="text-sm w-[21px] text-center">
                    {value}/{max}
                </span>
                <Button
                    type="button"
                    variant="secondary"
                    size="icon-sm"
                    onClick={() => onChange(value + 1)}
                    disabled={!canIncrement}
                    tooltipContent={
                        canIncrement ? undefined : MORE_MEMBERS_NEEDED
                    }
                >
                    <Plus className="size-4 text-secondary-foreground" />
                </Button>
            </div>
        </div>
    );
}

function Step2({ handleBack, handleNext }: StepProps) {
    const form = useFormContext<TreasuryFormValues>();
    const { accountId } = useNear();

    const handleContinue = async () => {
        const members = form.getValues("members");
        const memberFieldsToValidate = members.flatMap((_, index) => {
            if (index === 0 && !accountId) return [];
            return [
                `members.${index}.accountId`,
                `members.${index}.roles`,
            ] as const;
        });

        const isValid =
            memberFieldsToValidate.length > 0
                ? await form.trigger(memberFieldsToValidate as any)
                : true;

        if (!accountId) {
            form.clearErrors("members.0.accountId");
        }

        if (isValid && handleNext) {
            trackEvent("treasury-creation-step-2-completed", {
                members_count: form.getValues("members").length,
            });
            handleNext();
        }
    };

    const { members } = form.watch();
    const financialMembers = members.filter((m: Member) =>
        m.roles.includes("financial"),
    ).length;
    const governanceMembers = members.filter((m: Member) =>
        m.roles.includes("governance"),
    ).length;

    useEffect(() => {
        const currentPayment = form.getValues("details.paymentThreshold");
        if (currentPayment > financialMembers) {
            form.setValue(
                "details.paymentThreshold",
                Math.max(1, financialMembers),
            );
        }
    }, [financialMembers]);

    useEffect(() => {
        const currentGovernance = form.getValues("details.governanceThreshold");
        if (currentGovernance > governanceMembers) {
            form.setValue(
                "details.governanceThreshold",
                Math.max(1, governanceMembers),
            );
        }
    }, [governanceMembers]);

    useEffect(() => {
        if (!accountId) {
            form.clearErrors("members.0.accountId");
        }
    }, [accountId, form]);

    return (
        <PageCard>
            <StepperHeader
                title="Add Members"
                description="You can add or update members now and edit this later at any time."
                handleBack={handleBack}
            />

            <InfoAlert message="You can add or update members now and edit this later at any time." />

            <div className="flex flex-col gap-8">
                <MemberInput
                    control={form.control}
                    mode="onboarding"
                    name={`members` as ArrayPath<TreasuryFormValues>}
                />
                <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                        <h3 className="font-semibold">Voting Threshold</h3>
                        <p className="text-sm text-muted-foreground">
                            Set how many votes are required to approve requests:
                        </p>
                    </div>

                    <div className="flex flex-col gap-4">
                        <FormField
                            control={form.control}
                            name="details.paymentThreshold"
                            render={({ field }) => (
                                <Threshold
                                    title="Financial"
                                    description="Approving payment & exchange requests."
                                    value={field.value}
                                    onChange={field.onChange}
                                    max={financialMembers}
                                />
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="details.governanceThreshold"
                            render={({ field }) => (
                                <Threshold
                                    title="Governance"
                                    description="Approving settings, members, and voting configuration."
                                    value={field.value}
                                    onChange={field.onChange}
                                    max={governanceMembers}
                                />
                            )}
                        />
                    </div>
                </div>
                <InlineNextButton text="Continue" onClick={handleContinue} />
            </div>
        </PageCard>
    );
}

export function TreasuryTypePill({
    type,
}: {
    type: "confidential" | "public";
}) {
    const pillStyle = type === "confidential" ? "primary" : "card";
    const pillTitle = type === "confidential" ? "Confidential" : "Public";
    const pillIcon =
        type === "confidential" ? (
            <Shield className="size-3 text-primary-foreground" />
        ) : (
            <Globe className="size-3 text-foreground" />
        );

    return (
        <Pill
            icon={pillIcon}
            title={pillTitle}
            variant={pillStyle}
            className="shrink-0 h-fit"
        />
    );
}

export function Feature({
    title,
    icon,
}: {
    title: string;
    icon: "anyone" | "team" | "soon";
}) {
    const pillStyle =
        icon === "anyone"
            ? "secondary"
            : icon === "team"
              ? "primary"
              : "secondary";
    const pillTitle =
        icon === "anyone" ? "Anyone" : icon === "team" ? "Team Only" : "Soon";
    const pillIcon =
        icon === "anyone" ? (
            <Globe className="size-3 text-foreground" />
        ) : icon === "team" ? (
            <Shield className="size-3 text-primary-foreground" />
        ) : (
            <Clock10 className="size-3 text-foreground" />
        );

    return (
        <div className="flex w-full items-center gap-2">
            <p
                className={cn(
                    "text-foreground text-sm w-full",
                    icon === "soon" && "text-muted-foreground",
                )}
            >
                {title}
            </p>
            <Pill
                icon={pillIcon}
                title={pillTitle}
                variant={pillStyle}
                className="shrink-0"
            />
        </div>
    );
}

const TREASURY_TYPES = [
    {
        isConfidential: false,
        label: "Public",
        description:
            "All balances, activities, and transactions are visible to anyone on the blockchain. This option is best for transparent organizations and public DAOs.",
        visibleOnChain: [
            <Feature title="Balance, Transactions" icon="anyone" />,
            <Feature title="Members, Voting" icon="anyone" />,
        ],
        featuresAvailable: {
            generalText: "All features available",
            features: [],
        },
    },
    {
        isConfidential: true,
        label: "Confidential",
        description:
            "All balances, activities, and transfers private on the blockchain. Only your team can view this information. Best for private companies, family offices, or teams that want financial privacy.",
        visibleOnChain: [
            <Feature title="Balance, Transactions" icon="team" />,
            <Feature title="Members, Voting" icon="anyone" />,
        ],
        featuresAvailable: {
            generalText: "Most features supported",
            features: [
                <Feature title="Recent Transactions Export" icon="soon" />,
                <Feature title="Bulk Payment" icon="soon" />,
            ],
        },
    },
] as const;

function Step3({ handleBack, handleNext }: StepProps) {
    const form = useFormContext<TreasuryFormValues>();
    const handleSelect = (type: "confidential" | "public") => {
        form.setValue("isConfidential", type === "confidential");
        trackEvent("treasury-creation-step-3-completed", {
            treasury_type: type,
        });
        if (handleNext) {
            handleNext();
        }
    };
    return (
        <PageCard>
            <StepperHeader title="Treasury Type" handleBack={handleBack} />
            <InfoAlert message="You can select only one time per tresury and you cannot change it later." />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {TREASURY_TYPES.map((type) => (
                    <Card key={type.isConfidential ? "confidential" : "public"}>
                        <CardHeader className="px-4">
                            <div className="flex items-center gap-2">
                                <TreasuryTypeIcon
                                    type={
                                        type.isConfidential
                                            ? "confidential"
                                            : "public"
                                    }
                                />
                                <CardTitle>{type.label}</CardTitle>
                            </div>
                            <CardDescription className="text-xs">
                                {type.description}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="px-4 flex flex-col gap-6">
                            <div className="flex flex-col gap-2">
                                <p className="text-xs text-muted-foreground uppercase">
                                    Visible on chain
                                </p>
                                {type.visibleOnChain}
                            </div>
                            <div className="flex flex-col gap-2">
                                <p className="text-xs text-muted-foreground uppercase">
                                    Features available
                                </p>
                                <p className="text-sm text-foreground">
                                    {type.featuresAvailable.generalText}
                                </p>
                                {type.featuresAvailable.features}
                            </div>
                        </CardContent>
                        <CardFooter className="mt-auto px-4">
                            <Button
                                variant="default"
                                type="button"
                                className="w-full"
                                onClick={() =>
                                    handleSelect(
                                        type.isConfidential
                                            ? "confidential"
                                            : "public",
                                    )
                                }
                            >
                                Select
                            </Button>
                        </CardFooter>
                    </Card>
                ))}
            </div>
        </PageCard>
    );
}

const VISUAL = [
    {
        icon: <UsersRound className="size-5 text-foreground" />,
        title: "Members",
    },
    {
        icon: <Vote className="size-5 text-foreground" />,
        title: "Financial Threshold",
    },
    {
        icon: <Vote className="size-5 text-foreground" />,
        title: "Governance Threshold",
    },
] as const;

function Step4({
    handleBack,
    accountId,
    connectWallet,
    isConnectingWallet,
}: StepProps & {
    accountId: string | null;
    connectWallet: () => Promise<void>;
    isConnectingWallet: boolean;
}) {
    const form = useFormContext<TreasuryFormValues>();
    const { details } = form.watch();
    const { members } = form.watch();
    const { isConfidential } = form.watch();

    useEffect(() => {
        trackEvent("treasury-creation-step-4-viewed");
    }, []);
    const financialMembers = members.filter((m: Member) =>
        m.roles.includes("financial"),
    ).length;
    const governanceMembers = members.filter((m: Member) =>
        m.roles.includes("governance"),
    ).length;
    const financialThreshold = details.paymentThreshold;
    const governanceThreshold = details.governanceThreshold;
    const financialThresholdVisual = `${financialThreshold}/${financialMembers}`;
    const governanceThresholdVisual = `${governanceThreshold}/${governanceMembers}`;

    return (
        <PageCard>
            <StepperHeader title="Review Treasury" handleBack={handleBack} />

            <div className="flex flex-col gap-2">
                <InputBlock invalid={false}>
                    <div className="flex gap-3 justify-between items-center w-full">
                        <div className="flex gap-3.5 px-3.5 py-3 items-center max-md:min-w-0">
                            <div className="size-10 rounded-[7px] bg-foreground/10 flex items-center justify-center">
                                <Database className="size-5 text-foreground" />
                            </div>
                            <div className="flex flex-col gap-0.5 max-md:min-w-0">
                                <p className="font-bold text-2xl max-md:text-xl max-md:truncate">
                                    {details.treasuryName}
                                </p>
                                <p className="text-xs text-muted-foreground max-md:truncate">
                                    {details.accountName}.sputnik-dao.near
                                </p>
                            </div>
                        </div>
                        <TreasuryTypePill
                            type={isConfidential ? "confidential" : "public"}
                        />
                    </div>
                </InputBlock>
                <div className="grid md:grid-cols-3 grid-cols-1 gap-2">
                    {[
                        members.length,
                        financialThresholdVisual,
                        governanceThresholdVisual,
                    ].map((item, index) => (
                        <InputBlock invalid={false} key={index}>
                            <div className="flex flex-col px-3.5 py-3 gap-1 items-center justify-center max-md:flex-row max-md:gap-2 max-md:justify-start">
                                {VISUAL[index].icon}
                                <div className="flex flex-col items-center gap-0.5 max-md:flex-row max-md:items-baseline max-md:gap-1.5">
                                    <p className="font-semibold text-xl">
                                        {item}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        {VISUAL[index].title}
                                    </p>
                                </div>
                            </div>
                        </InputBlock>
                    ))}
                </div>
            </div>

            <Alert variant="info">
                <AlertDescription>
                    <p className="inline-block text-xs">
                        <div className="font-semibold">
                            🎉 No deployment fee
                        </div>
                        To support new projects, TREZU covers all one-time
                        deployment and network storage fees.
                    </p>
                </AlertDescription>
            </Alert>

            <InlineNextButton
                text={
                    accountId
                        ? "Create Treasury"
                        : "Connect Wallet To Create Treasury"
                }
                loading={
                    accountId ? form.formState.isSubmitting : isConnectingWallet
                }
                onClick={
                    accountId
                        ? undefined
                        : () => {
                              connectWallet();
                          }
                }
            />
        </PageCard>
    );
}

const NON_CONFIDENTIAL_STEPS: CreationStep[] = [
    {
        id: "creating_dao",
        label: "Creating your treasury on NEAR",
        status: "pending",
    },
    { id: "finalizing", label: "Finalizing setup", status: "pending" },
];

const CONFIDENTIAL_STEPS: CreationStep[] = [
    {
        id: "creating_dao",
        label: "Creating your treasury on NEAR",
        status: "pending",
    },
    {
        id: "adding_public_key",
        label: "Registering public key",
        status: "pending",
    },
    {
        id: "authenticating",
        label: "Setting up confidential transactions",
        status: "pending",
    },
    {
        id: "setting_policy",
        label: "Configuring treasury members",
        status: "pending",
    },
    { id: "finalizing", label: "Finalizing setup", status: "pending" },
];

const CREATION_STEP_TITLES = [
    "About You",
    "Details",
    "Members",
    "Treasury Type",
    "Review",
];

export default function NewTreasuryPage() {
    // TEST ONLY: set to true to bypass on-chain treasury creation.
    const SKIP_TREASURY_CREATION_FOR_TESTING = true;

    const { accountId, connect, isAuthenticating } = useNear();
    const { treasuries } = useTreasury();
    const { data: creationStatus } = useTreasuryCreationStatus();
    const creationAvailable = creationStatus?.creationAvailable ?? true;
    const router = useRouter();
    const queryClient = useQueryClient();
    const [step, setStep] = useState(0);
    const [progressOpen, setProgressOpen] = useState(false);
    const [progressSteps, setProgressSteps] = useState<CreationStep[]>([]);
    const [progressError, setProgressError] = useState<string | null>(null);
    const [createdTreasuryId, setCreatedTreasuryId] = useState<string | null>(
        null,
    );
    const viewedStepsRef = useRef<Set<number>>(new Set());
    const onboardingSessionIdRef = useRef<string | null>(null);
    const form = useForm<TreasuryFormValues>({
        resolver: zodResolver(treasuryFormSchema),
        defaultValues: {
            about: {
                networks: { selected: [], other: "" },
                useCases: { selected: [], other: "" },
                discoverySources: { selected: [], other: "" },
            },
            details: {
                paymentThreshold: 1,
                governanceThreshold: 1,
                treasuryName: "",
                accountName: "",
            },
            isConfidential: false,
            members: [
                {
                    accountId: "",
                    roles: ROLES.map((r) => r.id),
                },
            ],
        },
    });
    useEffect(() => {
        if (accountId) {
            form.setValue("members.0.accountId", accountId);
        }
    }, [accountId]);

    useEffect(() => {
        trackEvent("treasury-create-page-viewed", {
            source: "/app/new",
            has_account_id: !!accountId,
            treasuries_count: treasuries?.length ?? 0,
        });
    }, []);

    useEffect(() => {
        if (viewedStepsRef.current.has(step)) return;
        viewedStepsRef.current.add(step);
        trackEvent("treasury-create-step-viewed", {
            step_index: step + 1,
            step_title: CREATION_STEP_TITLES[step] ?? `step_${step + 1}`,
        });
    }, [step]);

    const onSubmit = async (data: TreasuryFormValues) => {
        if (!accountId) {
            await connect();
            return;
        }

        const governors = data.members
            .filter((m) => m.roles.includes("governance"))
            .map((m) => m.accountId);
        const financiers = data.members
            .filter((m) => m.roles.includes("financial"))
            .map((m) => m.accountId);
        const requestors = data.members
            .filter((m) => m.roles.includes("requestor"))
            .map((m) => m.accountId);
        const onboardingQuestionnaire = buildOnboardingQuestionnaire(
            data.about,
        );

        const request: CreateTreasuryRequest = {
            name: data.details.treasuryName,
            accountId: `${data.details.accountName}.sputnik-dao.near`,
            paymentThreshold: data.details.paymentThreshold,
            governanceThreshold: data.details.governanceThreshold,
            governors,
            isConfidential: data.isConfidential,
            financiers,
            requestors,
            onboardingQuestionnaire,
        };

        console.log(request);
        trackEvent("treasury-create-submit-clicked", {
            ...getQuestionnaireSummary(data.about),
            members_count: data.members.length,
            treasury_type: data.isConfidential ? "confidential" : "public",
        });

        const initialSteps = request.isConfidential
            ? CONFIDENTIAL_STEPS
            : NON_CONFIDENTIAL_STEPS;

        setProgressSteps(initialSteps.map((s) => ({ ...s })));
        setProgressError(null);
        setCreatedTreasuryId(null);
        setProgressOpen(true);

        try {
            if (SKIP_TREASURY_CREATION_FOR_TESTING) {
                const treasuryId = request.accountId;
                setProgressSteps((prev) =>
                    prev.map((s) => ({
                        ...s,
                        status: "completed" as const,
                    })),
                );
                setCreatedTreasuryId(treasuryId);
                return;
            }

            await createTreasuryStream(request, (event) => {
                if (event.step === "done") {
                    const treasuryId = event.treasury!;
                    setProgressSteps((prev) =>
                        prev.map((s) => ({
                            ...s,
                            status: "completed" as const,
                        })),
                    );
                    setCreatedTreasuryId(treasuryId);
                    void saveOnboardingQuestionnaireProgress({
                        onboardingSessionId:
                            onboardingSessionIdRef.current ?? undefined,
                        questionnaire: onboardingQuestionnaire,
                        completedSteps: QUESTIONNAIRE_STEPS.length,
                        accountId: accountId ?? undefined,
                        treasuryAccountId: treasuryId,
                    })
                        .then((response) => {
                            if (!onboardingSessionIdRef.current) {
                                onboardingSessionIdRef.current =
                                    response.onboardingSessionId;
                            }
                        })
                        .catch((error) => {
                            console.error(
                                "Failed to link onboarding questionnaire to treasury",
                                error,
                            );
                        });
                    trackEvent("treasury-created", {
                        treasury_id: treasuryId,
                        source: "/app/new",
                        members_count:
                            request.governors.length +
                            request.financiers.length +
                            request.requestors.length,
                    });
                    queryClient.invalidateQueries({
                        queryKey: ["userTreasuries", accountId],
                    });
                } else if (event.step === "error") {
                    setProgressSteps((prev) =>
                        prev.map((s) =>
                            s.status === "in_progress"
                                ? { ...s, status: "error" as const }
                                : s,
                        ),
                    );
                    setProgressError(
                        event.message ?? "An unexpected error occurred",
                    );
                } else {
                    setProgressSteps((prev) =>
                        prev.map((s) => {
                            if (s.id === event.step) {
                                return {
                                    ...s,
                                    status: event.status as CreationStep["status"],
                                };
                            }
                            return s;
                        }),
                    );
                }
            });
        } catch (error) {
            console.error("Treasury creation error", error);
            setProgressSteps((prev) =>
                prev.map((s) =>
                    s.status === "in_progress"
                        ? { ...s, status: "error" as const }
                        : s,
                ),
            );
            setProgressError("Failed to create treasury. Please try again.");
        }
    };

    return (
        <>
            <CreationProgressModal
                open={progressOpen}
                steps={progressSteps}
                error={progressError}
                treasuryId={createdTreasuryId}
                onNavigate={() => {
                    if (createdTreasuryId) {
                        router.push(`/${createdTreasuryId}`);
                    }
                }}
            />
            <CreationDisabledModal
                open={!creationAvailable}
                onClose={() => router.push("/")}
            />
            <PageComponentLayout
                title="Create Treasury"
                hideCollapseButton
                description="Set up a new multisig treasury for your team"
                backButton={treasuries?.length > 0 ? "/" : undefined}
            >
                <Form {...form}>
                    <form
                        onSubmit={form.handleSubmit(onSubmit)}
                        className="flex flex-col gap-4 max-w-[668px] mx-auto"
                    >
                        <StepWizard
                            step={step}
                            onStepChange={setStep}
                            stepTitles={CREATION_STEP_TITLES}
                            stepLabelClassName="hidden md:inline"
                            steps={[
                                {
                                    component: AboutYouStep,
                                    props: {
                                        onboardingSessionId:
                                            onboardingSessionIdRef.current,
                                        setOnboardingSessionId: (
                                            id: string,
                                        ) => {
                                            onboardingSessionIdRef.current = id;
                                        },
                                        accountId,
                                    },
                                },
                                { component: Step1 },
                                { component: Step2 },
                                { component: Step3 },
                                {
                                    component: Step4,
                                    props: {
                                        accountId,
                                        connectWallet: connect,
                                        isConnectingWallet: isAuthenticating,
                                    },
                                },
                            ]}
                        />
                    </form>
                </Form>
            </PageComponentLayout>
        </>
    );
}
