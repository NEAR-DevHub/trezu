import { sheetCellClassName } from "@/components/table-sheet";
import { cn } from "@/lib/utils";

/** The order the contacts table lays its columns out in. */
export const CONTACT_COLUMN_IDS = [
    "select",
    "contact",
    "network",
    "addedBy",
    "note",
    "added",
    "actions",
] as const;

export type ContactColumnId = (typeof CONTACT_COLUMN_IDS)[number];

/** Width and padding per column. Shared by the table and its skeleton. */
export const CONTACT_COLUMN_CLASS: Record<ContactColumnId, string> = {
    select: "w-10 px-3",
    contact: "w-[22%] px-3",
    network: "w-[26%] px-3",
    addedBy: "w-[18%] px-3",
    note: "w-[20%] px-3 whitespace-normal",
    added: "w-[120px] px-3",
    actions: "w-[88px] px-3",
};

export function contactSheetCellClass({
    rowIndex,
    rowCount,
    columnIndex,
}: {
    rowIndex: number;
    rowCount: number;
    columnIndex: number;
}) {
    const columnId = CONTACT_COLUMN_IDS[columnIndex];

    return cn(
        "h-auto min-h-[66px] group-data-[state=selected]:bg-general-tertiary",
        sheetCellClassName({
            isFirstRow: rowIndex === 0,
            isLastRow: rowIndex === rowCount - 1,
            isFirstColumn: columnIndex === 0,
            isLastColumn: columnIndex === CONTACT_COLUMN_IDS.length - 1,
        }),
        CONTACT_COLUMN_CLASS[columnId],
    );
}
