"use client";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/modal";
import {
    APP_DEMO_URL,
    APP_DOCS_URL,
    APP_ACTIVE_TREASURY,
    APP_TWITTER_URL,
    LANDING_PAGE,
} from "@/constants/config";
import Link from "next/link";
import { CirclePlay, Eye, File, Headphones } from "lucide-react";
import Gleap from "gleap";
import { LogoInlined } from "./logo";

function XIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
    );
}

interface SupportItemProps {
    icon: React.ReactNode;
    title: string;
    description: string;
    href?: string;
    onClick?: () => void;
    closeModal?: () => void;
}

function SupportItem({
    icon,
    title,
    description,
    href,
    onClick,
    closeModal,
}: SupportItemProps) {
    const className =
        "flex bg-secondary items-center gap-3 p-2 rounded-6 hover:bg-general-tertiary transition-colors";
    const content = (
        <>
            <div className="shrink-0 text-foreground">{icon}</div>
            <div className="flex flex-col min-w-0 items-start">
                <span className="text-sm text-foreground">{title}</span>
                <span className="text-sm text-muted-foreground">
                    {description}
                </span>
            </div>
        </>
    );

    if (onClick) {
        return (
            <button
                className={className}
                onClick={() => {
                    onClick();
                    closeModal?.();
                }}
            >
                {content}
            </button>
        );
    }

    return (
        <Link href={href!} target="_blank" className={className}>
            {content}
        </Link>
    );
}

const resourceItems: SupportItemProps[] = [
    {
        icon: <LogoInlined className="size-5" />,
        title: "Trezu Page",
        description: "Visit the Trezu website for more information.",
        href: LANDING_PAGE,
    },
    {
        icon: <Eye className="size-5" />,
        title: "See Demo Trezu",
        description: "Explore and see other account in action.",
        href: APP_ACTIVE_TREASURY,
    },
    {
        icon: <CirclePlay className="size-5" />,
        title: "View Demo",
        description: "Watch the demo to explore how the Treasury works.",
        href: APP_DEMO_URL,
    },
    {
        icon: <XIcon className="size-5" />,
        title: "Follow Us on X",
        description: "Get updates, releases and insights.",
        href: APP_TWITTER_URL,
    },
];

const supportItems: SupportItemProps[] = [
    {
        icon: <File className="size-5" />,
        title: "App Docs",
        description: "Learn all features in the docs.",
        href: APP_DOCS_URL,
    },
    {
        icon: <Headphones className="size-5" />,
        title: "Product Support",
        description: "Get help from our support team.",
        onClick: () => {
            Gleap.open();
        },
    },
];

interface SupportCenterModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function SupportCenterModal({
    open,
    onOpenChange,
}: SupportCenterModalProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[448px]">
                <DialogHeader>
                    <DialogTitle className="text-left">
                        Support Center
                    </DialogTitle>
                </DialogHeader>

                <div className="flex flex-col gap-5">
                    <div className="flex flex-col gap-2">
                        <span className="text-sm font-semibold text-muted-foreground">
                            Resources
                        </span>
                        <div className="flex flex-col gap-3">
                            {resourceItems.map((item) => (
                                <SupportItem key={item.title} {...item} />
                            ))}
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        <span className="text-sm font-semibold text-muted-foreground">
                            Support
                        </span>
                        <div className="flex flex-col gap-3">
                            {supportItems.map((item) => (
                                <SupportItem
                                    key={item.title}
                                    {...item}
                                    closeModal={() => onOpenChange(false)}
                                />
                            ))}
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
