"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import {
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
import { useEffect, useState } from "react";
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
import { useTreasury } from "@/hooks/use-treasury";
import { useTreasuryCreationStatus } from "@/hooks/use-treasury-queries";
import { trackEvent } from "@/lib/analytics";
import {
    type CreateTreasuryRequest,
    checkHandleUnused,
    createTreasuryStream,
} from "@/lib/api";
import {
    CreationProgressModal,
    type CreationStep,
} from "@/components/creation-progress-modal";
import { useNear } from "@/stores/near-store";
import { InfoAlert } from "@/components/info-alert";
import { TreasuryTypeIcon } from "@/components/icons/shield";
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
import { features } from "@/constants/features";

const treasuryFormSchema = z
    .object({
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

function Step1({ handleNext }: StepProps) {
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
            <StepperHeader title="Create a Treasury" />

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
        <div className="flex items-center gap-4">
            <div className="flex flex-col flex-1 min-w-0">
                <h3 className="font-medium text-sm">{title}</h3>
                <p className="text-sm text-muted-foreground">{description}</p>
            </div>
            <div className="flex items-center gap-4 shrink-0">
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

    const handleContinue = async () => {
        const isValid = await form.trigger(["members"]);
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
            <Feature title="Balance, Transactions, etc." icon="anyone" />,
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
            <Feature title="Balance, Transactions, etc." icon="team" />,
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

function Step4({ handleBack }: StepProps) {
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
                        <div className="flex gap-3.5 px-3.5 py-3 items-center">
                            <div className="size-10 rounded-[7px] bg-foreground/10 flex items-center justify-center">
                                <Database className="size-5 text-foreground" />
                            </div>
                            <div className="flex flex-col gap-0.5">
                                <p className="font-bold text-2xl">
                                    {details.treasuryName}
                                </p>
                                <p className="text-xs text-muted-foreground">
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
                            <div className="flex flex-col px-3.5 py-3 gap-1 items-center justify-center">
                                {VISUAL[index].icon}
                                <p className="font-semibold text-xl">{item}</p>
                                <p className="text-xs text-muted-foreground">
                                    {VISUAL[index].title}
                                </p>
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
                text="Create Treasury"
                loading={form.formState.isSubmitting}
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

export default function NewTreasuryPage() {
    const { accountId, isInitializing } = useNear();
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
    const form = useForm<TreasuryFormValues>({
        resolver: zodResolver(treasuryFormSchema),
        defaultValues: {
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
        if (!isInitializing && !accountId) {
            router.push("/");
        }
    }, [accountId, isInitializing]);

    const onSubmit = async (data: TreasuryFormValues) => {
        const governors = data.members
            .filter((m) => m.roles.includes("governance"))
            .map((m) => m.accountId);
        const financiers = data.members
            .filter((m) => m.roles.includes("financial"))
            .map((m) => m.accountId);
        const requestors = data.members
            .filter((m) => m.roles.includes("requestor"))
            .map((m) => m.accountId);

        const request: CreateTreasuryRequest = {
            name: data.details.treasuryName,
            accountId: `${data.details.accountName}.sputnik-dao.near`,
            paymentThreshold: data.details.paymentThreshold,
            governanceThreshold: data.details.governanceThreshold,
            governors,
            isConfidential: data.isConfidential,
            financiers,
            requestors,
        };

        const initialSteps = request.isConfidential
            ? CONFIDENTIAL_STEPS
            : NON_CONFIDENTIAL_STEPS;

        setProgressSteps(initialSteps.map((s) => ({ ...s })));
        setProgressError(null);
        setCreatedTreasuryId(null);
        setProgressOpen(true);

        try {
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
                open={!creationAvailable && false}
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
                            stepTitles={
                                features.confidential
                                    ? [
                                          "Details",
                                          "Members",
                                          "Treasury Type",
                                          "Review",
                                      ]
                                    : ["Details", "Members", "Review"]
                            }
                            steps={
                                features.confidential
                                    ? [
                                          { component: Step1 },
                                          { component: Step2 },
                                          { component: Step3 },
                                          { component: Step4 },
                                      ]
                                    : [
                                          { component: Step1 },
                                          { component: Step2 },
                                          { component: Step4 },
                                      ]
                            }
                        />
                    </form>
                </Form>
            </PageComponentLayout>
        </>
    );
}
