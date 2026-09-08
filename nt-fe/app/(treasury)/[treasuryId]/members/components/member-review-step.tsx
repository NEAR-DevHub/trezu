"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useFormContext } from "react-hook-form";
import { PageCard } from "@/components/card";
import { CreateRequestButton } from "@/components/create-request-button";
import { RoleBadge } from "@/components/role-badge";
import { ReviewStep, type StepProps } from "@/components/step-wizard";
import { User } from "@/components/user";
import { formatShortAddress } from "@/lib/format-short-address";
import { isCompleteMember } from "@/lib/member-draft";
import { sortRolesByOrder } from "@/lib/role-utils";
import type { MemberFormData } from "./member-form-step";

interface MemberReviewStepProps extends StepProps {
    onSubmit: () => Promise<void>;
    validationError?: string;
    mode?: "add" | "edit";
    /** Join-request review: show profile name + id without avatar */
    showJoinProfiles?: boolean;
    existingMembers?: Array<{
        accountId: string;
        roles: string[];
    }>;
    /** Title and back live in the page header instead of an in-page stepper. */
    hideInnerHeader?: boolean;
}

export function MemberReviewStep({
    handleBack,
    onSubmit,
    validationError,
    mode = "add",
    showJoinProfiles = false,
    existingMembers = [],
    hideInnerHeader = false,
}: MemberReviewStepProps) {
    const t = useTranslations("members.previewModal");
    const tInput = useTranslations("memberInput");
    const form = useFormContext<MemberFormData>();
    const [isSubmitting, setIsSubmitting] = useState(false);

    const members = form.watch("members") ?? [];
    const isEditMode = mode === "edit";

    const membersToShow = (
        isEditMode
            ? members.filter((member) => {
                  const existingMember = existingMembers.find(
                      (m) => m.accountId === member.accountId,
                  );
                  if (!existingMember) return false;

                  const currentRolesSorted = sortRolesByOrder([
                      ...(member.roles ?? []),
                  ]).join(",");
                  const existingRolesSorted = sortRolesByOrder([
                      ...existingMember.roles,
                  ]).join(",");

                  return currentRolesSorted !== existingRolesSorted;
              })
            : members
    ).filter(isCompleteMember);

    const handleSubmit = async () => {
        setIsSubmitting(true);
        try {
            await onSubmit();
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <ReviewStep
            reviewingTitle={t("title")}
            handleBack={handleBack}
            backDisabled={isSubmitting}
            hideHeader={hideInnerHeader}
        >
            <PageCard className="items-center gap-1 py-8 text-center">
                <p className="text-sm text-muted-foreground">
                    {isEditMode ? t("youAreEditing") : t("youAreAdding")}
                </p>
                <h3 className="text-3xl font-bold">
                    {isEditMode
                        ? t("membersCount", { count: membersToShow.length })
                        : t("newMembersCount", {
                              count: membersToShow.length,
                          })}
                </h3>
            </PageCard>

            <div className="flex flex-col">
                {membersToShow.map((member, index) => (
                    <div
                        key={isEditMode ? member.accountId : index}
                        className="flex flex-col gap-2 border-b border-general-border py-4 last:border-b-0"
                    >
                        <p className="text-sm font-medium leading-[1.5] text-general-secondary-foreground">
                            {tInput("memberNumber", { number: index + 1 })}
                        </p>
                        <div className="flex items-center justify-between gap-4">
                            {showJoinProfiles ? (
                                <User
                                    accountId={member.accountId}
                                    variant="details"
                                    withLink={false}
                                    truncateAddress={false}
                                />
                            ) : (
                                <span className="min-w-0 overflow-hidden text-ellipsis text-sm font-medium leading-[1.5] text-general-foreground">
                                    {formatShortAddress(member.accountId)}
                                </span>
                            )}
                            <div className="flex flex-wrap justify-end gap-2">
                                {sortRolesByOrder(member.roles ?? []).map(
                                    (role) => (
                                        <RoleBadge
                                            key={role}
                                            role={role}
                                            variant="pill"
                                            showTooltip={false}
                                        />
                                    ),
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <CreateRequestButton
                type="button"
                onClick={handleSubmit}
                className="h-11 w-full rounded-2xl"
                disabled={isSubmitting || !!validationError}
                isSubmitting={isSubmitting}
                idleMessage={t("confirmSubmit")}
                loadingMessage={t("creatingProposal")}
                permissions={{ kind: "policy", action: "AddProposal" }}
            />
        </ReviewStep>
    );
}
