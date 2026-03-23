"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Proposal } from "@/lib/proposals-api";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/table";
import { Button } from "@/components/button";
import {
    ChevronDown,
    ChevronRight,
    X,
    Check,
    SearchX,
    Send,
    ArrowUpRight,
    ArrowRightLeft,
    Info,
} from "lucide-react";
import { TransactionCell } from "./transaction-cell";
import { ExpandedView } from "./expanded-view";
import { ProposalTypeIcon } from "./proposal-type-icon";
import { VotingIndicator } from "./voting-indicator";
import { Policy } from "@/types/policy";
import { TreasuryConfig } from "@/lib/api";
import { FormattedDate } from "@/components/formatted-date";

import { TooltipUser } from "@/components/user";
import { Checkbox } from "@/components/ui/checkbox";
import { getProposalStatus, getProposalUIKind } from "../utils/proposal-utils";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Pagination } from "@/components/pagination";
import { ProposalStatusPill } from "./proposal-status-pill";
import { useNear } from "@/stores/near-store";
import { useTreasury } from "@/hooks/use-treasury";
import { useResponsiveSidebar } from "@/stores/sidebar-store";
import {
    getApproversAndThreshold,
    getKindFromProposal,
} from "@/lib/config-utils";

import {
    ColumnDef,
    flexRender,
    getCoreRowModel,
    useReactTable,
    getExpandedRowModel,
    createColumnHelper,
    ExpandedState,
    getPaginationRowModel,
} from "@tanstack/react-table";
import { VoteModal } from "./vote-modal";
import { Address } from "@/components/address";
import { DepositModal } from "@/app/(treasury)/[treasuryId]/dashboard/components/deposit-modal";
import { EmptyState } from "@/components/empty-state";
import { AuthButton } from "@/components/auth-button";
import { useRouter } from "next/navigation";
import { Tooltip } from "@/components/tooltip";
import { useProposalsInsufficientBalance } from "../hooks/use-proposals-insufficient-balance";

const columnHelper = createColumnHelper<Proposal>();

interface ProposalsTableProps {
    proposals: Proposal[];
    policy: Policy;
    config?: TreasuryConfig | null;
    withFilters?: boolean;
    pageIndex?: number;
    pageSize?: number;
    total?: number;
    onPageChange?: (page: number) => void;
    onSelectionChange?: (count: number) => void;
}

export function ProposalsTable({
    proposals,
    policy,
    withFilters = false,
    pageIndex = 0,
    pageSize = 10,
    total = 0,
    onPageChange,
    onSelectionChange,
}: ProposalsTableProps) {
    const [rowSelection, setRowSelection] = useState({});
    const [expanded, setExpanded] = useState<ExpandedState>({});
    const { accountId } = useNear();
    const { treasuryId } = useTreasury();
    const { isMobile } = useResponsiveSidebar();
    const router = useRouter();
    const columns = useMemo<ColumnDef<Proposal, any>[]>(
        () => [
            columnHelper.display({
                id: "select",
                header: ({ table }) => {
                    // Only show header checkbox if at least one row can be selected
                    const hasSelectableRows = table
                        .getRowModel()
                        .rows.some((row) => row.getCanSelect());

                    if (!hasSelectableRows) {
                        return null;
                    }

                    return (
                        <Checkbox
                            checked={
                                table.getIsAllPageRowsSelected() ||
                                (table.getIsSomePageRowsSelected() &&
                                    "indeterminate")
                            }
                            onCheckedChange={(value) =>
                                table.toggleAllPageRowsSelected(!!value)
                            }
                            aria-label="Select all"
                        />
                    );
                },
                cell: ({ row }) => {
                    const proposal = row.original;
                    const proposalKind =
                        getKindFromProposal(proposal.kind) ?? "call";
                    const { approverAccounts } = getApproversAndThreshold(
                        policy,
                        accountId ?? "",
                        proposalKind,
                        false,
                    );
                    const proposalStatus = getProposalStatus(proposal, policy);
                    const isVoted = Object.keys(proposal.votes).includes(
                        accountId ?? "",
                    );
                    const canVote =
                        approverAccounts.includes(accountId ?? "") &&
                        accountId &&
                        treasuryId;
                    const isPending = proposalStatus === "Pending";

                    if (isVoted || !canVote || !isPending) {
                        const content = !isPending
                            ? "Proposal is not pending."
                            : !canVote
                              ? "You don't have permission to vote on this request."
                              : isVoted
                                ? "You already voted on this request."
                                : "";

                        return (
                            <Tooltip content={content}>
                                <Checkbox
                                    checked={row.getIsSelected()}
                                    disabled={true}
                                    onCheckedChange={(value) =>
                                        row.toggleSelected(!!value)
                                    }
                                />
                            </Tooltip>
                        );
                    }

                    return (
                        <Checkbox
                            checked={row.getIsSelected()}
                            onCheckedChange={(value) =>
                                row.toggleSelected(!!value)
                            }
                            aria-label="Select row"
                        />
                    );
                },
                enableSorting: false,
                enableHiding: false,
            }),
            columnHelper.accessor("id", {
                header: () => (
                    <span className="text-xs font-medium uppercase text-muted-foreground">
                        Request
                    </span>
                ),
                cell: (info) => {
                    const proposal = info.row.original;
                    const title = getProposalUIKind(proposal);
                    return (
                        <div className="flex items-center gap-5 max-w-[400px] truncate">
                            <span className="text-sm text-muted-foreground w-6 shrink-0 font-semibold">
                                #{proposal.id}
                            </span>
                            <ProposalTypeIcon proposal={proposal} />
                            <div className="flex flex-col items-start">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium">
                                        {title}
                                    </span>
                                </div>
                                <FormattedDate
                                    proposal={proposal}
                                    policy={policy}
                                    relative
                                    className="text-xs text-muted-foreground"
                                />
                            </div>
                        </div>
                    );
                },
            }),
            columnHelper.display({
                id: "transaction",
                header: () => (
                    <span className="text-xs font-medium uppercase text-muted-foreground">
                        Transaction
                    </span>
                ),
                cell: ({ row }) => (
                    <div className="max-w-[300px] truncate">
                        <TransactionCell proposal={row.original} />
                    </div>
                ),
            }),
            columnHelper.accessor("proposer", {
                header: () => (
                    <span className="text-xs font-medium uppercase text-muted-foreground">
                        Requester
                    </span>
                ),
                cell: (info) => {
                    const value = info.getValue();
                    return (
                        <TooltipUser
                            accountId={value}
                            triggerProps={{ asChild: false }}
                        >
                            <Address address={value} />
                        </TooltipUser>
                    );
                },
            }),
            columnHelper.display({
                id: "voting",
                header: () => (
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-medium uppercase text-muted-foreground">
                            Voting
                        </span>
                        <Tooltip content="First number shows approvals received. Second number shows approvals required to execute.">
                            <Info className="size-4 text-muted-foreground" />
                        </Tooltip>
                    </div>
                ),
                cell: ({ row }) => (
                    <VotingIndicator proposal={row.original} policy={policy} />
                ),
            }),
            columnHelper.accessor("status", {
                header: () => (
                    <span className="text-xs font-medium uppercase text-muted-foreground">
                        Status
                    </span>
                ),
                cell: (info) => (
                    <ProposalStatusPill
                        proposal={info.row.original}
                        policy={policy}
                    />
                ),
            }),
            columnHelper.display({
                id: "expand",
                cell: ({ row }) => (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                            if (isMobile) {
                                router.push(
                                    `/${treasuryId}/requests/${row.original.id}`,
                                );
                            } else {
                                row.toggleExpanded();
                            }
                        }}
                        className="h-8 w-8 p-0"
                    >
                        {!isMobile && row.getIsExpanded() ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                    </Button>
                ),
            }),
        ],
        [policy, accountId, treasuryId],
    );

    const table = useReactTable({
        data: proposals,
        columns,
        state: {
            rowSelection,
            expanded,
            pagination: {
                pageIndex,
                pageSize,
            },
        },
        getPaginationRowModel: getPaginationRowModel(),
        onRowSelectionChange: setRowSelection,
        onExpandedChange: setExpanded,
        getCoreRowModel: getCoreRowModel(),
        getExpandedRowModel: getExpandedRowModel(),
        getRowId: (row) => row.id.toString(),
        manualPagination: true,
        enableRowSelection: (row) => {
            const proposal = row.original;
            const { approverAccounts } = getApproversAndThreshold(
                policy,
                accountId ?? "",
                proposal.kind,
                false,
            );
            const isVoted = Object.keys(proposal.votes).includes(
                accountId ?? "",
            );
            const proposalStatus = getProposalStatus(proposal, policy);
            return (
                approverAccounts.includes(accountId ?? "") &&
                !isVoted &&
                !!accountId &&
                !!treasuryId &&
                proposal.status === "InProgress" &&
                proposalStatus !== "Expired"
            );
        },
    });

    const [isVoteModalOpen, setIsVoteModalOpen] = useState(false);
    const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
    const [{ tokenSymbol, tokenNetwork }, setDepositTokenInfo] = useState<{
        tokenSymbol?: string;
        tokenNetwork?: string;
    }>({});
    const [voteInfo, setVoteInfo] = useState<{
        vote: "Approve" | "Reject" | "Remove";
        proposals: Proposal[];
        insufficientBalanceIds?: number[];
    }>({ vote: "Approve", proposals: [] });

    // Notify parent when selection changes
    let selectedRows = table.getFilteredSelectedRowModel().rows;
    useEffect(() => {
        const selectedCount = selectedRows.length;
        onSelectionChange?.(selectedCount);
    }, [selectedRows.length, onSelectionChange]);

    const { insufficientBalanceIds } = useProposalsInsufficientBalance(
        proposals,
        treasuryId,
    );

    if ((proposals.length === 0 && pageIndex === 0) || total === 0) {
        return withFilters ? (
            <div className="flex flex-col items-center justify-center py-8 gap-4">
                <EmptyState
                    icon={SearchX}
                    title=""
                    description="No requests found matching your filters."
                />
            </div>
        ) : (
            <div className="flex flex-col items-center justify-center py-8 gap-4">
                <EmptyState
                    icon={Send}
                    title="All caught up!"
                    description="There are no pending requests."
                    className="pb-0"
                />
                <div className="flex gap-4 w-full max-w-[300px] min-w-0 pb-12">
                    <AuthButton
                        permissionKind="transfer"
                        onClick={() => router.push(`/${treasuryId}/payments`)}
                        permissionAction="AddProposal"
                        className="gap-1 w-full shrink"
                    >
                        <ArrowUpRight className="size-3.5" /> Send
                    </AuthButton>
                    <AuthButton
                        permissionKind="call"
                        onClick={() => router.push(`/${treasuryId}/exchange`)}
                        permissionAction="AddProposal"
                        className="gap-1 w-full shrink"
                    >
                        <ArrowRightLeft className="size-3.5" /> Exchange
                    </AuthButton>
                </div>
            </div>
        );
    }

    const totalPages = Math.ceil(total / pageSize);
    const selectedCount = table.getFilteredSelectedRowModel().rows.length;
    const selectedProposals = table
        .getFilteredSelectedRowModel()
        .rows.map((row) => row.original);

    const selectedInsufficientIds = selectedProposals
        .map((p) => p.id)
        .filter((id) => insufficientBalanceIds.has(id));

    const allSelectedHaveInsufficientBalance =
        selectedCount > 0 && selectedInsufficientIds.length === selectedCount;

    const handleBulkVote = async (vote: "Approve" | "Reject") => {
        if (!treasuryId || !accountId) return;

        setVoteInfo({
            vote,
            proposals: selectedProposals,
            insufficientBalanceIds:
                vote === "Approve" ? selectedInsufficientIds : undefined,
        });
        setIsVoteModalOpen(true);
    };

    return (
        <>
            <div className="flex flex-col pb-3">
                {selectedCount > 0 && (
                    <div className="flex md:text-base text-sm items-center justify-between py-3.5 px-5 border-b">
                        <span className="font-semibold">
                            {selectedCount}{" "}
                            {selectedCount === 1 ? "Request" : "Requests"}{" "}
                            Selected
                        </span>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="secondary"
                                onClick={() => handleBulkVote("Reject")}
                            >
                                <X className="h-4 w-4" />
                                Reject
                            </Button>

                            <Button
                                variant="default"
                                tooltipContent={
                                    allSelectedHaveInsufficientBalance
                                        ? "This request can't be approved because the treasury has insufficient balance."
                                        : undefined
                                }
                                onClick={() => handleBulkVote("Approve")}
                                disabled={allSelectedHaveInsufficientBalance}
                            >
                                <Check className="h-4 w-4" />
                                Approve
                            </Button>
                        </div>
                    </div>
                )}
                <ScrollArea className="grid">
                    <Table>
                        <TableHeader>
                            {table.getHeaderGroups().map((headerGroup) => (
                                <TableRow
                                    key={headerGroup.id}
                                    className="hover:bg-transparent"
                                >
                                    {headerGroup.headers.map((header) => (
                                        <TableHead key={header.id}>
                                            {header.isPlaceholder
                                                ? null
                                                : flexRender(
                                                      header.column.columnDef
                                                          .header,
                                                      header.getContext(),
                                                  )}
                                        </TableHead>
                                    ))}
                                </TableRow>
                            ))}
                        </TableHeader>
                        <TableBody>
                            {table.getRowModel().rows.map((row) => (
                                <Fragment key={row.id}>
                                    <TableRow
                                        data-state={
                                            row.getIsSelected() && "selected"
                                        }
                                        onClick={(e) => {
                                            const target =
                                                e.target as HTMLElement;
                                            if (
                                                target.closest("button") ||
                                                target.closest(
                                                    '[role="checkbox"]',
                                                ) ||
                                                target.tagName === "INPUT"
                                            ) {
                                                return;
                                            }
                                            if (isMobile) {
                                                router.push(
                                                    `/${treasuryId}/requests/${row.original.id}`,
                                                );
                                            } else {
                                                row.toggleExpanded();
                                            }
                                        }}
                                        className="cursor-pointer"
                                    >
                                        {row.getVisibleCells().map((cell) => (
                                            <TableCell key={cell.id}>
                                                {flexRender(
                                                    cell.column.columnDef.cell,
                                                    cell.getContext(),
                                                )}
                                            </TableCell>
                                        ))}
                                    </TableRow>
                                    {row.getIsExpanded() && (
                                        <TableRow>
                                            <TableCell
                                                colSpan={
                                                    row.getVisibleCells().length
                                                }
                                                className="p-4 bg-general-tertiary"
                                            >
                                                <ExpandedView
                                                    proposal={row.original}
                                                    policy={policy}
                                                    onVote={(vote) => {
                                                        setVoteInfo({
                                                            vote,
                                                            proposals: [
                                                                row.original,
                                                            ],
                                                        });
                                                        setIsVoteModalOpen(
                                                            true,
                                                        );
                                                    }}
                                                    onDeposit={(
                                                        tokenSymbol,
                                                        tokenNetwork,
                                                    ) => {
                                                        setDepositTokenInfo({
                                                            tokenSymbol,
                                                            tokenNetwork,
                                                        });
                                                        setIsDepositModalOpen(
                                                            true,
                                                        );
                                                    }}
                                                />
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </Fragment>
                            ))}
                        </TableBody>
                    </Table>
                    <ScrollBar orientation="horizontal" />
                </ScrollArea>

                {onPageChange && (
                    <div className="pr-2">
                        <Pagination
                            pageIndex={pageIndex}
                            totalPages={totalPages}
                            onPageChange={onPageChange}
                        />
                    </div>
                )}
            </div>
            <VoteModal
                isOpen={isVoteModalOpen}
                onClose={() => setIsVoteModalOpen(false)}
                onSuccess={() => {
                    table.setRowSelection({});
                    onSelectionChange?.(0);
                }}
                proposals={voteInfo.proposals}
                vote={voteInfo.vote}
                insufficientBalanceProposalIds={voteInfo.insufficientBalanceIds}
            />
            <DepositModal
                isOpen={isDepositModalOpen}
                onClose={() => setIsDepositModalOpen(false)}
                prefillTokenSymbol={tokenSymbol}
                prefillNetworkId={tokenNetwork}
            />
        </>
    );
}
