"use client";

import {
    ArrowRight01Icon,
    Delete01Icon,
    SentIcon,
    Wallet03Icon,
} from "@hugeicons/core-free-icons";
import { useTranslations } from "next-intl";
import { Button } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { FormattedDate } from "@/components/formatted-date";
import { HighlightedText } from "@/components/highlighted-text";
import { Icon } from "@/components/icon";
import { NetworkList } from "@/components/network-list";
import { Pagination } from "@/components/pagination";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/table";
import { TableSheet } from "@/components/table-sheet";
import { Tooltip } from "@/components/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { User } from "@/components/user";
import { HEAD_CLASS } from "@/features/proposals/components/proposals-table-layout";
import { formatShortAddress } from "@/lib/format-short-address";
import { cn } from "@/lib/utils";
import { useChains } from "../chains";
import type { AddressBookEntry } from "../types";
import { formatAddressBookDisplayAddress } from "../utils/find-entry";
import {
    CONTACT_COLUMN_CLASS,
    contactSheetCellClass,
} from "./address-book-table-layout";
import { ContactsEmptyBackdrop } from "./address-book-skeleton";

interface AddressBookTableProps {
    entries: AddressBookEntry[];
    selectedIds: Set<string>;
    onSelectionChange: (ids: Set<string>) => void;
    onDelete?: (entry: AddressBookEntry) => void;
    onSend?: (entry: AddressBookEntry) => void;
    onOpen?: (entry: AddressBookEntry) => void;
    /** Mobile cards show checkboxes instead of the open chevron. */
    isMobileSelectMode?: boolean;
    /** Active search query — used to highlight matching text. */
    searchQuery?: string;
    pageIndex?: number;
    pageSize?: number;
    total?: number;
    onPageChange?: (page: number) => void;
}

function ContactAvatar() {
    return (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-general-indigo-border bg-general-indigo-background-faded">
            <Icon
                icon={Wallet03Icon}
                className="size-4 text-general-indigo-foreground"
            />
        </span>
    );
}

function ContactCell({
    entry,
    searchQuery,
}: {
    entry: AddressBookEntry;
    searchQuery: string;
}) {
    const displayAddress = formatAddressBookDisplayAddress(entry);

    return (
        <div className="flex min-w-0 items-center gap-3">
            <ContactAvatar />
            <div className="flex min-w-0 flex-col">
                <HighlightedText
                    text={entry.name}
                    query={searchQuery}
                    className="truncate text-sm font-medium text-foreground"
                />
                <HighlightedText
                    text={formatShortAddress(displayAddress)}
                    query={searchQuery}
                    className="truncate text-xs text-muted-foreground"
                />
            </div>
        </div>
    );
}

function NoteCell({ note }: { note?: string }) {
    const trimmed = note?.trim();
    if (!trimmed) return null;

    return (
        <Tooltip
            content={trimmed}
            contentProps={{ className: "max-w-72 whitespace-pre-wrap" }}
        >
            <span className="inline-block w-full max-w-full">
                <span className="line-clamp-2 text-sm font-medium text-general-foreground">
                    {trimmed}
                </span>
            </span>
        </Tooltip>
    );
}

export function AddressBookTable({
    entries,
    selectedIds,
    onSelectionChange,
    onDelete,
    onSend,
    onOpen,
    isMobileSelectMode = false,
    searchQuery = "",
    pageIndex = 0,
    pageSize = 15,
    total = entries.length,
    onPageChange,
}: AddressBookTableProps) {
    const t = useTranslations("addressBookTable");
    const { data: chains = [] } = useChains();
    const totalPages = Math.ceil(total / pageSize);
    const selectedEntryCount = entries.filter((entry) =>
        selectedIds.has(entry.id),
    ).length;

    const allSelected =
        entries.length > 0 && selectedEntryCount === entries.length;
    const someSelected = selectedEntryCount > 0 && !allSelected;

    function toggleAll() {
        const next = new Set(selectedIds);

        if (allSelected) {
            entries.forEach((entry) => {
                next.delete(entry.id);
            });
        } else {
            entries.forEach((entry) => {
                next.add(entry.id);
            });
        }

        onSelectionChange(next);
    }

    function toggleOne(id: string) {
        const next = new Set(selectedIds);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        onSelectionChange(next);
    }

    if (entries.length === 0) {
        return (
            <EmptyState
                description={t("noResults")}
                skeleton={<ContactsEmptyBackdrop />}
                className="py-0"
            />
        );
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 md:hidden">
                {entries.map((entry) => {
                    const entryChains = chains.filter((chain) =>
                        entry.networks.includes(chain.key),
                    );
                    const selected = selectedIds.has(entry.id);

                    return (
                        <button
                            key={entry.id}
                            type="button"
                            onClick={() => {
                                if (isMobileSelectMode) {
                                    toggleOne(entry.id);
                                    return;
                                }
                                onOpen?.(entry);
                            }}
                            className={cn(
                                "w-full rounded-3xl border border-general-border bg-card p-4 text-left",
                                selected && "bg-general-tertiary",
                            )}
                        >
                            <div className="flex flex-col gap-3">
                                <div className="flex items-center gap-3">
                                    {isMobileSelectMode ? (
                                        <Checkbox
                                            checked={selected}
                                            onClick={(event) =>
                                                event.stopPropagation()
                                            }
                                            onCheckedChange={() =>
                                                toggleOne(entry.id)
                                            }
                                            aria-label={t("selectEntry", {
                                                name: entry.name,
                                            })}
                                        />
                                    ) : null}
                                    <div className="min-w-0 flex-1">
                                        <ContactCell
                                            entry={entry}
                                            searchQuery={searchQuery}
                                        />
                                    </div>
                                    {isMobileSelectMode ? null : (
                                        <Icon
                                            icon={ArrowRight01Icon}
                                            className="size-5 shrink-0 text-general-secondary-foreground"
                                        />
                                    )}
                                </div>
                                <NetworkList
                                    chains={entryChains}
                                    maxVisible={2}
                                    badgeVariant="outline"
                                    overflow="tooltip"
                                    className="flex-wrap"
                                />
                            </div>
                        </button>
                    );
                })}
            </div>
            <TableSheet className="hidden md:block">
                <ScrollArea className="grid">
                    <Table className="border-separate border-spacing-0 md:table-fixed">
                        <TableHeader className="border-0 bg-transparent">
                            <TableRow className="border-0 hover:bg-transparent">
                                <TableHead
                                    className={cn(
                                        HEAD_CLASS,
                                        CONTACT_COLUMN_CLASS.select,
                                    )}
                                >
                                    <Checkbox
                                        checked={
                                            someSelected
                                                ? "indeterminate"
                                                : allSelected
                                        }
                                        onCheckedChange={toggleAll}
                                        aria-label={t("selectAll")}
                                    />
                                </TableHead>
                                <TableHead
                                    className={cn(
                                        HEAD_CLASS,
                                        CONTACT_COLUMN_CLASS.contact,
                                    )}
                                >
                                    {t("recipient")}
                                </TableHead>
                                <TableHead
                                    className={cn(
                                        HEAD_CLASS,
                                        CONTACT_COLUMN_CLASS.network,
                                    )}
                                >
                                    {t("network")}
                                </TableHead>
                                <TableHead
                                    className={cn(
                                        HEAD_CLASS,
                                        CONTACT_COLUMN_CLASS.addedBy,
                                    )}
                                >
                                    {t("addedBy")}
                                </TableHead>
                                <TableHead
                                    className={cn(
                                        HEAD_CLASS,
                                        CONTACT_COLUMN_CLASS.note,
                                    )}
                                >
                                    {t("note")}
                                </TableHead>
                                <TableHead
                                    className={cn(
                                        HEAD_CLASS,
                                        CONTACT_COLUMN_CLASS.added,
                                    )}
                                >
                                    {t("added")}
                                </TableHead>
                                <TableHead
                                    className={cn(
                                        HEAD_CLASS,
                                        CONTACT_COLUMN_CLASS.actions,
                                    )}
                                />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {entries.map((entry, rowIndex) => {
                                const entryChains = chains.filter((chain) =>
                                    entry.networks.includes(chain.key),
                                );
                                const selected = selectedIds.has(entry.id);
                                const cell = (columnIndex: number) =>
                                    contactSheetCellClass({
                                        rowIndex,
                                        rowCount: entries.length,
                                        columnIndex,
                                    });

                                return (
                                    <TableRow
                                        key={entry.id}
                                        data-state={
                                            selected ? "selected" : undefined
                                        }
                                        className="group border-0 hover:bg-transparent"
                                    >
                                        <TableCell
                                            className={cell(0)}
                                            onClick={(event) =>
                                                event.stopPropagation()
                                            }
                                        >
                                            <Checkbox
                                                checked={selected}
                                                onCheckedChange={() =>
                                                    toggleOne(entry.id)
                                                }
                                                aria-label={t("selectEntry", {
                                                    name: entry.name,
                                                })}
                                            />
                                        </TableCell>
                                        <TableCell className={cell(1)}>
                                            <ContactCell
                                                entry={entry}
                                                searchQuery={searchQuery}
                                            />
                                        </TableCell>
                                        <TableCell className={cell(2)}>
                                            <NetworkList
                                                chains={entryChains}
                                                maxVisible={2}
                                                badgeVariant="outline"
                                                overflow="tooltip"
                                                className="min-w-0 flex-wrap"
                                            />
                                        </TableCell>
                                        <TableCell className={cell(3)}>
                                            {entry.createdBy ? (
                                                <User
                                                    accountId={entry.createdBy}
                                                    size="md"
                                                    avatarClassName="size-9!"
                                                    withHoverCard
                                                    withLink={false}
                                                />
                                            ) : (
                                                <span className="text-sm text-muted-foreground">
                                                    —
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell className={cell(4)}>
                                            <NoteCell note={entry.note} />
                                        </TableCell>
                                        <TableCell className={cell(5)}>
                                            <FormattedDate
                                                date={entry.createdAt}
                                                relative
                                                className="text-sm text-foreground"
                                            />
                                        </TableCell>
                                        <TableCell
                                            className={cell(6)}
                                            onClick={(event) =>
                                                event.stopPropagation()
                                            }
                                        >
                                            <div className="flex justify-end gap-1 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
                                                {onSend && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-general-unofficial-ghost-foreground"
                                                        tooltipContent={t(
                                                            "send",
                                                        )}
                                                        onClick={() =>
                                                            onSend(entry)
                                                        }
                                                    >
                                                        <Icon icon={SentIcon} />
                                                    </Button>
                                                )}
                                                {onDelete && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-general-unofficial-ghost-foreground"
                                                        tooltipContent={t(
                                                            "remove",
                                                        )}
                                                        onClick={() =>
                                                            onDelete(entry)
                                                        }
                                                    >
                                                        <Icon
                                                            icon={Delete01Icon}
                                                        />
                                                    </Button>
                                                )}
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

            {onPageChange && totalPages > 1 && (
                <Pagination
                    pageIndex={pageIndex}
                    totalPages={totalPages}
                    onPageChange={onPageChange}
                />
            )}
        </div>
    );
}
