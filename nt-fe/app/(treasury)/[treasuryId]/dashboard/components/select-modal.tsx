import { useState, useMemo, useCallback, ReactNode } from "react";
import { Check } from "lucide-react";
import { Input } from "@/components/input";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/modal";
import { SelectList, SelectListItem } from "@/components/select-list";

export interface SelectOption extends SelectListItem {}

interface SelectModalPropsBase {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    options: SelectOption[];
    searchPlaceholder?: string;
    isLoading?: boolean;
    fixNear?: boolean;
    roundIcons?: boolean;
    renderIcon?: (item: SelectOption) => ReactNode;
    renderContent?: (item: SelectOption) => ReactNode;
    renderRight?: (item: SelectOption) => ReactNode;
}

interface SelectModalSingleProps extends SelectModalPropsBase {
    multiSelect?: false;
    onSelect: (option: SelectOption) => void;
    selectedId?: string;
    selectedIds?: never;
}

interface SelectModalMultiProps extends SelectModalPropsBase {
    multiSelect: true;
    onSelect: (option: SelectOption) => void;
    selectedIds: string[];
    selectedId?: never;
}

type SelectModalProps = SelectModalSingleProps | SelectModalMultiProps;

export function SelectModal({
    isOpen,
    onClose,
    onSelect,
    title,
    options,
    searchPlaceholder = "Search by name",
    isLoading = false,
    selectedId,
    selectedIds,
    multiSelect,
    fixNear,
    roundIcons,
    renderIcon,
    renderContent,
    renderRight,
}: SelectModalProps) {
    const [searchQuery, setSearchQuery] = useState("");

    const filteredOptions = useMemo(() => {
        if (!searchQuery) return options;

        const query = searchQuery.toLowerCase();
        return options.filter(
            (option) =>
                (option.name || "").toLowerCase().includes(query) ||
                (option.symbol || "").toLowerCase().includes(query),
        );
    }, [options, searchQuery]);

    const handleSelect = useCallback(
        (option: SelectOption) => {
            onSelect(option);
            if (!multiSelect) {
                setSearchQuery("");
                onClose();
            }
        },
        [onSelect, onClose, multiSelect],
    );

    const handleClose = useCallback(() => {
        setSearchQuery("");
        onClose();
    }, [onClose]);

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
            <DialogContent className="max-w-md">
                <DialogHeader centerTitle>
                    <DialogTitle>{title}</DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    <Input
                        type="text"
                        search
                        placeholder={searchPlaceholder}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />

                    <SelectList
                        items={filteredOptions}
                        onSelect={handleSelect}
                        isLoading={isLoading}
                        selectedId={selectedId}
                        emptyMessage="No results found"
                        fixNear={fixNear}
                        roundIcons={roundIcons}
                        renderIcon={renderIcon}
                        renderContent={renderContent}
                        renderRight={
                            renderRight ??
                            (multiSelect
                                ? (item) =>
                                      selectedIds?.includes(item.id) ? (
                                          <Check className="size-4 text-primary shrink-0" />
                                      ) : null
                                : undefined)
                        }
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
}
