"use client";

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/table";
import { Checkbox } from "@/components/ui/checkbox";
import { NetworkBadge } from "@/components/network-badge";
import { User, UserWithData } from "@/components/user";
import { FormattedDate } from "@/components/formatted-date";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { EmptyState } from "@/components/empty-state";
import { SearchX, Trash2, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/button";
import { useChains } from "../chains";
import type { AddressBookEntry } from "../types";

interface AddressBookTableProps {
    entries: AddressBookEntry[];
    selectedIds: Set<string>;
    onSelectionChange: (ids: Set<string>) => void;
    onDelete?: (entry: AddressBookEntry) => void;
    onSend?: (entry: AddressBookEntry) => void;
}

export function AddressBookTable({
    entries,
    selectedIds,
    onSelectionChange,
    onDelete,
    onSend,
}: AddressBookTableProps) {
    const { data: chains = [] } = useChains();

    const allSelected =
        entries.length > 0 && selectedIds.size === entries.length;
    const someSelected = selectedIds.size > 0 && !allSelected;

    function toggleAll() {
        if (allSelected) {
            onSelectionChange(new Set());
        } else {
            onSelectionChange(new Set(entries.map((e) => e.id)));
        }
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
                icon={SearchX}
                title="No recipients found"
                description="Try adjusting your search."
                className="py-16"
            />
        );
    }

    return (
        <ScrollArea className="w-full">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="w-10 pl-4 ">
                            <Checkbox
                                checked={
                                    someSelected ? "indeterminate" : allSelected
                                }
                                onCheckedChange={toggleAll}
                                aria-label="Select all"
                            />
                        </TableHead>
                        <TableHead>Recipient</TableHead>
                        <TableHead className="w-72">Network</TableHead>
                        <TableHead className="w-30">Added By</TableHead>
                        <TableHead className="w-52">Note</TableHead>
                        <TableHead className="w-20">Added</TableHead>
                        <TableHead className="w-20" />
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {entries.map((entry) => {
                        const entryChains = chains.filter((c) =>
                            entry.networks.includes(c.key),
                        );
                        const selected = selectedIds.has(entry.id);

                        return (
                            <TableRow
                                key={entry.id}
                                data-state={selected ? "selected" : undefined}
                                className="group"
                            >
                                {/* Checkbox */}
                                <TableCell className="w-10 pl-4">
                                    <Checkbox
                                        checked={selected}
                                        onCheckedChange={() =>
                                            toggleOne(entry.id)
                                        }
                                        aria-label={`Select ${entry.name}`}
                                    />
                                </TableCell>

                                {/* Recipient */}
                                <TableCell>
                                    <UserWithData
                                        name={entry.name}
                                        address={entry.address}
                                        size="md"
                                        withHoverCard
                                    />
                                </TableCell>

                                {/* Networks */}
                                <TableCell>
                                    <div className="flex flex-wrap gap-1">
                                        {entryChains.map((chain) => (
                                            <NetworkBadge
                                                key={chain.key}
                                                name={chain.name}
                                                variant="secondary"
                                                iconDark={chain.iconDark}
                                                iconLight={chain.iconLight}
                                            />
                                        ))}
                                    </div>
                                </TableCell>

                                {/* Added By */}
                                <TableCell>
                                    {entry.createdBy ? (
                                        <User
                                            accountId={entry.createdBy}
                                            size="sm"
                                            withHoverCard
                                        />
                                    ) : (
                                        <span className="text-muted-foreground text-sm">
                                            —
                                        </span>
                                    )}
                                </TableCell>

                                {/* Note */}
                                <TableCell>
                                    <span className="text-sm text-foreground line-clamp-2">
                                        {entry.note || (
                                            <span className="text-muted-foreground">
                                                —
                                            </span>
                                        )}
                                    </span>
                                </TableCell>

                                {/* Added date */}
                                <TableCell>
                                    <FormattedDate
                                        date={entry.createdAt}
                                        relative
                                        className="text-sm text-foreground"
                                    />
                                </TableCell>

                                {/* Actions */}
                                <TableCell className="w-20">
                                    <div className="flex items-center justify-end gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                        {onDelete && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8"
                                                tooltipContent="Remove"
                                                onClick={() => onDelete(entry)}
                                            >
                                                <Trash2 className="size-4 text-destructive" />
                                            </Button>
                                        )}
                                        {onSend && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8"
                                                tooltipContent="Send"
                                                onClick={() => onSend(entry)}
                                            >
                                                <ArrowUpRight className="size-4 text-primary" />
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
    );
}
