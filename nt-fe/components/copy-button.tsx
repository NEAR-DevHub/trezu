"use client";

import { Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "./button";
import { cn } from "@/lib/utils";

interface CopyButtonProps extends React.ComponentProps<typeof Button> {
    text: string;
    toastMessage?: string;
    iconClassName?: string;
}

export function CopyButton({
    text,
    toastMessage,
    children,
    iconClassName,
    ...props
}: CopyButtonProps) {
    const t = useTranslations("copyButton");
    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            toast.success(toastMessage ?? t("copied"));
        } catch (error) {
            toast.error(t("failed"));
        }
    };

    return (
        <Button type="button" onClick={handleCopy} {...props}>
            <Copy className={cn("h-4 w-4", iconClassName)} />
            {children}
        </Button>
    );
}
