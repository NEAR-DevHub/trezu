"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { PageCard } from "@/components/card";
import { PageComponentLayout } from "@/components/page-component-layout";
import { AuthButton } from "@/components/auth-button";
import { EmptyState } from "@/components/empty-state";
import { FileDown, FileUp, Loader2, Plus, Trash2 } from "lucide-react";
import {
    AddRecipientInput,
    formSchema,
    type FormValues,
} from "@/features/address-book/components/add-recipient-form";
import { Form } from "@/components/ui/form";
import { ReviewRecipients } from "@/features/address-book/components/review-recipients";
import { AddressBookTable } from "@/features/address-book/components/address-book-table";
import { RemoveRecipientDialog } from "@/features/address-book/components/remove-recipient-dialog";
import {
    ImportUploadStep,
    type ParsedRecipient,
} from "@/features/address-book/components/import-recipients-flow";
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

function AddressBookEmptyState({
    onAdd,
    onImport,
}: {
    onAdd: () => void;
    onImport: () => void;
}) {
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
                    onClick={onImport}
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

// ─── Add / Import flow (shared stepper) ──────────────────────────────────────

function RecipientFlow({
    mode,
    onDone,
    onCancel,
}: {
    mode: "add" | "import";
    onDone: () => void;
    onCancel: () => void;
}) {
    const { treasuryId } = useTreasury();
    const [step, setStep] = useState(0);
    const [activeIndex, setActiveIndex] = useState(0);
    const [importNotes, setImportNotes] = useState<Record<number, string>>({});
    const createEntries = useCreateAddressBookEntries(treasuryId);

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            recipients: [{ name: "", networks: [], address: "" }],
        },
        mode: "onChange",
    });

    // Manual add: filter empty rows → review
    const handleManualReview = () => {
        const filled = form
            .getValues()
            .recipients.filter((r) => r.name.trim() || r.address.trim());
        form.reset({ recipients: filled });
        setStep(1);
    };

    // Import: parsed recipients → populate form → review
    const handleImportReview = (parsed: ParsedRecipient[]) => {
        const notes: Record<number, string> = {};
        parsed.forEach((r, i) => {
            if (r.note) notes[i] = r.note;
        });
        setImportNotes(notes);
        form.reset({
            recipients: parsed.map((r) => ({
                name: r.name,
                address: r.address,
                networks: r.networks,
            })),
        });
        setStep(1);
    };

    const recipients = form.watch("recipients");

    return (
        <PageCard className="w-full max-w-[600px] mx-auto flex flex-col gap-4 p-4">
            <Form {...form}>
                {step === 0 ? (
                    mode === "add" ? (
                        <AddRecipientInput
                            control={form.control}
                            activeIndex={activeIndex}
                            setActiveIndex={setActiveIndex}
                            handleBack={onCancel}
                            onReview={handleManualReview}
                        />
                    ) : (
                        <ImportUploadStep
                            handleBack={onCancel}
                            onReview={handleImportReview}
                        />
                    )
                ) : (
                    <ReviewRecipients
                        handleBack={() => setStep(0)}
                        control={form.control}
                        isSubmitting={createEntries.isPending}
                        initialNotes={
                            mode === "import" ? importNotes : undefined
                        }
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
                )}
            </Form>
        </PageCard>
    );
}

// ─── Recipients table view ────────────────────────────────────────────────────

const SEARCH_DEBOUNCE_MS = 300;

function RecipientsView({
    onAdd,
    onImport,
}: {
    onAdd: () => void;
    onImport: () => void;
}) {
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
                                disabled={exportEntries.isPending}
                                onClick={handleExport}
                            >
                                {exportEntries.isPending ? (
                                    <Loader2 className="size-4 animate-spin" />
                                ) : (
                                    <FileDown className="size-4" />
                                )}
                                <span className="hidden sm:inline">
                                    {exportEntries.isPending
                                        ? "Exporting"
                                        : "Export"}
                                </span>
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
                                disabled={exportEntries.isPending}
                                onClick={handleExport}
                            >
                                {exportEntries.isPending ? (
                                    <Loader2 className="size-4 animate-spin" />
                                ) : (
                                    <FileDown className="size-4" />
                                )}
                                <span className="hidden sm:inline">
                                    {exportEntries.isPending
                                        ? "Exporting"
                                        : "Export"}
                                </span>
                            </AuthButton>
                            <AuthButton
                                permissionKind="any"
                                permissionAction=""
                                variant="secondary"
                                className={cn(
                                    "gap-1.5",
                                    mobileSearchActive && "hidden sm:flex",
                                )}
                                size={isMobile ? "icon" : "default"}
                                onClick={onImport}
                            >
                                <FileUp className="size-4" />
                                <span className="hidden sm:inline">Import</span>
                            </AuthButton>
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
    const [flowMode, setFlowMode] = useState<"add" | "import" | null>(null);

    const hasEntries = (entries?.length ?? 0) > 0;

    return (
        <PageComponentLayout
            title="Address Book"
            description="Manage your saved recipients"
        >
            {flowMode ? (
                <RecipientFlow
                    mode={flowMode}
                    onDone={() => setFlowMode(null)}
                    onCancel={() => setFlowMode(null)}
                />
            ) : isLoading || hasEntries ? (
                <RecipientsView
                    onAdd={() => setFlowMode("add")}
                    onImport={() => setFlowMode("import")}
                />
            ) : (
                <AddressBookEmptyState
                    onAdd={() => setFlowMode("add")}
                    onImport={() => setFlowMode("import")}
                />
            )}
        </PageComponentLayout>
    );
}
