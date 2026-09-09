"use client";

import {
    Add01Icon,
    ArrowRight01Icon,
    Delete01Icon,
    Edit03Icon,
    InformationCircleIcon,
    SentIcon,
    UserAdd01Icon,
    Wallet03Icon,
} from "@hugeicons/core-free-icons";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AuthButton } from "@/components/auth-button";
import { Button } from "@/components/button";
import { FormattedDate } from "@/components/formatted-date";
import { EmptyState } from "@/components/empty-state";
import { Icon } from "@/components/icon";
import { NumberBadge } from "@/components/number-badge";
import { PageComponentLayout } from "@/components/page-component-layout";
import { RoleBadge } from "@/components/role-badge";
import { useFormatRoleName } from "@/components/role-name";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/table";
import { sheetCellClassName, TableSheet } from "@/components/table-sheet";
import { Tooltip } from "@/components/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { User } from "@/components/user";
import {
    PAGE_TOUR_NAMES,
    PAGE_TOUR_STORAGE_KEYS,
    usePageTour,
} from "@/features/onboarding/steps/page-tours";
import { HEAD_CLASS } from "@/features/proposals/components/proposals-table-layout";
import { buildPaymentsDeepLink } from "@/app/(treasury)/[treasuryId]/dashboard/components/deposit/deposit-transfer-url";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useMemberAddedAt } from "@/hooks/use-member-added-at";
import { useMemberJoinRequests } from "@/hooks/use-member-invites";
import { useTreasury } from "@/hooks/use-treasury";
import { trackEvent } from "@/lib/analytics";
import { reportError } from "@/lib/report-error";
import { sortRolesByOrder } from "@/lib/role-utils";
import { useRoleDescription } from "@/lib/use-role-description";
import { cn, encodeToMarkdown } from "@/lib/utils";
import { useNear } from "@/stores/near-store";
import type { RolePermission } from "@/types/policy";
import { MemberActionSheet } from "./components/member-action-sheet";
import {
    MembersMenuSheet,
    MembersMenuSheetItem,
} from "./components/members-menu-sheet";
import { DeleteConfirmationModal } from "./components/modals/delete-confirmation-modal";
import { useMemberPolicyGate } from "./hooks/use-member-policy-gate";
import { useMemberValidation } from "./hooks/use-member-validation";
import { removeMembersFromPolicy } from "./utils/policy-helpers";

interface Member {
    accountId: string;
    roles: string[];
}

const MEMBER_COLUMN_IDS = [
    "select",
    "member",
    "permissions",
    "added",
    "actions",
] as const;

const MEMBER_COLUMN_CLASS: Record<(typeof MEMBER_COLUMN_IDS)[number], string> =
    {
        select: "w-10 px-3",
        member: "px-3",
        permissions: "px-3",
        added: "w-[140px] px-3",
        actions: "w-[88px] px-3",
    };

function memberSheetCellClass({
    rowIndex,
    rowCount,
    columnIndex,
}: {
    rowIndex: number;
    rowCount: number;
    columnIndex: number;
}) {
    return cn(
        "h-[66px] group-data-[state=selected]:bg-general-tertiary",
        sheetCellClassName({
            isFirstRow: rowIndex === 0,
            isLastRow: rowIndex === rowCount - 1,
            isFirstColumn: columnIndex === 0,
            isLastColumn: columnIndex === MEMBER_COLUMN_IDS.length - 1,
        }),
        MEMBER_COLUMN_CLASS[MEMBER_COLUMN_IDS[columnIndex]],
    );
}

function PermissionsHeader({ policyRoles }: { policyRoles: RolePermission[] }) {
    const tMembers = useTranslations("members");
    const formatRoleName = useFormatRoleName();
    const getRoleDescription = useRoleDescription();
    // Get role descriptions and sort them
    const roleNames = policyRoles.map((r) => r.name);
    const sortedRoleNames = sortRolesByOrder(roleNames);

    const sortedDescriptions = sortedRoleNames
        .map((name) => ({
            name,
            description: getRoleDescription(name) || "",
        }))
        .filter((r) => r.description); // Only include roles with descriptions

    return (
        <div className="flex items-center gap-1.5">
            <span>{tMembers("permissions")}</span>
            {sortedDescriptions.length > 0 && (
                <Tooltip
                    content={
                        <div className="space-y-3">
                            {sortedDescriptions.map((role) => (
                                <div key={role.name}>
                                    <p className="font-semibold mb-1">
                                        {formatRoleName(role.name)}
                                    </p>
                                    <p className="text-xs">
                                        {role.description}
                                    </p>
                                </div>
                            ))}
                        </div>
                    }
                    contentProps={{ className: "max-w-[320px]" }}
                >
                    <Icon
                        icon={InformationCircleIcon}
                        className="text-muted-foreground cursor-help"
                    />
                </Tooltip>
            )}
        </div>
    );
}

export default function MembersPage() {
    const t = useTranslations("pages.members");
    const tRequests = useTranslations("pages.requests");
    const tPending = useTranslations("proposals.status");
    const tMembers = useTranslations("members");
    const tMemberValidation = useTranslations("memberValidation");
    const tCommon = useTranslations("common");
    const { treasuryId } = useTreasury();
    const { createProposal } = useNear();
    const {
        policy,
        isLoading,
        accountId,
        existingMembers,
        pendingMemberRequestCount,
        hasPendingMemberRequest,
        isMemberDataReady,
        isMemberActionsDisabled,
        canAddMember,
        availableRoles,
    } = useMemberPolicyGate(treasuryId);
    const queryClient = useQueryClient();
    const searchParams = useSearchParams();
    const router = useRouter();
    const isMobile = useMediaQuery("(max-width: 640px)");
    const isDesktopMembersTable = useMediaQuery("(min-width: 768px)");

    const { data: joinRequests = [] } = useMemberJoinRequests(
        canAddMember ? treasuryId : undefined,
    );
    const joinRequestCount = joinRequests.length;

    usePageTour(
        PAGE_TOUR_NAMES.MEMBERS_PENDING,
        PAGE_TOUR_STORAGE_KEYS.MEMBERS_PENDING_SHOWN,
        { enabled: hasPendingMemberRequest },
    );
    usePageTour(
        PAGE_TOUR_NAMES.MEMBERS_WANTS_TO_JOIN,
        PAGE_TOUR_STORAGE_KEYS.MEMBERS_WANTS_TO_JOIN_SHOWN,
        {
            enabled: joinRequestCount > 0 && pendingMemberRequestCount === 0,
        },
    );
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [memberToDelete, setMemberToDelete] = useState<Member | null>(null);
    const [sheetMember, setSheetMember] = useState<Member | null>(null);
    const [addMenuOpen, setAddMenuOpen] = useState(false);
    const [requestsMenuOpen, setRequestsMenuOpen] = useState(false);
    const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
    const [isMobileSelectMode, setIsMobileSelectMode] = useState(false);

    // Track if we've already processed URL params to avoid re-navigating
    const hasProcessedUrlParams = useRef(false);

    const memberActionsDisabledReason = hasPendingMemberRequest
        ? tMemberValidation("pendingRequest")
        : undefined;

    // Deep-link: /members?member=...&roles=... → /members/add
    // Do not wait on isMemberActionsDisabled — that flag stays true until the
    // pending-proposal query settles (or forever if it errors), which would
    // leave ?member= on this page. Add handles a pending ChangePolicy itself.
    useEffect(() => {
        const memberParam = searchParams.get("member");
        const rolesParam = searchParams.get("roles");

        if (memberParam && canAddMember && !hasProcessedUrlParams.current) {
            hasProcessedUrlParams.current = true;
            const params = new URLSearchParams();
            params.set("member", memberParam);
            if (rolesParam) params.set("roles", rolesParam);
            router.replace(`/${treasuryId}/members/add?${params.toString()}`);
        }
    }, [searchParams, canAddMember, router, treasuryId]);

    const { addedAt, isLoading: isAddedAtLoading } =
        useMemberAddedAt(treasuryId);
    const { canModifyMember, canDeleteBulk } = useMemberValidation(
        existingMembers,
        {
            accountId: accountId || undefined,
            canAddMember,
            hasPendingMemberRequest,
        },
    );

    // Generic function to create policy change proposal
    const createPolicyChangeProposal = async (
        updatedPolicy: any,
        summary: string,
        title: string,
        successMessage: string,
    ) => {
        if (!policy || !treasuryId) return;

        try {
            const description = {
                title,
                summary,
            };

            const proposalBond = policy?.proposal_bond || "0";

            await createProposal(successMessage, {
                treasuryId,
                proposalBond,
                proposal: {
                    description: encodeToMarkdown(description),
                    kind: {
                        ChangePolicy: {
                            policy: updatedPolicy,
                        },
                    },
                },
                proposalType: "other",
            });

            // Refetch proposals to show the newly created proposal
            queryClient.invalidateQueries({
                queryKey: ["proposals", treasuryId],
            });
        } catch (error) {
            reportError(error, "Failed to create proposal");
            toast.error(tMembers("policy.createProposalFailed"));
            throw error;
        }
    };

    // Handle delete members submission
    const handleDeleteMembersSubmit = async () => {
        if (!policy || !treasuryId || isMemberActionsDisabled) return;

        try {
            const membersToRemove =
                selectedMembers.length > 0
                    ? selectedMembers.map((accountId) => {
                          const member = existingMembers.find(
                              (m) => m.accountId === accountId,
                          );
                          return {
                              member: accountId,
                              roles: member?.roles || [],
                          };
                      })
                    : memberToDelete
                      ? [
                            {
                                member: memberToDelete.accountId,
                                roles: memberToDelete.roles,
                            },
                        ]
                      : [];

            if (membersToRemove.length === 0) return;

            const { updatedPolicy, summary } = removeMembersFromPolicy(
                policy,
                membersToRemove,
            );

            await createPolicyChangeProposal(
                updatedPolicy,
                summary,
                membersToRemove.length > 1
                    ? tMembers("policy.removeMembers")
                    : tMembers("policy.removeMember"),
                tMembers("policy.removeMemberSuccess"),
            );

            trackEvent("member-delete-submitted", {
                treasury_id: treasuryId,
                members_count: membersToRemove.length,
            });

            setIsDeleteModalOpen(false);
            setMemberToDelete(null);
            setSelectedMembers([]);
        } catch {
            // Toast + Sentry already handled in createPolicyChangeProposal
        }
    };

    const handleEditMember = useCallback(
        (member: Member) => {
            if (isMemberActionsDisabled || !treasuryId) return;
            router.push(
                `/${treasuryId}/members/edit?members=${encodeURIComponent(member.accountId)}`,
            );
        },
        [isMemberActionsDisabled, router, treasuryId],
    );

    const handleOpenMemberSheet = useCallback(
        (member: Member) => {
            if (isDesktopMembersTable) return;
            setSheetMember(member);
        },
        [isDesktopMembersTable],
    );

    const handleSheetSend = useCallback(() => {
        if (!sheetMember || !treasuryId) return;
        trackEvent("nav-click", {
            destination: "payments",
            source: "members-action-sheet",
            treasury_id: treasuryId,
        });
        setSheetMember(null);
        router.push(
            buildPaymentsDeepLink(treasuryId, {
                address: sheetMember.accountId,
            }),
        );
    }, [router, sheetMember, treasuryId]);

    const handleSheetRemove = useCallback(() => {
        if (!sheetMember || isMemberActionsDisabled) return;
        setMemberToDelete(sheetMember);
        setSheetMember(null);
        setIsDeleteModalOpen(true);
    }, [isMemberActionsDisabled, sheetMember]);

    const handleBulkEdit = useCallback(() => {
        if (
            isMemberActionsDisabled ||
            !treasuryId ||
            selectedMembers.length === 0
        )
            return;
        const membersParam = selectedMembers
            .map((id) => encodeURIComponent(id))
            .join(",");
        router.push(`/${treasuryId}/members/edit?members=${membersParam}`);
    }, [isMemberActionsDisabled, router, treasuryId, selectedMembers]);

    // Handle bulk delete
    const handleBulkDelete = useCallback(() => {
        if (isMemberActionsDisabled) return;
        setIsDeleteModalOpen(true);
    }, [isMemberActionsDisabled]);

    // Handle checkbox toggle
    const handleToggleMember = useCallback((accountId: string) => {
        setSelectedMembers((prev) =>
            prev.includes(accountId)
                ? prev.filter((id) => id !== accountId)
                : [...prev, accountId],
        );
    }, []);

    useEffect(() => {
        if (!isMobile) {
            setIsMobileSelectMode(false);
        }
    }, [isMobile]);

    useEffect(() => {
        if (isDesktopMembersTable) {
            setSheetMember(null);
        }
    }, [isDesktopMembersTable]);

    const exitMobileSelectMode = useCallback(() => {
        setIsMobileSelectMode(false);
        setSelectedMembers([]);
    }, []);

    // Handle select all
    const handleToggleAll = useCallback(() => {
        if (selectedMembers.length === existingMembers.length) {
            setSelectedMembers([]);
        } else {
            setSelectedMembers(existingMembers.map((m) => m.accountId));
        }
    }, [selectedMembers.length, existingMembers]);

    // Validate bulk delete
    const bulkDeleteValidation = useMemo(() => {
        if (selectedMembers.length === 0) return { canModify: true };

        const membersToDelete = existingMembers.filter((m) =>
            selectedMembers.includes(m.accountId),
        );

        return canDeleteBulk(membersToDelete);
    }, [selectedMembers, existingMembers, canDeleteBulk]);

    const tableHeader = (
        <TableHeader className="border-0 bg-transparent">
            <TableRow className="border-0 hover:bg-transparent">
                <TableHead
                    className={cn(HEAD_CLASS, MEMBER_COLUMN_CLASS.select)}
                >
                    {isLoading ? (
                        <Skeleton className="size-4 rounded-sm bg-general-bg-secondary" />
                    ) : (
                        <Checkbox
                            checked={
                                selectedMembers.length ===
                                    existingMembers.length &&
                                existingMembers.length > 0
                                    ? true
                                    : selectedMembers.length > 0
                                      ? "indeterminate"
                                      : false
                            }
                            onCheckedChange={handleToggleAll}
                        />
                    )}
                </TableHead>
                <TableHead
                    className={cn(HEAD_CLASS, MEMBER_COLUMN_CLASS.member)}
                >
                    {tMembers("member")}
                </TableHead>
                <TableHead
                    className={cn(HEAD_CLASS, MEMBER_COLUMN_CLASS.permissions)}
                >
                    <PermissionsHeader policyRoles={availableRoles} />
                </TableHead>
                <TableHead
                    className={cn(HEAD_CLASS, MEMBER_COLUMN_CLASS.added)}
                >
                    {tMembers("added")}
                </TableHead>
                <TableHead
                    className={cn(HEAD_CLASS, MEMBER_COLUMN_CLASS.actions)}
                />
            </TableRow>
        </TableHeader>
    );

    const renderMembersTable = (members: Member[]) => {
        if (isLoading) {
            const skeletonRows = ["a", "b", "c", "d", "e"] as const;
            return (
                <>
                    <div className="flex flex-col gap-2 md:hidden">
                        {skeletonRows.map((rowId) => (
                            <div
                                key={rowId}
                                className="rounded-xl border border-general-border bg-card p-4"
                            >
                                <div className="flex items-start gap-3">
                                    <Skeleton className="size-8 shrink-0 rounded-lg bg-general-bg-secondary" />
                                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                                        <Skeleton className="h-4 w-28 bg-general-bg-secondary" />
                                        <Skeleton className="h-3 w-36 bg-general-bg-secondary" />
                                        <div className="flex gap-2">
                                            <Skeleton className="h-7 w-20 rounded-full bg-general-bg-secondary" />
                                            <Skeleton className="h-7 w-24 rounded-full bg-general-bg-secondary" />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                    <TableSheet className="hidden md:block">
                        <ScrollArea className="grid">
                            <Table className="border-separate border-spacing-0 md:table-fixed">
                                {tableHeader}
                                <TableBody>
                                    {skeletonRows.map((rowId, rowIndex) => (
                                        <TableRow
                                            key={rowId}
                                            className="border-0 hover:bg-transparent"
                                        >
                                            {MEMBER_COLUMN_IDS.map(
                                                (columnId, columnIndex) => (
                                                    <TableCell
                                                        key={columnId}
                                                        className={memberSheetCellClass(
                                                            {
                                                                rowIndex,
                                                                rowCount:
                                                                    skeletonRows.length,
                                                                columnIndex,
                                                            },
                                                        )}
                                                    >
                                                        {columnId ===
                                                        "select" ? (
                                                            <Skeleton className="size-4 rounded-sm bg-general-bg-secondary" />
                                                        ) : columnId ===
                                                          "member" ? (
                                                            <div className="flex items-center gap-3">
                                                                <Skeleton className="size-8 shrink-0 rounded-lg bg-general-bg-secondary" />
                                                                <div className="flex min-w-0 flex-1 flex-col gap-1">
                                                                    <Skeleton className="h-4 w-40 max-w-full bg-general-bg-secondary" />
                                                                    <Skeleton className="h-3 w-28 max-w-full bg-general-bg-secondary" />
                                                                </div>
                                                            </div>
                                                        ) : columnId ===
                                                          "permissions" ? (
                                                            <div className="flex gap-2">
                                                                <Skeleton className="h-7 w-20 rounded-full bg-general-bg-secondary" />
                                                                <Skeleton className="h-7 w-24 rounded-full bg-general-bg-secondary" />
                                                            </div>
                                                        ) : columnId ===
                                                          "added" ? (
                                                            <Skeleton className="h-4 w-20 bg-general-bg-secondary" />
                                                        ) : null}
                                                    </TableCell>
                                                ),
                                            )}
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                            <ScrollBar orientation="horizontal" />
                        </ScrollArea>
                    </TableSheet>
                </>
            );
        }

        if (members.length === 0) {
            return (
                <EmptyState
                    icon={UserAdd01Icon}
                    description={tMembers("noActiveMembers")}
                    className="py-16"
                />
            );
        }

        const mobileCards = (
            <div className="flex flex-col gap-2 md:hidden">
                {members.map((member) => {
                    const selected = selectedMembers.includes(member.accountId);
                    return (
                        <button
                            key={member.accountId}
                            type="button"
                            onClick={() => {
                                if (isMobileSelectMode) {
                                    handleToggleMember(member.accountId);
                                    return;
                                }
                                handleOpenMemberSheet(member);
                            }}
                            className={cn(
                                "w-full rounded-xl border border-general-border bg-card p-4 text-left",
                                selected && "bg-general-tertiary",
                            )}
                        >
                            <div className="flex items-start gap-3">
                                {isMobileSelectMode ? (
                                    <Checkbox
                                        checked={selected}
                                        className="mt-2"
                                        onClick={(event) =>
                                            event.stopPropagation()
                                        }
                                        onCheckedChange={() =>
                                            handleToggleMember(member.accountId)
                                        }
                                    />
                                ) : null}
                                <User
                                    accountId={member.accountId}
                                    size="md"
                                    variant="avatar"
                                    withLink={false}
                                    avatarClassName="rounded-lg"
                                />
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center justify-between gap-3">
                                        <User
                                            accountId={member.accountId}
                                            size="md"
                                            variant="details"
                                            withLink={false}
                                            withHoverCard={false}
                                        />
                                        {isMobileSelectMode ? null : (
                                            <Icon
                                                icon={ArrowRight01Icon}
                                                className="size-5 shrink-0 text-general-secondary-foreground"
                                            />
                                        )}
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {sortRolesByOrder(member.roles).map(
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
                                    {addedAt[member.accountId] ? (
                                        <p className="mt-2 text-sm text-general-muted-foreground">
                                            <FormattedDate
                                                date={addedAt[member.accountId]}
                                                relative
                                                withTooltip={false}
                                            />
                                        </p>
                                    ) : isAddedAtLoading ? (
                                        <Skeleton className="mt-2 h-4 w-20 bg-general-bg-secondary" />
                                    ) : null}
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div>
        );

        return (
            <>
                {mobileCards}
                <TableSheet className="hidden md:block">
                    <ScrollArea className="grid">
                        <Table className="border-separate border-spacing-0 md:table-fixed">
                            {tableHeader}
                            <TableBody>
                                {members.map((member, rowIndex) => {
                                    const deleteValidation =
                                        canModifyMember(member);
                                    const editValidation = canModifyMember(
                                        member,
                                        member.roles,
                                    );
                                    const selected = selectedMembers.includes(
                                        member.accountId,
                                    );

                                    return (
                                        <TableRow
                                            key={member.accountId}
                                            data-state={
                                                selected
                                                    ? "selected"
                                                    : undefined
                                            }
                                            className="group border-0 hover:bg-transparent"
                                        >
                                            <TableCell
                                                className={memberSheetCellClass(
                                                    {
                                                        rowIndex,
                                                        rowCount:
                                                            members.length,
                                                        columnIndex: 0,
                                                    },
                                                )}
                                                onClick={(event) =>
                                                    event.stopPropagation()
                                                }
                                            >
                                                <Checkbox
                                                    checked={selected}
                                                    onCheckedChange={() =>
                                                        handleToggleMember(
                                                            member.accountId,
                                                        )
                                                    }
                                                />
                                            </TableCell>
                                            <TableCell
                                                className={memberSheetCellClass(
                                                    {
                                                        rowIndex,
                                                        rowCount:
                                                            members.length,
                                                        columnIndex: 1,
                                                    },
                                                )}
                                            >
                                                <User
                                                    accountId={member.accountId}
                                                    size="md"
                                                    withLink={false}
                                                    withHoverCard={true}
                                                    avatarClassName="rounded-lg"
                                                />
                                            </TableCell>
                                            <TableCell
                                                className={memberSheetCellClass(
                                                    {
                                                        rowIndex,
                                                        rowCount:
                                                            members.length,
                                                        columnIndex: 2,
                                                    },
                                                )}
                                            >
                                                <div className="flex flex-wrap gap-2">
                                                    {sortRolesByOrder(
                                                        member.roles,
                                                    ).map((role) => (
                                                        <RoleBadge
                                                            key={role}
                                                            role={role}
                                                            variant="pill"
                                                            showTooltip={false}
                                                        />
                                                    ))}
                                                </div>
                                            </TableCell>
                                            <TableCell
                                                className={memberSheetCellClass(
                                                    {
                                                        rowIndex,
                                                        rowCount:
                                                            members.length,
                                                        columnIndex: 3,
                                                    },
                                                )}
                                            >
                                                {addedAt[member.accountId] ? (
                                                    <FormattedDate
                                                        date={
                                                            addedAt[
                                                                member.accountId
                                                            ]
                                                        }
                                                        relative
                                                    />
                                                ) : isAddedAtLoading ? (
                                                    <Skeleton className="h-4 w-20 bg-general-bg-secondary" />
                                                ) : (
                                                    <span className="text-general-muted-foreground">
                                                        —
                                                    </span>
                                                )}
                                            </TableCell>
                                            <TableCell
                                                className={memberSheetCellClass(
                                                    {
                                                        rowIndex,
                                                        rowCount:
                                                            members.length,
                                                        columnIndex: 4,
                                                    },
                                                )}
                                                onClick={(event) =>
                                                    event.stopPropagation()
                                                }
                                            >
                                                <div className="flex justify-end gap-1 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
                                                    <AuthButton
                                                        permissionKind="policy"
                                                        permissionAction="AddProposal"
                                                        balanceCheck={{
                                                            withProposalBond: true,
                                                        }}
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() =>
                                                            handleEditMember(
                                                                member,
                                                            )
                                                        }
                                                        disabled={
                                                            isMemberActionsDisabled ||
                                                            !editValidation.canModify
                                                        }
                                                        className="h-8 w-8 text-general-unofficial-ghost-foreground"
                                                        tooltip={
                                                            memberActionsDisabledReason ||
                                                            editValidation.reason
                                                        }
                                                        tooltipProps={{
                                                            disabled:
                                                                (!isMemberActionsDisabled &&
                                                                    editValidation.canModify) ||
                                                                !(
                                                                    memberActionsDisabledReason ||
                                                                    editValidation.reason
                                                                ) ||
                                                                !canAddMember,
                                                            contentProps: {
                                                                className:
                                                                    "max-w-[280px]",
                                                            },
                                                        }}
                                                    >
                                                        <Icon
                                                            icon={Edit03Icon}
                                                        />
                                                    </AuthButton>
                                                    <AuthButton
                                                        permissionKind="policy"
                                                        permissionAction="AddProposal"
                                                        balanceCheck={{
                                                            withProposalBond: true,
                                                        }}
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => {
                                                            if (
                                                                isMemberActionsDisabled
                                                            )
                                                                return;
                                                            setMemberToDelete(
                                                                member,
                                                            );
                                                            setIsDeleteModalOpen(
                                                                true,
                                                            );
                                                        }}
                                                        disabled={
                                                            isMemberActionsDisabled ||
                                                            !deleteValidation.canModify
                                                        }
                                                        className="h-8 w-8 text-general-unofficial-ghost-foreground"
                                                        tooltip={
                                                            memberActionsDisabledReason ||
                                                            deleteValidation.reason
                                                        }
                                                        tooltipProps={{
                                                            disabled:
                                                                (!isMemberActionsDisabled &&
                                                                    deleteValidation.canModify) ||
                                                                !(
                                                                    memberActionsDisabledReason ||
                                                                    deleteValidation.reason
                                                                ) ||
                                                                !canAddMember,
                                                            contentProps: {
                                                                className:
                                                                    "max-w-[280px]",
                                                            },
                                                        }}
                                                    >
                                                        <Icon
                                                            icon={Delete01Icon}
                                                        />
                                                    </AuthButton>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                        <ScrollBar orientation="horizontal" />
                    </ScrollArea>
                </TableSheet>
            </>
        );
    };

    const showPendingButton =
        pendingMemberRequestCount > 0 && joinRequestCount === 0;
    const showJoinRequestsButton =
        joinRequestCount > 0 && pendingMemberRequestCount === 0;
    const showRequestsMenu =
        pendingMemberRequestCount > 0 && joinRequestCount > 0;
    const requestsMenuClassName =
        "min-w-55 rounded-xl border-none bg-foreground p-2 text-background shadow-[0_-8px_20px_-6px_rgb(0_0_0/0.28),0_8px_24px_-8px_rgb(0_0_0/0.2)]";
    const requestsMenuItemClassName =
        "cursor-pointer justify-between gap-3 rounded-lg px-3 py-2.5 text-background focus:bg-background/10 focus:text-background";

    const pageActions = (
        <div className="flex items-center gap-2 sm:gap-3">
            {showPendingButton ? (
                <Button
                    id="members-pending-btn"
                    type="button"
                    variant="pill"
                    className="gap-2 rounded-lg"
                    onClick={() =>
                        router.push(`/${treasuryId}/requests?tab=InProgress`)
                    }
                >
                    {tPending("pending")}
                    <NumberBadge
                        shape="pill"
                        number={pendingMemberRequestCount}
                    />
                </Button>
            ) : null}

            {showJoinRequestsButton ? (
                <Button
                    id="members-wants-to-join-btn"
                    type="button"
                    variant="pill"
                    className="gap-2"
                    onClick={() =>
                        router.push(`/${treasuryId}/members/join-requests`)
                    }
                >
                    {tMembers("wantsToJoin")}
                    <NumberBadge number={joinRequestCount} />
                </Button>
            ) : null}

            {showRequestsMenu ? (
                isMobile ? (
                    <>
                        <Button
                            id="members-pending-btn"
                            type="button"
                            variant="pill"
                            className="gap-2 rounded-lg"
                            onClick={() => setRequestsMenuOpen(true)}
                        >
                            {tRequests("title")}
                            <NumberBadge
                                shape="pill"
                                number={
                                    pendingMemberRequestCount + joinRequestCount
                                }
                            />
                        </Button>
                        <MembersMenuSheet
                            open={requestsMenuOpen}
                            onOpenChange={setRequestsMenuOpen}
                            title={tRequests("title")}
                        >
                            <MembersMenuSheetItem
                                className="justify-between"
                                onClick={() => {
                                    setRequestsMenuOpen(false);
                                    router.push(
                                        `/${treasuryId}/requests?tab=InProgress`,
                                    );
                                }}
                            >
                                {tPending("pending")}
                                <NumberBadge
                                    shape="pill"
                                    number={pendingMemberRequestCount}
                                />
                            </MembersMenuSheetItem>
                            <MembersMenuSheetItem
                                className="justify-between"
                                onClick={() => {
                                    setRequestsMenuOpen(false);
                                    router.push(
                                        `/${treasuryId}/members/join-requests`,
                                    );
                                }}
                            >
                                {tMembers("wantsToJoin")}
                                <NumberBadge
                                    shape="pill"
                                    number={joinRequestCount}
                                />
                            </MembersMenuSheetItem>
                        </MembersMenuSheet>
                    </>
                ) : (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                id="members-pending-btn"
                                type="button"
                                variant="pill"
                                className="gap-2 rounded-lg"
                            >
                                {tRequests("title")}
                                <NumberBadge
                                    shape="pill"
                                    number={
                                        pendingMemberRequestCount +
                                        joinRequestCount
                                    }
                                />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            align="end"
                            className={requestsMenuClassName}
                        >
                            <DropdownMenuItem
                                className={requestsMenuItemClassName}
                                onClick={() =>
                                    router.push(
                                        `/${treasuryId}/requests?tab=InProgress`,
                                    )
                                }
                            >
                                {tPending("pending")}
                                <NumberBadge
                                    shape="pill"
                                    number={pendingMemberRequestCount}
                                />
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                className={requestsMenuItemClassName}
                                onClick={() =>
                                    router.push(
                                        `/${treasuryId}/members/join-requests`,
                                    )
                                }
                            >
                                {tMembers("wantsToJoin")}
                                <NumberBadge
                                    shape="pill"
                                    number={joinRequestCount}
                                />
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )
            ) : null}

            {!canAddMember || !isMemberDataReady ? (
                <AuthButton
                    permissionKind="policy"
                    permissionAction="AddProposal"
                    balanceCheck={{ withProposalBond: true }}
                    disabled={!isMemberDataReady}
                    size={isMobile ? "icon" : "default"}
                    className="size-9 sm:w-auto"
                >
                    <Icon icon={Add01Icon} />
                    <span className="hidden sm:inline">
                        {tMembers("addNewMember")}
                    </span>
                </AuthButton>
            ) : isMobile ? (
                <>
                    <Button
                        size="icon"
                        className="size-9"
                        onClick={() => {
                            if (treasuryId) {
                                router.prefetch(`/${treasuryId}/members/add`);
                                router.prefetch(
                                    `/${treasuryId}/members/invite`,
                                );
                            }
                            setAddMenuOpen(true);
                        }}
                    >
                        <Icon icon={Add01Icon} />
                        <span className="sr-only">
                            {tMembers("addNewMember")}
                        </span>
                    </Button>
                    <MembersMenuSheet
                        open={addMenuOpen}
                        onOpenChange={setAddMenuOpen}
                        title={tMembers("addNewMember")}
                    >
                        {hasPendingMemberRequest ? (
                            <Tooltip
                                content={memberActionsDisabledReason}
                                contentProps={{
                                    className: "max-w-[280px]",
                                }}
                            >
                                <span className="flex w-full cursor-not-allowed">
                                    <MembersMenuSheetItem
                                        disabled
                                        className="w-full"
                                    >
                                        <Icon icon={Wallet03Icon} />
                                        {tMembers("addManually")}
                                    </MembersMenuSheetItem>
                                </span>
                            </Tooltip>
                        ) : (
                            <MembersMenuSheetItem
                                asChild
                                onClick={() => {
                                    trackEvent("member-add-modal-opened", {
                                        treasury_id: treasuryId,
                                    });
                                    setAddMenuOpen(false);
                                }}
                            >
                                <Link href={`/${treasuryId}/members/add`}>
                                    <Icon icon={Wallet03Icon} />
                                    {tMembers("addManually")}
                                </Link>
                            </MembersMenuSheetItem>
                        )}
                        <MembersMenuSheetItem
                            asChild
                            onClick={() => setAddMenuOpen(false)}
                        >
                            <Link href={`/${treasuryId}/members/invite`}>
                                <Icon icon={SentIcon} />
                                {tMembers("inviteMember")}
                            </Link>
                        </MembersMenuSheetItem>
                    </MembersMenuSheet>
                </>
            ) : (
                <DropdownMenu
                    onOpenChange={(open) => {
                        if (!open || !treasuryId) return;
                        router.prefetch(`/${treasuryId}/members/add`);
                        router.prefetch(`/${treasuryId}/members/invite`);
                    }}
                >
                    <DropdownMenuTrigger asChild>
                        <Button>
                            <Icon icon={Add01Icon} />
                            {tMembers("addNewMember")}
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        align="end"
                        className="w-max min-w-0 overflow-visible rounded-xl border-none bg-foreground p-2 text-background shadow-[0_-8px_20px_-6px_rgb(0_0_0/0.28),0_8px_24px_-8px_rgb(0_0_0/0.2)]"
                    >
                        {hasPendingMemberRequest ? (
                            <Tooltip
                                content={memberActionsDisabledReason}
                                contentProps={{
                                    align: "end",
                                    className: "max-w-[280px]",
                                }}
                            >
                                <span className="flex w-full cursor-not-allowed">
                                    <DropdownMenuItem
                                        disabled
                                        className="w-full gap-2.5 rounded-lg px-3 py-2.5 text-background focus:bg-background/10 focus:text-background"
                                    >
                                        <Icon icon={Wallet03Icon} />
                                        {tMembers("addManually")}
                                    </DropdownMenuItem>
                                </span>
                            </Tooltip>
                        ) : (
                            <DropdownMenuItem
                                asChild
                                className="cursor-pointer gap-2.5 rounded-lg px-3 py-2.5 text-background focus:bg-background/10 focus:text-background"
                            >
                                <Link
                                    href={`/${treasuryId}/members/add`}
                                    onClick={() =>
                                        trackEvent("member-add-modal-opened", {
                                            treasury_id: treasuryId,
                                        })
                                    }
                                >
                                    <Icon icon={Wallet03Icon} />
                                    {tMembers("addManually")}
                                </Link>
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                            asChild
                            className="cursor-pointer gap-2.5 rounded-lg px-3 py-2.5 text-background focus:bg-background/10 focus:text-background"
                        >
                            <Link href={`/${treasuryId}/members/invite`}>
                                <Icon icon={SentIcon} />
                                {tMembers("inviteMember")}
                            </Link>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
        </div>
    );

    return (
        <PageComponentLayout
            title={t("title")}
            backButton={treasuryId ? `/${treasuryId}` : true}
            backKind="section"
            hideMobileShellControls
            reserveHeaderSpace
        >
            <div className="flex flex-col gap-5">
                {selectedMembers.length > 0 ? (
                    <div className="flex items-center justify-between gap-4">
                        <span className="hidden text-xl font-semibold leading-[1.2] tracking-[-0.025rem] text-general-secondary-foreground md:block">
                            {tMembers("membersSelected", {
                                count: selectedMembers.length,
                            })}
                        </span>
                        <Button
                            type="button"
                            variant="ghost"
                            className="rounded-lg font-semibold text-foreground md:hidden"
                            onClick={exitMobileSelectMode}
                        >
                            {tCommon("cancel")}
                        </Button>
                        <div className="flex w-fit items-center gap-2">
                            <AuthButton
                                permissionKind="policy"
                                permissionAction="AddProposal"
                                balanceCheck={{
                                    withProposalBond: true,
                                }}
                                variant="neutral"
                                onClick={handleBulkEdit}
                                disabled={isMemberActionsDisabled}
                                tooltip={memberActionsDisabledReason}
                                className="rounded-lg"
                            >
                                <Icon icon={Edit03Icon} />
                                {tMembers("edit")}
                            </AuthButton>
                            <Tooltip
                                content={
                                    memberActionsDisabledReason ||
                                    bulkDeleteValidation.reason
                                }
                                disabled={
                                    (!isMemberActionsDisabled &&
                                        bulkDeleteValidation.canModify) ||
                                    !(
                                        memberActionsDisabledReason ||
                                        bulkDeleteValidation.reason
                                    ) ||
                                    !canAddMember
                                }
                                contentProps={{ className: "max-w-[280px]" }}
                            >
                                <span>
                                    <AuthButton
                                        permissionKind="policy"
                                        permissionAction="AddProposal"
                                        balanceCheck={{
                                            withProposalBond: true,
                                        }}
                                        variant="destructive"
                                        onClick={handleBulkDelete}
                                        disabled={
                                            isMemberActionsDisabled ||
                                            !bulkDeleteValidation.canModify
                                        }
                                        className="rounded-lg bg-general-error-foreground hover:bg-general-error-foreground/90 dark:bg-general-error-foreground"
                                    >
                                        <Icon icon={Delete01Icon} />
                                        {tMembers("remove")}
                                    </AuthButton>
                                </span>
                            </Tooltip>
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center justify-between gap-4">
                        <p className="hidden text-xl font-semibold leading-[1.2] tracking-[-0.025rem] text-general-secondary-foreground md:block">
                            {tMembers("activeMembersCount", {
                                count: existingMembers.length,
                            })}
                        </p>
                        <Button
                            type="button"
                            variant="ghost"
                            className="rounded-lg font-semibold text-foreground md:hidden"
                            onClick={() =>
                                isMobileSelectMode
                                    ? exitMobileSelectMode()
                                    : setIsMobileSelectMode(true)
                            }
                        >
                            {isMobileSelectMode
                                ? tCommon("cancel")
                                : tCommon("select")}
                        </Button>
                        {pageActions}
                    </div>
                )}

                {renderMembersTable(existingMembers)}
            </div>

            <MemberActionSheet
                member={sheetMember}
                open={!!sheetMember}
                onOpenChange={(open) => {
                    if (!open) setSheetMember(null);
                }}
                addedAt={
                    sheetMember ? addedAt[sheetMember.accountId] : undefined
                }
                addedAtLoading={isAddedAtLoading}
                onSend={handleSheetSend}
                onRemove={handleSheetRemove}
                removeDisabled={
                    !sheetMember ||
                    isMemberActionsDisabled ||
                    !canModifyMember(sheetMember).canModify
                }
                removeTooltip={
                    sheetMember
                        ? memberActionsDisabledReason ||
                          canModifyMember(sheetMember).reason
                        : undefined
                }
            />

            {/* Delete Confirmation Modal */}
            <DeleteConfirmationModal
                isOpen={isDeleteModalOpen}
                onClose={() => {
                    setIsDeleteModalOpen(false);
                    setMemberToDelete(null);
                    setSelectedMembers([]);
                }}
                member={memberToDelete}
                members={
                    selectedMembers.length > 0
                        ? existingMembers.filter((m) =>
                              selectedMembers.includes(m.accountId),
                          )
                        : undefined
                }
                onConfirm={handleDeleteMembersSubmit}
                validationError={(() => {
                    const membersToDelete =
                        selectedMembers.length > 0
                            ? existingMembers.filter((m) =>
                                  selectedMembers.includes(m.accountId),
                              )
                            : memberToDelete
                              ? [memberToDelete]
                              : [];

                    if (membersToDelete.length === 0) return undefined;

                    const validation = canDeleteBulk(membersToDelete);
                    return validation.canModify ? undefined : validation.reason;
                })()}
            />
        </PageComponentLayout>
    );
}
