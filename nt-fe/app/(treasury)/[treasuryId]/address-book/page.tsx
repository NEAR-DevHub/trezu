"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { PageCard } from "@/components/card";
import { PageComponentLayout } from "@/components/page-component-layout";
import { AuthButton } from "@/components/auth-button";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/button";
import { FileDown, FileUp, Plus, Trash2 } from "lucide-react";
import { StepWizard } from "@/components/step-wizard";
import {
    AddRecipientForm,
    type RecipientDraft,
} from "@/features/address-book/components/add-recipient-form";
import { ReviewRecipients } from "@/features/address-book/components/review-recipients";
import { AddressBookTable } from "@/features/address-book/components/address-book-table";
import { RemoveRecipientDialog } from "@/features/address-book/components/remove-recipient-dialog";
import {
    useCreateAddressBookEntries,
    useAddressBook,
    useDeleteAddressBookEntries,
    useExportAddressBook,
    type AddressBookEntry,
} from "@/features/address-book";
import { useTreasury } from "@/hooks/use-treasury";
import { TableSkeleton } from "@/components/table-skeleton";
import { ResponsiveInput } from "@/components/input";
import { NumberBadge } from "@/components/number-badge";
import { useMediaQuery } from "@/hooks/use-media-query";

// ─── Empty state ──────────────────────────────────────────────────────────────

function AddressBookEmptyState({ onAdd }: { onAdd: () => void }) {
    return (
        <PageCard className="py-[100px] flex flex-col items-center justify-center w-full h-fit gap-4">
            <EmptyState
                icon={FileUp}
                title="Add your first recipient"
                description={`Add recipients to create payments faster.\nYour address book is private and only visible to your team.`}
                className="py-0"
            />
            <div className="flex gap-3 w-full max-w-[300px]">
                <AuthButton
                    permissionKind="any"
                    permissionAction=""
                    variant="secondary"
                    className="gap-1 shrink w-full"
                >
                    <FileUp className="size-3.5" /> Import
                </AuthButton>
                <AuthButton
                    permissionKind="any"
                    permissionAction=""
                    className="gap-1 shrink w-full"
                    onClick={onAdd}
                >
                    <Plus className="size-3.5" /> Add Recipient
                </AuthButton>
            </div>
        </PageCard>
    );
}

// ─── Add flow ─────────────────────────────────────────────────────────────────

function AddRecipientFlow({
    onDone,
    onCancel,
}: {
    onDone: () => void;
    onCancel: () => void;
}) {
    const { treasuryId } = useTreasury();
    const [step, setStep] = useState(0);
    const [recipients, setRecipients] = useState<RecipientDraft[]>([]);
    const createEntries = useCreateAddressBookEntries(treasuryId);

    const steps = [
        {
            component: ({
                handleBack,
                handleNext,
            }: {
                handleBack?: () => void;
                handleNext?: () => void;
            }) => (
                <AddRecipientForm
                    handleBack={handleBack ?? onCancel}
                    handleNext={handleNext}
                    recipients={recipients}
                    onRecipientsChange={setRecipients}
                />
            ),
        },
        {
            component: ({ handleBack }: { handleBack?: () => void }) => (
                <ReviewRecipients
                    handleBack={handleBack}
                    recipients={recipients}
                    isSubmitting={createEntries.isPending}
                    onSubmit={async (notes) => {
                        if (!treasuryId) return;
                        await createEntries.mutateAsync({
                            daoId: treasuryId,
                            entries: recipients.map((r, i) => ({
                                name: r.name,
                                networks: r.networks,
                                address: r.address,
                                note: notes[i] || undefined,
                            })),
                        });
                        onDone();
                    }}
                />
            ),
        },
    ];

    return (
        <PageCard className="w-full max-w-xl mx-auto flex flex-col gap-4 p-4">
            <StepWizard steps={steps} step={step} onStepChange={setStep} />
        </PageCard>
    );
}

// ─── Recipients table view ────────────────────────────────────────────────────

const SEARCH_DEBOUNCE_MS = 300;

function RecipientsView({ onAdd }: { onAdd: () => void }) {
    const { treasuryId } = useTreasury();
    const router = useRouter();
    const { data: entries = [], isLoading } = useAddressBook(treasuryId);
    const deleteEntries = useDeleteAddressBookEntries(treasuryId);
    const exportEntries = useExportAddressBook(treasuryId);
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [mobileSearchActive, setMobileSearchActive] = useState(false);
    const [entryToDelete, setEntryToDelete] = useState<AddressBookEntry | null>(
        null,
    );
    const [bulkDeleteCount, setBulkDeleteCount] = useState(0);
    const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const isMobile = useMediaQuery("(max-width: 640px)");

    const handleSearchChange = useCallback((value: string) => {
        setSearch(value);
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = setTimeout(() => {
            setDebouncedSearch(value.trim());
        }, SEARCH_DEBOUNCE_MS);
    }, []);

    useEffect(() => {
        return () => {
            if (searchTimeoutRef.current)
                clearTimeout(searchTimeoutRef.current);
        };
    }, []);

    const filtered = debouncedSearch
        ? entries.filter(
              (e) =>
                  e.name
                      .toLowerCase()
                      .includes(debouncedSearch.toLowerCase()) ||
                  e.address
                      .toLowerCase()
                      .includes(debouncedSearch.toLowerCase()),
          )
        : entries;

    const hasSelection = selectedIds.size > 0;

    function handleDelete(entry: AddressBookEntry) {
        setEntryToDelete(entry);
    }

    function handleRemoveSelected() {
        setBulkDeleteCount(selectedIds.size);
    }

    async function handleConfirmDelete() {
        if (bulkDeleteCount > 0) {
            await deleteEntries.mutateAsync([...selectedIds]);
            setSelectedIds(new Set());
            setBulkDeleteCount(0);
        } else if (entryToDelete) {
            await deleteEntries.mutateAsync([entryToDelete.id]);
            setEntryToDelete(null);
        }
    }

    function handleCloseDialog() {
        setEntryToDelete(null);
        setBulkDeleteCount(0);
    }

    async function handleExport() {
        await exportEntries.mutateAsync(
            hasSelection ? [...selectedIds] : undefined,
        );
    }

    function handleSend(entry: AddressBookEntry) {
        router.push(
            `/${treasuryId}/payments?address=${encodeURIComponent(entry.address)}`,
        );
    }

    return (
        <PageCard className="p-0 gap-0">
            {/* Header */}
            <div className="flex flex-row items-center justify-between gap-3 sm:gap-4 py-3 sm:py-2 px-4 sm:px-6 border-b">
                {hasSelection ? (
                    <>
                        <span className="font-semibold text-base">
                            {selectedIds.size}{" "}
                            {selectedIds.size === 1
                                ? "Recipient"
                                : "Recipients"}{" "}
                            selected
                        </span>
                        <div className="flex items-center gap-2">
                            <AuthButton
                                permissionKind="any"
                                permissionAction=""
                                variant="secondary"
                                size={isMobile ? "icon" : "default"}
                                onClick={handleExport}
                            >
                                <FileDown className="size-4" />
                                <span className="hidden sm:inline">Export</span>
                            </AuthButton>
                            <AuthButton
                                permissionKind="any"
                                permissionAction=""
                                variant="outline-destructive"
                                size={isMobile ? "icon" : "default"}
                                disabled={deleteEntries.isPending}
                                onClick={() => handleRemoveSelected()}
                            >
                                <Trash2 className="size-4" />
                                <span className="hidden sm:flex">Remove</span>
                            </AuthButton>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="flex items-center gap-3 w-max">
                            <h2 className="text-base font-semibold leading-none">
                                Recipients
                            </h2>
                            {entries.length > 0 && (
                                <NumberBadge
                                    number={entries.length}
                                    variant="secondary"
                                />
                            )}
                        </div>
                        <div className="flex items-center gap-2 justify-end min-w-0">
                            <ResponsiveInput
                                type="text"
                                placeholder="Search recipient by name"
                                mobilePlaceholder="Search"
                                className="max-w-52 w-full"
                                search
                                value={search}
                                onChange={(e) =>
                                    handleSearchChange(e.target.value)
                                }
                                onSearchActiveChange={setMobileSearchActive}
                            />
                            <AuthButton
                                permissionKind="any"
                                permissionAction=""
                                variant="secondary"
                                className={cn(
                                    "gap-1.5",
                                    mobileSearchActive && "hidden sm:flex",
                                )}
                                size={isMobile ? "icon" : "default"}
                                onClick={handleExport}
                            >
                                <FileDown className="size-4" />
                                <span className="hidden sm:inline">Export</span>
                            </AuthButton>
                            <Button
                                variant="secondary"
                                className={cn(
                                    "gap-1.5",
                                    mobileSearchActive && "hidden sm:flex",
                                )}
                                size={isMobile ? "icon" : "default"}
                            >
                                <FileUp className="size-4" />
                                <span className="hidden sm:inline">Import</span>
                            </Button>
                            <AuthButton
                                permissionKind="any"
                                permissionAction=""
                                className={cn(
                                    "gap-1.5",
                                    mobileSearchActive && "hidden sm:flex",
                                )}
                                size={isMobile ? "icon" : "default"}
                                onClick={onAdd}
                            >
                                <Plus className="size-4" />
                                <span className="hidden sm:inline">
                                    Add Recipient
                                </span>
                            </AuthButton>
                        </div>
                    </>
                )}
            </div>

            {/* Table */}
            {isLoading ? (
                <TableSkeleton rows={6} columns={7} />
            ) : (
                <AddressBookTable
                    entries={filtered}
                    selectedIds={selectedIds}
                    onSelectionChange={setSelectedIds}
                    onDelete={handleDelete}
                    onSend={handleSend}
                />
            )}

            <RemoveRecipientDialog
                entry={entryToDelete}
                count={bulkDeleteCount}
                onConfirm={handleConfirmDelete}
                onClose={handleCloseDialog}
            />
        </PageCard>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AddressBookPage() {
    const { treasuryId } = useTreasury();
    const { data: entries, isLoading } = useAddressBook(treasuryId);
    const [adding, setAdding] = useState(false);

    const hasEntries = (entries?.length ?? 0) > 0;

    return (
        <PageComponentLayout
            title="Address Book"
            description="Manage your saved recipients"
        >
            {adding ? (
                <AddRecipientFlow
                    onDone={() => setAdding(false)}
                    onCancel={() => setAdding(false)}
                />
            ) : isLoading || hasEntries ? (
                <RecipientsView onAdd={() => setAdding(true)} />
            ) : (
                <AddressBookEmptyState onAdd={() => setAdding(true)} />
            )}
        </PageComponentLayout>
    );
}
