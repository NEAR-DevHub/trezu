"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { CopyButton } from "./copy-button";

interface AddressProps {
    address: string;
    className?: string;
    copyable?: boolean;
    prefixLength?: number;
    suffixLength?: number;
}

export function Address({
    address,
    className,
    copyable = false,
    prefixLength = 8,
    suffixLength = 8,
}: AddressProps) {
    const t = useTranslations("address");
    const prefix = address.slice(0, prefixLength);
    const suffix = address.slice(address.length - suffixLength);
    const displayedAddress =
        address.length > prefixLength + suffixLength
            ? `${prefix}...${suffix}`
            : address;
    return (
        <div className={cn("flex items-center gap-2", className)}>
            <span>{displayedAddress}</span>
            {copyable && (
                <CopyButton
                    text={address}
                    toastMessage={t("copied")}
                    variant="ghost"
                    size="icon-sm"
                />
            )}
        </div>
    );
}
