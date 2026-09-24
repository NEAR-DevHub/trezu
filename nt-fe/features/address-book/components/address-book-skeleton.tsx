"use client";

import { useTranslations } from "next-intl";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/table";
import { sheetCellClassName, TableSheet } from "@/components/table-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { HEAD_CLASS } from "@/features/proposals/components/proposals-table-layout";
import { cn } from "@/lib/utils";
import {
    CONTACT_COLUMN_CLASS,
    CONTACT_COLUMN_IDS,
    type ContactColumnId,
} from "./address-book-table-layout";

/** Enough rows to fill a laptop viewport without overshooting the fold. */
const TABLE_ROWS = 8;

/**
 * Placeholder bars fade down the empty table. The sheet border and headers
 * stay at full strength.
 */
const EMPTY_ROW_FADE = [
    "**:data-[slot=skeleton]:opacity-55",
    "**:data-[slot=skeleton]:opacity-35",
    "**:data-[slot=skeleton]:opacity-20",
    "**:data-[slot=skeleton]:opacity-10",
];

function Placeholder({ className }: { className?: string }) {
    return (
        <Skeleton
            className={cn("rounded-lg bg-general-bg-secondary", className)}
        />
    );
}

function PersonCellSkeleton({
    avatarClassName = "size-9",
}: {
    avatarClassName?: string;
}) {
    return (
        <div className="flex items-center gap-3">
            <Placeholder
                className={cn("shrink-0 rounded-full", avatarClassName)}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Placeholder className="h-4 w-[75px] max-w-full" />
                <Placeholder className="h-3 w-[110px] max-w-full" />
            </div>
        </div>
    );
}

function TableCellSkeleton({ columnId }: { columnId: ContactColumnId }) {
    switch (columnId) {
        case "select":
            return <Placeholder className="size-4 rounded-sm" />;
        case "contact":
        case "addedBy":
            return <PersonCellSkeleton />;
        case "network":
            return (
                <div className="flex items-center gap-1.5">
                    <Placeholder className="h-6 w-[88px] rounded-lg" />
                    <Placeholder className="h-6 w-[120px] rounded-lg" />
                </div>
            );
        case "note":
            return (
                <div className="flex flex-col gap-1">
                    <Placeholder className="h-3 w-full" />
                    <Placeholder className="h-3 w-4/5" />
                </div>
            );
        case "added":
            return <Placeholder className="h-4 w-20" />;
        default:
            return null;
    }
}

/**
 * Loading state for the contacts table. Headers are known before the rows
 * arrive, so only the cells are placeheld — on the same grid as the real table.
 */
export function ContactsTableSkeleton({
    className,
    rows = TABLE_ROWS,
    fadeRows = false,
}: {
    className?: string;
    /** Fewer rows when the skeleton is a backdrop rather than the loading state. */
    rows?: number;
    /** Fade placeholder bars down the body. The sheet and headers stay solid. */
    fadeRows?: boolean;
}) {
    const t = useTranslations("addressBookTable");

    const headers: Partial<Record<ContactColumnId, string>> = {
        contact: t("recipient"),
        network: t("network"),
        addedBy: t("addedBy"),
        note: t("note"),
        added: t("added"),
    };

    const cardRows = Math.min(rows, 4);

    return (
        <>
            <div className={cn("flex flex-col gap-2 md:hidden", className)}>
                {Array.from({ length: cardRows }).map((_, rowIndex) => (
                    <div
                        // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder list
                        key={rowIndex}
                        className={cn(
                            "rounded-3xl border border-general-border bg-card p-4",
                            fadeRows &&
                                EMPTY_ROW_FADE[
                                    Math.min(rowIndex, EMPTY_ROW_FADE.length - 1)
                                ],
                        )}
                    >
                        <div className="flex flex-col gap-3">
                            <PersonCellSkeleton />
                            <div className="flex gap-2">
                                <Placeholder className="h-6 w-[88px] rounded-lg" />
                                <Placeholder className="h-6 w-[120px] rounded-lg" />
                            </div>
                        </div>
                    </div>
                ))}
            </div>
            <TableSheet className={cn("hidden md:block", className)}>
            <Table className="border-separate border-spacing-0 md:table-fixed">
                <TableHeader className="border-0 bg-transparent">
                    <TableRow className="border-0 hover:bg-transparent">
                        {CONTACT_COLUMN_IDS.map((columnId) => (
                            <TableHead
                                key={columnId}
                                className={cn(
                                    HEAD_CLASS,
                                    CONTACT_COLUMN_CLASS[columnId],
                                )}
                            >
                                {columnId === "select" ? (
                                    <Placeholder className="size-4 rounded-sm" />
                                ) : (
                                    headers[columnId]
                                )}
                            </TableHead>
                        ))}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {Array.from({ length: rows }).map((_, rowIndex) => (
                        <TableRow
                            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder list
                            key={rowIndex}
                            className={cn(
                                "border-0 hover:bg-transparent",
                                fadeRows &&
                                    EMPTY_ROW_FADE[
                                        Math.min(
                                            rowIndex,
                                            EMPTY_ROW_FADE.length - 1,
                                        )
                                    ],
                            )}
                        >
                            {CONTACT_COLUMN_IDS.map((columnId, columnIndex) => (
                                <TableCell
                                    key={columnId}
                                    className={cn(
                                        "h-[66px]",
                                        sheetCellClassName({
                                            isFirstRow: rowIndex === 0,
                                            isLastRow: rowIndex === rows - 1,
                                            isFirstColumn: columnIndex === 0,
                                            isLastColumn:
                                                columnIndex ===
                                                CONTACT_COLUMN_IDS.length - 1,
                                        }),
                                        CONTACT_COLUMN_CLASS[columnId],
                                    )}
                                >
                                    <TableCellSkeleton columnId={columnId} />
                                </TableCell>
                            ))}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </TableSheet>
        </>
    );
}

/**
 * Faded copy of the contacts table, so an empty list keeps the shape it will
 * have once contacts arrive. Handed to `EmptyState`, which floats the message
 * on top of it.
 */
export function ContactsEmptyBackdrop() {
    return <ContactsTableSkeleton rows={4} fadeRows />;
}
