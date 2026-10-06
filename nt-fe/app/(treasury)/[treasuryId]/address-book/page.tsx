"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
    Add01Icon,
    Delete01Icon,
    FileDownIcon,
    FileUpIcon,
} from "@hugeicons/core-free-icons";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { buildPaymentsDeepLink } from "@/app/(treasury)/[treasuryId]/dashboard/components/deposit/deposit-transfer-url";
import { AuthButton } from "@/components/auth-button";
import { Button } from "@/components/button";
import { PageCard } from "@/components/card";
import { EmptyState } from "@/components/empty-state";
import { Icon } from "@/components/icon";
import { ResponsiveInput } from "@/components/input";
import { MobilePageHeading } from "@/components/mobile-page-heading";
import { PageComponentLayout } from "@/components/page-component-layout";
import { Form } from "@/components/ui/form";
import {
    type AddressBookEntry,
    formatAddressBookDisplayAddress,
    persistAddressBookAddress,
    type RecipientDraft,
    useAddressBook,
    useCreateAddressBookEntries,
    useDeleteAddressBookEntries,
    useExportAddressBook,
} from "@/features/address-book";
import { useChains } from "@/features/address-book/chains";
import {
    AddRecipientInput,
    buildFormSchema,
    type FormValues,
} from "@/features/address-book/components/add-recipient-form";
import {
    ContactsEmptyBackdrop,
    ContactsTableSkeleton,
} from "@/features/address-book/components/address-book-skeleton";
import { AddressBookTable } from "@/features/address-book/components/address-book-table";
import { ContactActionSheet } from "@/features/address-book/components/contact-action-sheet";
import {
    ImportUploadStep,
    type ParsedRecipient,
} from "@/features/address-book/components/import-recipients-flow";
import { RemoveRecipientDialog } from "@/features/address-book/components/remove-recipient-dialog";
import { ReviewRecipients } from "@/features/address-book/components/review-recipients";
import { RECIPIENT_NAME_MAX_LENGTH } from "@/features/address-book/types";
import { duplicateRecipientIndexes } from "@/features/address-book/utils/duplicate-recipients";
import {
    buildNetworkLookup,
    resolveNetworkName,
} from "@/features/address-book/utils/resolve-network";
import { useHideMobileBottomNav } from "@/hooks/use-hide-mobile-bottom-nav";
import { useTreasury } from "@/hooks/use-treasury";
import { trackEvent } from "@/lib/analytics";
import { cn } from "@/lib/utils";

// ─── Empty state ──────────────────────────────────────────────────────────────

const TOOLBAR_BUTTON_CLASS = "h-10 gap-2 rounded-lg text-sm";

function HideMobileBottomNav() {
    useHideMobileBottomNav();
    return null;
}

function AddressBookEmptyState({
    onAdd,
    onImport,
}: {
    onAdd: () => void;
    onImport: () => void;
}) {
    const tAb = useTranslations("addressBook");
    const actions = () => (
        <div className="flex items-center gap-2">
            <AuthButton
                permissionKind="any"
                permissionAction=""
                variant="secondary"
                className={cn(
                    TOOLBAR_BUTTON_CLASS,
                    // Same gray as the translucent secondary fill, but solid,
                    // so the faded row line cannot show through.
                    "dark:bg-[color-mix(in_srgb,white_10%,var(--card))]",
                )}
                onClick={onImport}
            >
                <Icon icon={FileDownIcon} />
                {tAb("import")}
            </AuthButton>
            <AuthButton
                permissionKind="any"
                permissionAction=""
                className={TOOLBAR_BUTTON_CLASS}
                onClick={onAdd}
            >
                <Icon icon={Add01Icon} /> {tAb("addRecipient")}
            </AuthButton>
        </div>
    );

    const message = (
        <EmptyState
            title={tAb("emptyTitle")}
            description={tAb("emptyDescription")}
            className="gap-4 py-0"
            actions={actions()}
        />
    );

    return (
        <>
            <div className="relative min-h-0 flex-1 md:hidden">
                <div
                    aria-hidden
                    className="pointer-events-none select-none **:data-[slot=skeleton]:animate-none!"
                >
                    <ContactsEmptyBackdrop />
                </div>
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="pointer-events-auto">{message}</div>
                </div>
            </div>
            <div className="hidden md:block">
                <EmptyState
                    title={tAb("emptyTitle")}
                    description={tAb("emptyDescription")}
                    skeleton={<ContactsEmptyBackdrop />}
                    className="gap-4 py-0"
                    actions={actions()}
                />
            </div>
        </>
    );
}

// ─── Add / Import flow (shared stepper) ──────────────────────────────────────

function RecipientFlow({
    mode,
    initialRecipient,
    existingEntries = [],
    onDone,
    onCancel,
    onImport,
    hideHeader = false,
}: {
    mode: "add" | "import";
    initialRecipient?: RecipientDraft | null;
    existingEntries?: AddressBookEntry[];
    onDone: () => void;
    onCancel: () => void;
    onImport: () => void;
    /** Title and import live in the page header. */
    hideHeader?: boolean;
}) {
    const { treasuryId } = useTreasury();
    const tValidation = useTranslations("recipientForm.validation");
    const [step, setStep] = useState(0);
    const [activeIndex, setActiveIndex] = useState(0);
    const [importNotes, setImportNotes] = useState<Record<number, string>>({});
    const createEntries = useCreateAddressBookEntries(treasuryId);
    const defaultValues = useMemo(
        () => ({
            recipients: [
                initialRecipient ?? { name: "", networks: [], address: "" },
            ],
        }),
        [initialRecipient],
    );

    const formSchema = useMemo(
        () =>
            buildFormSchema({
                nameRequired: tValidation("nameRequired"),
                nameMax: tValidation("nameMax", {
                    max: RECIPIENT_NAME_MAX_LENGTH,
                }),
                addressRequired: tValidation("addressRequired"),
                networksRequired: tValidation("networksRequired"),
            }),
        [tValidation],
    );

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues,
        mode: "onChange",
    });

    useEffect(() => {
        form.reset(defaultValues);
        setStep(0);
        setActiveIndex(0);
        setImportNotes({});
    }, [defaultValues, form]);

    // Manual add saves from the form. Duplicates are skipped, same as review.
    const handleManualSave = async (notes: Record<number, string> = {}) => {
        if (!treasuryId) return;

        const existingAddresses = new Set(
            existingEntries.map((entry) => persistAddressBookAddress(entry)),
        );
        const recipients = form.getValues().recipients;
        const duplicateIndexes = new Set(
            duplicateRecipientIndexes(recipients, existingAddresses),
        );
        const entries = recipients.flatMap((recipient, index) => {
            if (
                !recipient.name.trim() ||
                !recipient.address.trim() ||
                recipient.networks.length === 0 ||
                duplicateIndexes.has(index)
            ) {
                return [];
            }

            return [
                {
                    name: recipient.name,
                    networks: recipient.networks,
                    address: persistAddressBookAddress(recipient),
                    note: notes[index] || undefined,
                },
            ];
        });

        if (entries.length === 0) return;

        await createEntries.mutateAsync({
            daoId: treasuryId,
            entries,
        });
        onDone();
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

    const flow = (
        <Form {...form}>
            {step === 0 ? (
                mode === "add" ? (
                    <AddRecipientInput
                        control={form.control}
                        activeIndex={activeIndex}
                        setActiveIndex={setActiveIndex}
                        handleBack={onCancel}
                        onSave={handleManualSave}
                        existingEntries={existingEntries}
                        isSubmitting={createEntries.isPending}
                        onImport={onImport}
                        hideHeader={hideHeader}
                    />
                ) : (
                    <ImportUploadStep onReview={handleImportReview} />
                )
            ) : (
                <ReviewRecipients
                    handleBack={() => setStep(0)}
                    control={form.control}
                    existingEntries={existingEntries}
                    isSubmitting={createEntries.isPending}
                    initialNotes={importNotes}
                    onSubmit={async (notes, includedIndexes) => {
                        // Empty indexes is unreachable while ReviewRecipients
                        // disables submit when canSubmit is false (all duplicates
                        // + skip). Keep the guard; toast lives on mutateAsync [].
                        if (!treasuryId || includedIndexes.length === 0) {
                            onDone();
                            return;
                        }
                        await createEntries.mutateAsync({
                            daoId: treasuryId,
                            entries: includedIndexes.map((index) => {
                                const recipient = recipients[index];

                                return {
                                    name: recipient.name,
                                    networks: recipient.networks,
                                    address:
                                        persistAddressBookAddress(recipient),
                                    note: notes[index] || undefined,
                                };
                            }),
                        });
                        onDone();
                    }}
                />
            )}
        </Form>
    );

    if (hideHeader) return flow;

    return (
        <PageCard className="mx-auto flex w-full max-w-150 flex-col gap-4 p-4">
            {flow}
        </PageCard>
    );
}

// ─── Recipients table view ────────────────────────────────────────────────────

const SEARCH_DEBOUNCE_MS = 300;
const ADDRESS_BOOK_PAGE_SIZE = 20;

function RecipientsView({ onAdd }: { onAdd: () => void }) {
    const tAb = useTranslations("addressBook");
    const tCommon = useTranslations("common");
    const { treasuryId } = useTreasury();
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const { data: entries, isLoading } = useAddressBook();
    const recipientEntries = entries ?? [];
    const deleteEntries = useDeleteAddressBookEntries(treasuryId);
    const exportEntries = useExportAddressBook(treasuryId);
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isMobileSelectMode, setIsMobileSelectMode] = useState(false);
    const [mobileSearchActive, setMobileSearchActive] = useState(false);
    const [entriesToDelete, setEntriesToDelete] = useState<AddressBookEntry[]>(
        [],
    );
    const [sheetEntry, setSheetEntry] = useState<AddressBookEntry | null>(null);
    const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const page = Math.max(
        0,
        Number.parseInt(searchParams.get("page") || "0", 10) || 0,
    );

    const exitMobileSelectMode = useCallback(() => {
        setIsMobileSelectMode(false);
        setSelectedIds(new Set());
    }, []);

    const handleSearchChange = useCallback((value: string) => {
        setSearch(value);
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = setTimeout(() => {
            setDebouncedSearch(value.trim());
        }, SEARCH_DEBOUNCE_MS);
    }, []);

    const updatePage = useCallback(
        (newPage: number, replace = false) => {
            const params = new URLSearchParams(searchParams.toString());

            if (newPage === 0) {
                params.delete("page");
            } else {
                params.set("page", newPage.toString());
            }

            const nextUrl = params.toString()
                ? `${pathname}?${params.toString()}`
                : pathname;

            if (replace) {
                router.replace(nextUrl, { scroll: false });
                return;
            }

            router.push(nextUrl, { scroll: false });
        },
        [pathname, router, searchParams],
    );

    useEffect(() => {
        return () => {
            if (searchTimeoutRef.current)
                clearTimeout(searchTimeoutRef.current);
        };
    }, []);

    const filtered = debouncedSearch
        ? recipientEntries.filter(
              (e) =>
                  e.name
                      .toLowerCase()
                      .includes(debouncedSearch.toLowerCase()) ||
                  e.address
                      .toLowerCase()
                      .includes(debouncedSearch.toLowerCase()),
          )
        : recipientEntries;
    const totalPages = Math.ceil(filtered.length / ADDRESS_BOOK_PAGE_SIZE);
    const pageIndex =
        totalPages === 0 ? 0 : Math.min(page, Math.max(totalPages - 1, 0));
    const paginatedEntries = filtered.slice(
        pageIndex * ADDRESS_BOOK_PAGE_SIZE,
        (pageIndex + 1) * ADDRESS_BOOK_PAGE_SIZE,
    );

    useEffect(() => {
        if (page !== pageIndex) {
            updatePage(pageIndex, true);
        }
    }, [page, pageIndex, updatePage]);

    const hasSelection = selectedIds.size > 0;

    function handleDelete(entry: AddressBookEntry) {
        trackEvent("contact_action", {
            contact_action: "delete",
            treasury_id: treasuryId,
        });
        setEntriesToDelete([entry]);
    }

    function handleRemoveSelected() {
        trackEvent("bulk_action", {
            page: "contacts",
            interaction_type: "delete",
            count: selectedIds.size,
            treasury_id: treasuryId,
        });
        setEntriesToDelete(
            recipientEntries.filter((entry) => selectedIds.has(entry.id)),
        );
    }

    async function handleConfirmDelete() {
        const ids = entriesToDelete.map((entry) => entry.id);
        if (ids.length === 0) return;
        await deleteEntries.mutateAsync(ids);
        setSelectedIds((prev) => {
            const next = new Set(prev);
            for (const id of ids) next.delete(id);
            return next;
        });
        setEntriesToDelete([]);
    }

    function handleCloseDialog() {
        setEntriesToDelete([]);
    }

    async function handleExport() {
        if (hasSelection) {
            trackEvent("bulk_action", {
                page: "contacts",
                interaction_type: "export",
                count: selectedIds.size,
                treasury_id: treasuryId,
            });
        } else {
            trackEvent("table_cta_click", {
                page: "contacts",
                cta_button: "export",
                treasury_id: treasuryId,
            });
        }
        await exportEntries.mutateAsync(
            hasSelection ? [...selectedIds] : undefined,
        );
    }

    function handleSend(entry: AddressBookEntry) {
        if (!treasuryId) return;
        trackEvent("contact_action", {
            contact_action: "send",
            treasury_id: treasuryId,
        });
        router.push(
            buildPaymentsDeepLink(treasuryId, {
                address: formatAddressBookDisplayAddress(entry),
                name: entry.name,
                networks: entry.networks,
            }),
        );
    }

    const toolbarIconButtonClass = cn(
        TOOLBAR_BUTTON_CLASS,
        "size-10 px-0 sm:h-10 sm:w-auto sm:px-4",
        mobileSearchActive && "hidden sm:inline-flex",
    );
    const toolbarLabeledButtonClass = cn(
        TOOLBAR_BUTTON_CLASS,
        mobileSearchActive && "hidden sm:inline-flex",
    );

    if (isLoading && !entries) {
        return <ContactsTableSkeleton />;
    }

    return (
        <div className="flex flex-col gap-5">
            {hasSelection ? (
                <div className="flex items-center justify-between gap-4">
                    <span className="hidden text-xl font-semibold leading-[1.2] tracking-[-0.025rem] text-general-secondary-foreground md:block">
                        {tAb("recipientsSelected", {
                            count: selectedIds.size,
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
                    <div className="flex items-center gap-2">
                        <AuthButton
                            permissionKind="any"
                            permissionAction=""
                            variant="secondary"
                            className={toolbarLabeledButtonClass}
                            loading={exportEntries.isPending}
                            onClick={handleExport}
                        >
                            {exportEntries.isPending ? null : (
                                <Icon icon={FileUpIcon} />
                            )}
                            {exportEntries.isPending
                                ? tCommon("exporting")
                                : tCommon("export")}
                        </AuthButton>
                        <AuthButton
                            permissionKind="any"
                            permissionAction=""
                            variant="destructive"
                            className={toolbarLabeledButtonClass}
                            disabled={deleteEntries.isPending}
                            onClick={() => handleRemoveSelected()}
                        >
                            <Icon icon={Delete01Icon} />
                            {tCommon("remove")}
                        </AuthButton>
                    </div>
                </div>
            ) : (
                <div className="flex items-center justify-between gap-4">
                    <p className="hidden text-xl font-semibold leading-[1.2] tracking-[-0.025rem] text-general-secondary-foreground md:block">
                        {tAb("contactsCount", {
                            count: recipientEntries.length,
                        })}
                    </p>
                    {!mobileSearchActive && (
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
                    )}
                    <div
                        className={cn(
                            "flex items-center justify-end gap-2",
                            mobileSearchActive ? "w-full" : "ml-auto",
                        )}
                    >
                        <ResponsiveInput
                            type="text"
                            placeholder={tAb("searchPlaceholder")}
                            mobilePlaceholder={tAb("searchPlaceholderShort")}
                            className="h-10 md:w-72.5 md:shrink-0"
                            buttonClassName="size-10 rounded-lg bg-general-bg-secondary hover:bg-general-bg-secondary/80"
                            mobileCloseButton
                            inputClassName="rounded-lg border border-general-border bg-card! hover:bg-card! pl-9 text-sm placeholder:font-medium placeholder:text-sm placeholder:text-general-muted-foreground dark:placeholder:text-muted-foreground focus-visible:border-general-border focus-visible:ring-0"
                            searchIconClassName="left-2 size-5 text-general-muted-foreground dark:text-muted-foreground"
                            search
                            value={search}
                            onChange={(e) => handleSearchChange(e.target.value)}
                            onSearchActiveChange={setMobileSearchActive}
                        />
                        <AuthButton
                            permissionKind="any"
                            permissionAction=""
                            variant="secondary"
                            className={toolbarIconButtonClass}
                            loading={exportEntries.isPending}
                            onClick={handleExport}
                        >
                            {exportEntries.isPending ? null : (
                                <Icon icon={FileUpIcon} />
                            )}
                            <span className="hidden sm:inline">
                                {exportEntries.isPending
                                    ? tCommon("exporting")
                                    : tCommon("export")}
                            </span>
                        </AuthButton>
                        <AuthButton
                            permissionKind="any"
                            permissionAction=""
                            className={toolbarIconButtonClass}
                            onClick={onAdd}
                        >
                            <Icon icon={Add01Icon} />
                            <span className="hidden sm:inline">
                                {tAb("addRecipient")}
                            </span>
                        </AuthButton>
                    </div>
                </div>
            )}

            <AddressBookTable
                entries={paginatedEntries}
                selectedIds={selectedIds}
                onSelectionChange={setSelectedIds}
                onDelete={handleDelete}
                onSend={handleSend}
                onOpen={setSheetEntry}
                isMobileSelectMode={isMobileSelectMode}
                searchQuery={debouncedSearch}
                pageIndex={pageIndex}
                pageSize={ADDRESS_BOOK_PAGE_SIZE}
                total={filtered.length}
                onPageChange={updatePage}
            />

            <ContactActionSheet
                entry={sheetEntry}
                open={!!sheetEntry}
                onOpenChange={(open) => {
                    if (!open) setSheetEntry(null);
                }}
                onSend={() => {
                    if (!sheetEntry) return;
                    const entry = sheetEntry;
                    setSheetEntry(null);
                    handleSend(entry);
                }}
                onRemove={() => {
                    if (!sheetEntry) return;
                    const entry = sheetEntry;
                    setSheetEntry(null);
                    handleDelete(entry);
                }}
            />

            <RemoveRecipientDialog
                entries={entriesToDelete}
                onConfirm={handleConfirmDelete}
                onClose={handleCloseDialog}
            />
        </div>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AddressBookPage() {
    const t = useTranslations("pages.addressBook");
    const tAb = useTranslations("addressBook");
    const { treasuryId } = useTreasury();
    const pathname = usePathname();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { data: entries, isLoading } = useAddressBook();
    const { data: chains = [], isLoading: isChainsLoading } = useChains();
    const [flowMode, setFlowMode] = useState<"add" | "import" | null>(null);
    const [initialRecipient, setInitialRecipient] =
        useState<RecipientDraft | null>(null);

    const hasEntries = (entries?.length ?? 0) > 0;
    const prefilledRecipient = useMemo(() => {
        const address = searchParams.get("address")?.trim();
        if (!address) return null;

        const rawNetworks = (
            searchParams.get("networks") ??
            searchParams.get("network") ??
            ""
        )
            .split(",")
            .map((network) => network.trim())
            .filter(Boolean);

        if (rawNetworks.length > 0 && isChainsLoading && chains.length === 0) {
            return null;
        }

        const networkLookup = buildNetworkLookup(chains);
        const networks = rawNetworks
            .map((network) => resolveNetworkName(network, networkLookup))
            .filter((network): network is string => Boolean(network));

        return {
            name: searchParams.get("name")?.trim() || address,
            address,
            networks,
        };
    }, [chains, isChainsLoading, searchParams]);

    const clearPrefillParams = useCallback(() => {
        const nextParams = new URLSearchParams(searchParams.toString());
        for (const key of ["name", "address", "network", "networks"]) {
            nextParams.delete(key);
        }

        const nextQuery = nextParams.toString();
        router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
            scroll: false,
        });
    }, [pathname, router, searchParams]);

    useEffect(() => {
        if (!prefilledRecipient) return;

        setInitialRecipient(prefilledRecipient);
        setFlowMode("add");
    }, [prefilledRecipient]);

    const handleAdd = useCallback(() => {
        trackEvent("table_cta_click", {
            page: "contacts",
            cta_button: "add_contact",
            treasury_id: treasuryId,
        });
        setInitialRecipient(null);
        setFlowMode("add");
        clearPrefillParams();
    }, [clearPrefillParams, treasuryId]);

    const handleImport = useCallback(() => {
        trackEvent("table_cta_click", {
            page: "contacts",
            cta_button: "import",
            treasury_id: treasuryId,
        });
        setInitialRecipient(null);
        setFlowMode("import");
        clearPrefillParams();
    }, [clearPrefillParams, treasuryId]);

    const handleCloseFlow = useCallback(() => {
        setFlowMode(null);
        setInitialRecipient(null);
        clearPrefillParams();
    }, [clearPrefillParams]);

    if (flowMode === "import") {
        return (
            <PageComponentLayout
                title={tAb("addRecipient")}
                backButton={handleCloseFlow}
                hideMobileShellControls
                reserveHeaderSpace
            >
                <HideMobileBottomNav />
                <div className="mx-auto w-full max-w-lg">
                    <RecipientFlow
                        mode="import"
                        hideHeader
                        existingEntries={entries ?? []}
                        onDone={handleCloseFlow}
                        onCancel={handleCloseFlow}
                        onImport={handleImport}
                    />
                </div>
            </PageComponentLayout>
        );
    }

    if (flowMode === "add") {
        return (
            <PageComponentLayout
                title={tAb("addRecipient")}
                backButton={handleCloseFlow}
                hideMobileShellControls
                reserveHeaderSpace
                headerActions={
                    <AuthButton
                        permissionKind="any"
                        permissionAction=""
                        variant="secondary"
                        className="size-10 px-0 sm:h-10 sm:w-auto sm:px-4 gap-2 rounded-lg text-sm"
                        onClick={handleImport}
                    >
                        <Icon icon={FileDownIcon} />
                        <span className="hidden sm:inline">
                            {tAb("import")}
                        </span>
                    </AuthButton>
                }
            >
                <HideMobileBottomNav />
                <div className="mx-auto w-full max-w-lg">
                    <RecipientFlow
                        mode="add"
                        hideHeader
                        initialRecipient={initialRecipient}
                        existingEntries={entries ?? []}
                        onDone={handleCloseFlow}
                        onCancel={handleCloseFlow}
                        onImport={handleImport}
                    />
                </div>
            </PageComponentLayout>
        );
    }

    const isEmptyList = !isLoading && !hasEntries;

    return (
        <PageComponentLayout
            title={t("title")}
            mainClassName={
                isEmptyList ? "max-md:flex max-md:flex-col" : undefined
            }
        >
            <MobilePageHeading>{t("title")}</MobilePageHeading>
            {isEmptyList ? (
                <div className="flex min-h-0 flex-1 flex-col md:block">
                    <AddressBookEmptyState
                        onAdd={handleAdd}
                        onImport={handleImport}
                    />
                </div>
            ) : (
                <RecipientsView onAdd={handleAdd} />
            )}
        </PageComponentLayout>
    );
}
