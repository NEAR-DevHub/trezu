"use client";

import { PageCard } from "@/components/card";
import { InputBlock } from "@/components/input-block";
import { PageComponentLayout } from "@/components/page-component-layout";
import {
    StepperHeader,
    StepProps,
    StepWizard,
    InlineNextButton,
} from "@/components/step-wizard";
import { Button } from "@/components/button";
import { Form, FormField, FormMessage } from "@/components/ui/form";
import { LargeInput } from "@/components/large-input";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { ArrayPath, useForm, useFormContext } from "react-hook-form";
import z from "zod";
import {
    checkHandleUnused,
    createTreasury,
    CreateTreasuryRequest,
} from "@/lib/api";
import { Member, MemberInput, memberSchema } from "@/components/member-input";
import { useNear } from "@/stores/near-store";
import { Database, Minus, Plus, UsersRound, Vote } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { ROLES } from "@/components/role-selector";
import { Alert, AlertDescription } from "@/components/alert";
import { useTreasury } from "@/hooks/use-treasury";

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

    const handleReview = async () => {
        const isValid = await form.trigger(["members"]);
        if (isValid && handleNext) {
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

    return (
        <PageCard>
            <StepperHeader
                title="Add Members"
                description="You can add or update members now and edit this later at any time."
                handleBack={handleBack}
            />

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
                <InlineNextButton
                    text="Review Treasury"
                    onClick={handleReview}
                />
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

function Step3({ handleBack }: StepProps) {
    const form = useFormContext<TreasuryFormValues>();
    const { details } = form.watch();
    const { members } = form.watch();
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

export default function NewTreasuryPage() {
    const { accountId, isInitializing } = useNear();
    const { treasuries } = useTreasury();
    const router = useRouter();
    const queryClient = useQueryClient();
    const [step, setStep] = useState(0);
    const form = useForm<TreasuryFormValues>({
        resolver: zodResolver(treasuryFormSchema),
        defaultValues: {
            details: {
                paymentThreshold: 1,
                governanceThreshold: 1,
                treasuryName: "",
                accountName: "",
            },
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
        try {
            // Extract unique account IDs for each role
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
                financiers,
                requestors,
            };

            await createTreasury(request)
                .then((response) => {
                    queryClient.invalidateQueries({
                        queryKey: ["userTreasuries", accountId],
                    });
                    toast.success("Treasury created successfully");
                    router.push(`/${response.treasury}`);
                })
                .catch((error) => {
                    console.error("Treasury creation error", error);
                    toast.error("Failed to create treasury");
                });
        } catch (error) {
            console.error("Treasury creation error", error);
            toast.error("Failed to create treasury");
        }
    };

    return (
        <PageComponentLayout
            title="Create Treasury"
            hideCollapseButton
            description="Set up a new multisig treasury for your team"
            backButton={treasuries?.length > 0 ? "/" : undefined}
        >
            <Form {...form}>
                <form
                    onSubmit={form.handleSubmit(onSubmit)}
                    className="flex flex-col gap-4 max-w-[600px] mx-auto"
                >
                    <StepWizard
                        step={step}
                        onStepChange={setStep}
                        stepTitles={["Details", "Members", "Review"]}
                        steps={[
                            {
                                component: Step1,
                            },
                            {
                                component: Step2,
                            },
                            {
                                component: Step3,
                            },
                        ]}
                    />
                </form>
            </Form>
        </PageComponentLayout>
    );
}
