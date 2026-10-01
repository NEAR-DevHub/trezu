"use client";

import {
    AlertCircleIcon,
    CheckIcon,
    InfoIcon,
} from "@hugeicons/core-free-icons";
import { Toaster as SonnerToaster } from "sonner";
import { Button } from "@/components/button";
import { Icon } from "@/components/icon";
import { useMediaQuery } from "@/hooks/use-media-query";

/** Toast action. Pass this element as `action`, not `{ label, onClick }`. */
const TOAST_ACTION_CLASS =
    "toaster-action text-sm font-bold leading-none text-general-unofficial-ghost-foreground hover:bg-general-unofficial-ghost-hover hover:text-general-unofficial-ghost-foreground";

export function ToastActionButton({
    children,
    onClick,
}: {
    children: string;
    onClick: () => void;
}) {
    return (
        <Button
            type="button"
            variant="ghost"
            size="mini"
            className={TOAST_ACTION_CLASS}
            onClick={onClick}
        >
            {children}
        </Button>
    );
}

export function Toaster() {
    const isMobile = useMediaQuery("(max-width: 1023px)");

    return (
        <SonnerToaster
            theme="dark"
            position={isMobile ? "top-center" : "top-right"}
            richColors={false}
            closeButton={false}
            offset={isMobile ? 12 : 24}
            mobileOffset={{ top: 12, left: 16, right: 16 }}
            // Toasts with an action pass 5000 so the link stays clickable.
            duration={3000}
            toastOptions={{
                unstyled: false,
                classNames: {
                    toast: "toaster-toast",
                    title: "toaster-title text-base font-semibold leading-[1.2] text-general-foreground",
                    description:
                        "toaster-description text-sm font-medium leading-normal text-general-secondary-foreground",
                    success: "toaster-toast",
                    error: "toaster-toast",
                    info: "toaster-toast",
                    actionButton: TOAST_ACTION_CLASS,
                    icon: "toaster-icon",
                    content: "toaster-content",
                },
            }}
            icons={{
                success: (
                    <Icon
                        icon={CheckIcon}
                        className="size-4 rounded-full bg-general-success-foreground stroke-3 text-[#171717] shrink-0"
                    />
                ),
                error: (
                    <Icon
                        icon={AlertCircleIcon}
                        className="size-4 shrink-0 text-card! [&_circle]:fill-general-error-icon [&_circle]:stroke-general-error-icon"
                    />
                ),
                info: (
                    <Icon
                        icon={InfoIcon}
                        className="size-4 shrink-0 text-card! [&_circle]:fill-general-info-icon [&_circle]:stroke-general-info-icon"
                    />
                ),
            }}
        />
    );
}
