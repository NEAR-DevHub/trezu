"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Alert02Icon, ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Alert, AlertDescription } from "@/components/alert";
import { Button } from "@/components/button";
import { PageCard } from "@/components/card";
import { CreateRequestButton } from "@/components/create-request-button";
import { Icon } from "@/components/icon";
import { Input } from "@/components/input";
import { NumberBadge } from "@/components/number-badge";
import { normalizeRoleId, useFormatRoleName } from "@/components/role-name";
import { ThresholdStepper } from "@/components/threshold";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormMessage,
} from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import {
    thresholdSetupKey,
    writeOnboardingFlag,
} from "@/features/onboarding/onboarding-steps";
import { useProposals } from "@/hooks/use-proposals";
import { useTreasury } from "@/hooks/use-treasury";
import { useTreasuryPolicy } from "@/hooks/use-treasury-queries";
import { hasPermission } from "@/lib/config-utils";
import { cn, encodeToMarkdown } from "@/lib/utils";
import { useNear } from "@/stores/near-store";
import { disabledActionClasses } from "./button-styles";
import { MemberAvatarsWithOverflow } from "./member-avatars-with-overflow";

type VotingFormValues = {
    voteDuration: string;
    thresholds: Record<string, number>;
};

const proposalKinds = [
    "config",
    "policy",
    "add_bounty",
    "bounty_done",
    "transfer",
    "vote",
    "remove_member_from_role",
    "add_member_to_role",
    "call",
    "upgrade_self",
    "upgrade_remote",
    "set_vote_token",
];

/**
 * Which "these members approve …" line a role's card gets. Roles are treasury
 * data, so anything outside the two canonical ids falls back to a generic line.
 */
function roleDescriptionId(
    roleName: string,
): "financial" | "governance" | "generic" {
    const id = normalizeRoleId(roleName).toLowerCase();
    if (id === "financial") return "financial";
    if (id === "governance") return "governance";
    return "generic";
}

/** Design order: Financial first, then Governance, then anything custom. */
function roleOrder(roleName: string): number {
    const id = roleDescriptionId(roleName);
    if (id === "financial") return 0;
    if (id === "governance") return 1;
    return 2;
}

export function VotingTab() {
    const t = useTranslations("settings.voting");
    const formatRoleName = useFormatRoleName();
    const votingFormSchema = useMemo(
        () =>
            z.object({
                voteDuration: z
                    .string()
                    .min(1, t("validation.required"))
                    .refine((val) => !isNaN(Number(val)), {
                        message: t("validation.validNumber"),
                    })
                    .refine((val) => Number(val) >= 1, {
                        message: t("validation.min"),
                    })
                    .refine((val) => Number(val) < 1000, {
                        message: t("validation.max"),
                    })
                    .refine((val) => Number.isInteger(Number(val)), {
                        message: t("validation.whole"),
                    }),
                thresholds: z.record(z.string(), z.number()),
            }),
        [t],
    );
    const { treasuryId } = useTreasury();
    const { data: policy } = useTreasuryPolicy(treasuryId);
    const { accountId, createProposal } = useNear();
    const queryClient = useQueryClient();
    const router = useRouter();

    // Fetch pending proposals to check for active voting change requests
    const { data: pendingProposals } = useProposals(treasuryId, {
        statuses: ["InProgress"],
        proposal_types: ["ChangePolicy", "ChangePolicyUpdateParameters"],
    });

    // Policy changes queue badly, so any in-flight one blocks creating another.
    const pendingVotingRequestCount = useMemo(() => {
        if (!pendingProposals?.proposals) return 0;
        return pendingProposals.proposals.filter(
            (p) =>
                p.kind &&
                ("ChangePolicy" in p.kind ||
                    "ChangePolicyUpdateParameters" in p.kind),
        ).length;
    }, [pendingProposals]);
    const hasPendingVotingRequest = pendingVotingRequestCount > 0;

    const form = useForm<VotingFormValues>({
        resolver: zodResolver(votingFormSchema),
        mode: "onChange",
        defaultValues: {
            voteDuration: "7",
            thresholds: {},
        },
    });

    const [originalDuration, setOriginalDuration] = useState<string>("");
    const [originalThresholds, setOriginalThresholds] = useState<
        Record<string, number>
    >({});
    const [submittingRole, setSubmittingRole] = useState<string | null>(null);
    const [isSubmittingDuration, setIsSubmittingDuration] = useState(false);

    // Check if user is authorized to make policy changes
    const isAuthorized = useMemo(() => {
        if (!policy || !accountId) return false;
        return hasPermission(policy, accountId, "policy", "AddProposal");
    }, [policy, accountId]);

    // Get roles with Group kind (filter out Everyone and Member)
    const groupRoles = useMemo(() => {
        if (!policy?.roles) return [];

        return policy.roles
            .filter((role) => {
                if (role.kind === "Everyone") return false;

                // Filter out specific role names
                const roleName = role.name.toLowerCase();
                if (
                    roleName === "create requests" ||
                    roleName === "requestor" ||
                    roleName === "all"
                ) {
                    return false;
                }

                return true;
            })
            .map((role) => {
                // Get the first available vote policy key, or use default
                const firstPolicyKey = Object.keys(role.vote_policy)[0];
                const votePolicy = firstPolicyKey
                    ? role.vote_policy[firstPolicyKey]
                    : policy.default_vote_policy;

                const members = (
                    typeof role.kind === "object" && "Group" in role.kind
                        ? role.kind.Group
                        : []
                ) as string[];
                const memberCount = members.length;

                // Calculate threshold for THIS specific role
                let threshold = 1;
                if (votePolicy.weight_kind === "RoleWeight") {
                    if (Array.isArray(votePolicy.threshold)) {
                        // It's a ratio array: [numerator, denominator]
                        const [numerator, denominator] = votePolicy.threshold;
                        if (denominator > 0) {
                            threshold = Math.ceil(
                                (numerator / denominator) * memberCount,
                            );
                        }
                    } else if (typeof votePolicy.threshold === "string") {
                        // It's a direct number as string (U128)
                        threshold = parseFloat(votePolicy.threshold);
                    }
                }

                threshold = Math.max(1, threshold || 1);
                return {
                    name: role.name,
                    members,
                    votePolicy,
                    threshold,
                    memberCount,
                };
            })
            .sort((a, b) => roleOrder(a.name) - roleOrder(b.name));
    }, [policy]);

    // Initialize form with policy data
    useEffect(() => {
        if (policy?.proposal_period && groupRoles.length > 0) {
            const nanoseconds = BigInt(policy.proposal_period);
            const days = Number(nanoseconds / BigInt(86400000000000)); // ns to days

            // Initialize thresholds for each role
            const initialThresholds: Record<string, number> = {};
            groupRoles.forEach((role) => {
                initialThresholds[role.name] = role.threshold;
            });

            setOriginalDuration(days.toString());

            form.reset({
                voteDuration: days.toString(),
                thresholds: initialThresholds,
            });

            // Save original thresholds for comparison
            setOriginalThresholds(initialThresholds);
        }
    }, [policy, groupRoles, form]);

    const handleThresholdChange = async (roleName: string) => {
        if (!treasuryId || !policy) {
            toast.error(t("missingData"));
            return;
        }

        setSubmittingRole(roleName);
        try {
            const thresholds = form.watch("thresholds");
            const newThreshold = thresholds[roleName];

            const description = {
                title: t("thresholdProposalTitle"),
                summary: t("thresholdProposalSummary", {
                    account: accountId ?? "",
                    oldValue: originalThresholds[roleName],
                    newValue: newThreshold,
                }),
            };

            const proposalBond = policy?.proposal_bond || "0";

            await createProposal(t("thresholdSubmitted"), {
                treasuryId: treasuryId,
                proposal: {
                    description: encodeToMarkdown(description),
                    kind: {
                        ChangePolicy: {
                            policy: {
                                ...policy,
                                roles: policy.roles?.map((role) => {
                                    if (role.name === roleName) {
                                        const vote_policy =
                                            proposalKinds.reduce(
                                                (
                                                    policy: Record<string, any>,
                                                    kind: string,
                                                ) => {
                                                    (
                                                        policy as Record<
                                                            string,
                                                            any
                                                        >
                                                    )[kind] = {
                                                        weight_kind:
                                                            "RoleWeight",
                                                        quorum: "0",
                                                        threshold:
                                                            newThreshold.toString(),
                                                    };
                                                    return policy;
                                                },
                                                {},
                                            );
                                        return {
                                            ...role,
                                            vote_policy,
                                        };
                                    }
                                    return role;
                                }),
                            },
                        },
                    },
                },
                proposalBond: proposalBond,
                proposalType: "other",
            });

            // Refetch proposals to show the newly created proposal
            queryClient.invalidateQueries({
                queryKey: ["proposals", treasuryId],
            });
            writeOnboardingFlag(thresholdSetupKey(treasuryId));

            // Update original thresholds
            setOriginalThresholds((prev) => ({
                ...prev,
                [roleName]: newThreshold,
            }));
        } catch (error) {
            console.error("Error creating proposal:", error);
            toast.error(t("createProposalFailed"));
        } finally {
            setSubmittingRole(null);
        }
    };

    const handleDurationChange = async () => {
        if (!treasuryId || !policy) {
            toast.error(t("missingData"));
            return;
        }

        // Validate the vote duration field
        const isValid = await form.trigger("voteDuration");
        if (!isValid) {
            return;
        }

        setIsSubmittingDuration(true);
        try {
            const voteDuration = form.watch("voteDuration");
            const durationInNanoseconds =
                Number(voteDuration) * 24 * 60 * 60 * 1_000_000_000;

            const description = {
                title: t("durationProposalTitle"),
                summary: t("durationProposalSummary", {
                    account: accountId ?? "",
                    oldValue: originalDuration,
                    newValue: voteDuration,
                }),
            };

            const proposalBond = policy?.proposal_bond || "0";

            await createProposal(t("durationSubmitted"), {
                treasuryId: treasuryId,
                proposal: {
                    description: encodeToMarkdown(description),
                    kind: {
                        ChangePolicyUpdateParameters: {
                            parameters: {
                                proposal_period:
                                    durationInNanoseconds.toString(),
                            },
                        },
                    },
                },
                proposalBond: proposalBond,
                proposalType: "other",
            });

            // Refetch proposals to show the newly created proposal
            queryClient.invalidateQueries({
                queryKey: ["proposals", treasuryId],
            });
            writeOnboardingFlag(thresholdSetupKey(treasuryId));

            // Mark as not dirty
            form.reset(form.getValues());
        } catch (error) {
            console.error("Error creating proposal:", error);
        } finally {
            setIsSubmittingDuration(false);
        }
    };

    const thresholds = form.watch("thresholds");

    return (
        <Form {...form}>
            <div className="flex flex-col gap-5">
                {hasPendingVotingRequest && (
                    <Alert
                        variant="warning"
                        className="rounded-3xl border-[#FEF3C6] bg-[#FFFBEB] p-3 text-[#973C00] has-[>svg]:gap-x-3 [&>svg]:size-5 [&>svg]:translate-y-0 [&>svg]:text-white"
                    >
                        <Icon
                            icon={Alert02Icon}
                            className="size-5 shrink-0 fill-[#FE9A00] [&>path:first-child]:stroke-[#FE9A00]"
                        />
                        <AlertDescription className="min-w-0 flex-1 gap-2.5 [&_p]:leading-[1.5]">
                            <p className="text-sm font-medium">
                                {t("pendingAlert", {
                                    count: pendingVotingRequestCount,
                                })}
                            </p>
                            <Button
                                size="sm"
                                className="h-7 gap-1.5 rounded-sm px-2 py-[3px] text-xs leading-none has-[>svg]:px-2"
                                onClick={() =>
                                    router.push(
                                        `/${treasuryId}/requests?tab=InProgress`,
                                    )
                                }
                            >
                                {t("viewRequest")}
                                <Icon
                                    icon={ArrowUpRight01Icon}
                                    className="size-3.5"
                                />
                            </Button>
                        </AlertDescription>
                    </Alert>
                )}

                {groupRoles.map((role) => {
                    const currentThreshold =
                        thresholds?.[role.name] ?? role.threshold;

                    return (
                        <PageCard key={role.name} className="gap-3">
                            <div className="flex flex-col gap-1">
                                <h3 className="text-base font-semibold leading-[1.2]">
                                    {t("roleThresholdTitle", {
                                        role: formatRoleName(role.name),
                                    })}
                                </h3>
                                <p className="text-sm font-medium leading-[1.5] text-general-secondary-foreground">
                                    {t(
                                        `roleDescription.${roleDescriptionId(role.name)}`,
                                    )}
                                </p>
                            </div>

                            <div className="flex flex-col gap-2 pb-3">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm text-general-secondary-foreground">
                                        {t("membersWhoCanVote")}
                                    </span>
                                    <NumberBadge
                                        number={role.memberCount}
                                        variant="outline"
                                    />
                                </div>

                                <div className="flex items-center justify-between gap-4">
                                    <MemberAvatarsWithOverflow
                                        members={role.members}
                                        totalCount={role.memberCount}
                                        className="w-auto min-w-0 flex-1"
                                    />
                                    <ThresholdStepper
                                        currentThreshold={currentThreshold}
                                        memberCount={role.memberCount}
                                        onValueChange={(value) => {
                                            form.setValue(
                                                "thresholds",
                                                {
                                                    ...thresholds,
                                                    [role.name]: value,
                                                },
                                                { shouldDirty: true },
                                            );
                                        }}
                                        disabled={
                                            !isAuthorized ||
                                            hasPendingVotingRequest
                                        }
                                    />
                                </div>
                            </div>

                            <CreateRequestButton
                                onClick={() => handleThresholdChange(role.name)}
                                isSubmitting={submittingRole === role.name}
                                permissions={{
                                    kind: "policy",
                                    action: "AddProposal",
                                }}
                                disabled={
                                    hasPendingVotingRequest ||
                                    currentThreshold ===
                                        originalThresholds[role.name]
                                }
                                className={cn(
                                    "h-10 w-full",
                                    disabledActionClasses,
                                )}
                            />
                        </PageCard>
                    );
                })}

                <PageCard className="gap-3">
                    <div className="flex flex-col gap-1">
                        <h3 className="text-base font-semibold leading-[1.2]">
                            {t("durationHeading")}
                        </h3>
                        <p className="text-sm font-medium leading-[1.5] text-general-secondary-foreground">
                            {t("durationDescription")}
                        </p>
                    </div>

                    <FormField
                        control={form.control}
                        name="voteDuration"
                        render={({ field }) => (
                            <FormItem className="flex flex-col gap-1">
                                <Label
                                    htmlFor="vote-duration"
                                    className="text-sm text-general-secondary-foreground"
                                >
                                    {t("days")}
                                </Label>
                                <FormControl>
                                    <Input
                                        id="vote-duration"
                                        type="number"
                                        min="1"
                                        max="999"
                                        clearable={false}
                                        step="1"
                                        inputClassName="h-10 rounded-lg"
                                        disabled={
                                            !isAuthorized ||
                                            hasPendingVotingRequest
                                        }
                                        {...field}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    <CreateRequestButton
                        onClick={handleDurationChange}
                        isSubmitting={isSubmittingDuration}
                        permissions={{ kind: "policy", action: "AddProposal" }}
                        disabled={
                            hasPendingVotingRequest ||
                            !form.formState.dirtyFields.voteDuration ||
                            !!form.formState.errors.voteDuration
                        }
                        className={cn("h-10 w-full", disabledActionClasses)}
                    />
                </PageCard>
            </div>
        </Form>
    );
}
