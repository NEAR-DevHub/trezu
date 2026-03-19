"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import {
    useCreateAddressBookEntries,
    useAddressBook,
    useDeleteAddressBookEntries,
} from "@/features/address-book";
import { useTreasury } from "@/hooks/use-treasury";
import { TableSkeleton } from "@/components/table-skeleton";
import { ResponsiveInput } from "@/components/input";
import { NumberBadge } from "@/components/number-badge";

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
    const { data: entries = [], isLoading } = useAddressBook(treasuryId);
    const deleteEntries = useDeleteAddressBookEntries(treasuryId);
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [mobileSearchActive, setMobileSearchActive] = useState(false);
    const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

    async function handleRemoveSelected() {
        await deleteEntries.mutateAsync([...selectedIds]);
        setSelectedIds(new Set());
    }

    return (
        <PageCard className="p-0 gap-0">
            {/* Header */}
            <div className="flex flex-row items-center justify-between gap-3 sm:gap-4 py-3 sm:py-2 px-4 sm:px-6 border-b">
                {hasSelection ? (
                    <>
                        <span className="font-semibold text-base sm:text-lg">
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
                                variant="outline"
                                size="sm"
                                className="h-9 w-full sm:w-auto text-destructive hover:text-destructive hover:bg-destructive/10"
                                disabled={deleteEntries.isPending}
                                onClick={handleRemoveSelected}
                            >
                                <Trash2 className="w-4 h-4 mr-1" /> Remove
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
                            <Button
                                variant="secondary"
                                className={cn(
                                    "gap-1.5",
                                    mobileSearchActive && "hidden md:flex",
                                )}
                            >
                                <FileDown className="size-3.5" />
                                <span className="hidden sm:inline">Export</span>
                            </Button>
                            <Button
                                variant="secondary"
                                className={cn(
                                    "gap-1.5",
                                    mobileSearchActive && "hidden md:flex",
                                )}
                            >
                                <FileUp className="size-3.5" />
                                <span className="hidden sm:inline">Import</span>
                            </Button>
                            <AuthButton
                                permissionKind="any"
                                permissionAction=""
                                className={cn(
                                    "gap-1.5",
                                    mobileSearchActive && "hidden md:flex",
                                )}
                                onClick={onAdd}
                            >
                                <Plus className="size-3.5" />
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
                />
            )}
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
