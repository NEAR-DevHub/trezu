"use client";

import { CheckIcon } from "@hugeicons/core-free-icons";
import { Toaster as SonnerToaster } from "sonner";
import { Icon } from "@/components/icon";
import { useMediaQuery } from "@/hooks/use-media-query";

const ErrorIcon = () => (
    <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="size-4 shrink-0 text-general-error-icon"
    >
        <path
            d="M8.00065 14.6673C11.6825 14.6673 14.6673 11.6825 14.6673 8.00065C14.6673 4.31875 11.6825 1.33398 8.00065 1.33398C4.31875 1.33398 1.33398 4.31875 1.33398 8.00065C1.33398 11.6825 4.31875 14.6673 8.00065 14.6673Z"
            fill="currentColor"
        />
        <path
            d="M8 5.33398V8.00065"
            stroke="#F5F5F5"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
        <path
            d="M8 10.666H8.00667"
            stroke="#F5F5F5"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    </svg>
);

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
            toastOptions={{
                unstyled: false,
                classNames: {
                    toast: "toaster-toast",
                    title: "toaster-title",
                    description: "toaster-description",
                    success: "toaster-toast",
                    error: "toaster-toast",
                    actionButton: "toaster-action",
                    icon: "toaster-icon",
                    content: "toaster-content",
                },
            }}
            icons={{
                success: (
                    <Icon
                        icon={CheckIcon}
                        className="size-[1.09375rem] rounded-full bg-general-success-foreground stroke-3 text-[#171717] shrink-0"
                    />
                ),
                error: <ErrorIcon />,
            }}
        />
    );
}
