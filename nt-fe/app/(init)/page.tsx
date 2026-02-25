"use client";

import { GradFlow } from "gradflow";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import Logo from "@/components/logo";
import { useTreasury } from "@/hooks/use-treasury";
import { useNear } from "@/stores/near-store";
import { QueryProvider } from "@/components/query-provider";
import { NearInitializer } from "@/components/near-initializer";
import { AuthProvider } from "@/components/auth-provider";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/modal";
import { APP_WALLET_SETUP_URL } from "@/constants/config";
import { trackEvent } from "@/lib/analytics";

interface WalletSuggestionModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

interface WalletSuggestionItemProps {
    name: string;
    href?: string;
    description: string;
    iconUrl: string;
}

function WalletSuggestionItem({
    name,
    href,
    description,
    iconUrl,
}: WalletSuggestionItemProps) {
    const content = () => {
        return (
            <>
                <div className="flex items-center gap-3.5">
                    <Image
                        src={iconUrl}
                        alt={name}
                        width={40}
                        height={40}
                        className="rounded-full size-12 md:size-8"
                    />
                    <div className="flex flex-col justify-start gap-0">
                        <span className="font-semibold text-foreground text-lg">
                            {name}
                        </span>
                        <span className="text-sm text-muted-foreground">
                            {description}
                        </span>
                    </div>
                    {href && (
                        <ArrowUpRight className="size-5 group-hover:opacity-100 opacity-0 ml-auto mr-1.5 transition-opacity duration-200" />
                    )}
                </div>
            </>
        );
    };
    if (href) {
        return (
            <Link
                href={href}
                target="_blank"
                className="flex flex-col gap-1 bg-secondary p-3 rounded-lg group"
                aria-disabled={!href}
            >
                {content()}
            </Link>
        );
    }
    return (
        <div className="flex flex-col gap-1 bg-secondary p-3 rounded-lg group">
            {content()}
        </div>
    );
}

function WalletSuggestionModal({
    open,
    onOpenChange,
}: WalletSuggestionModalProps) {
    const walletSuggestionItems: WalletSuggestionItemProps[] = [
        {
            name: "Meteor Wallet",
            href: "https://meteorwallet.app/",
            description: "Easiest setup for daily operations",
            iconUrl: "/wallets/meteor.svg",
        },
        {
            name: "Ledger Wallet",
            href: "https://ledger.com/",
            description: "Maximum security. Bluetooth supported",
            iconUrl: "/ledger-wallet/ledger-icon.jpeg",
        },
        {
            name: "MyNearWallet",
            description: "Coming soon",
            iconUrl: "/wallets/mynearwallet.svg",
        },
    ];

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Get a Wallet to Continue</DialogTitle>
                </DialogHeader>
                <DialogDescription className="text-foreground">
                    Trezu uses wallet-based authentication instead of passwords.
                    Choose an option below to set up your treasury.
                </DialogDescription>
                <div className="flex flex-col gap-4 mt-2">
                    {walletSuggestionItems.map((item) => (
                        <WalletSuggestionItem key={item.name} {...item} />
                    ))}
                </div>
                {APP_WALLET_SETUP_URL && (
                    <p className="text-sm text-muted-foreground text-center">
                        Need help getting started?{" "}
                        <Link
                            href={APP_WALLET_SETUP_URL}
                            target="_blank"
                            className="text-foreground font-medium hover:text-primary/80"
                        >
                            View setup guide
                        </Link>
                    </p>
                )}
            </DialogContent>
        </Dialog>
    );
}

function GradientTitle() {
    return (
        <div className="overflow-hidden w-full py-1">
            <motion.p
                className="text-[30px] lg:text-5xl tracking-[-1%] leading-[28px] lg:leading-[48px] text-center lg:text-left w-full h-fit font-medium text-white backdrop-blur-[10px] mix-blend-overlay"
                initial={{
                    clipPath: "inset(0 100% 0 0)",
                    x: 0,
                    filter: "blur(8px)",
                    opacity: 1,
                }}
                animate={{
                    clipPath: "inset(0 0% 0 0)",
                    x: 0,
                    filter: "blur(0px)",
                    opacity: 1,
                }}
                transition={{ duration: 0.6, ease: "easeOut", delay: 0.2 }}
                style={{
                    WebkitMask: "linear-gradient(#000 0 0) text",
                    mask: "linear-gradient(#000 0 0) text",
                    mixBlendMode: "overlay",
                }}
            >
                Cross-chain multisig security for managing digital assets
            </motion.p>
        </div>
    );
}

export function Content() {
    const router = useRouter();
    const [isWelcomeImageLoaded, setIsWelcomeImageLoaded] = useState(false);
    const [isWelcomeImageFailed, setIsWelcomeImageFailed] = useState(false);
    const [isWalletSuggestionOpen, setIsWalletSuggestionOpen] = useState(false);
    const {
        accountId,
        connect,
        isInitializing,
        isAuthenticating,
        authError,
        clearError,
    } = useNear();
    const { lastTreasuryId, treasuries, isLoading } = useTreasury();

    useEffect(() => {
        if (!isLoading && treasuries.length > 0) {
            router.push(`/${lastTreasuryId || treasuries[0].daoId}`);
        } else if (
            accountId &&
            treasuries.length === 0 &&
            !isLoading &&
            !isInitializing
        ) {
            router.push(`/app/new`);
        }
    }, [
        treasuries,
        isLoading,
        router,
        accountId,
        isInitializing,
        lastTreasuryId,
    ]);
    const buttonText = isInitializing
        ? "Loading..."
        : isAuthenticating || isLoading
          ? "Authenticating..."
          : "Connect Wallet";

    return (
        <div className="relative h-screen w-full overflow-hidden">
            <GradFlow
                config={{
                    color1: { r: 0, g: 67, b: 224 },
                    color2: { r: 255, g: 255, b: 255 },
                    color3: { r: 9, g: 83, b: 255 },
                    speed: 0.4,
                    scale: 1,
                    type: "stripe",
                    noise: 0.08,
                }}
                className="absolute inset-0"
            />
            <div className="flex relative w-full h-full items-center justify-between overflow-hidden">
                <div className="w-full lg:w-2/5 h-full p-2 lg:p-4 flex flex-col justify-center min-w-0">
                    <div className="w-full min-h-[30%] flex items-center lg:hidden">
                        <GradientTitle />
                    </div>
                    <motion.div
                        className="perspective-distant w-full gap-12 flex flex-col p-4 items-center h-full justify-center bg-white rounded-2xl lg:max-w-4xl"
                        initial={{
                            opacity: 0,
                            y: 44,
                            rotateX: 62,
                            scale: 0.96,
                        }}
                        animate={{ opacity: 1, y: 0, rotateX: 0, scale: 1 }}
                        transition={{
                            duration: 0.7,
                            ease: [0.22, 1, 0.36, 1],
                            delay: 0.14,
                        }}
                        style={{ transformOrigin: "center bottom" }}
                    >
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{
                                duration: 0.35,
                                ease: "easeOut",
                                delay: 0.42,
                            }}
                        >
                            <Logo size="lg" />
                        </motion.div>
                        <div className="flex w-full flex-col items-center justify-center gap-6">
                            <div className="flex w-full flex-col gap-2 text-center">
                                <div className="overflow-hidden">
                                    <motion.h1
                                        className="text-2xl font-semibold"
                                        initial={{
                                            clipPath: "inset(0 100% 0 0)",
                                            x: -16,
                                            opacity: 0,
                                            filter: "blur(10px)",
                                        }}
                                        animate={{
                                            clipPath: "inset(0 0% 0 0)",
                                            x: 0,
                                            opacity: 1,
                                            filter: "blur(0px)",
                                        }}
                                        transition={{
                                            duration: 0.55,
                                            ease: "easeOut",
                                            delay: 0.5,
                                        }}
                                    >
                                        Welcome to Trezu
                                    </motion.h1>
                                </div>
                                <div className="overflow-hidden">
                                    <motion.p
                                        className="text-sm text-muted-foreground font-medium"
                                        initial={{
                                            clipPath: "inset(0 100% 0 0)",
                                            x: -14,
                                            opacity: 0,
                                            filter: "blur(8px)",
                                        }}
                                        animate={{
                                            clipPath: "inset(0 0% 0 0)",
                                            x: 0,
                                            opacity: 1,
                                            filter: "blur(0px)",
                                        }}
                                        transition={{
                                            duration: 0.6,
                                            ease: "easeOut",
                                            delay: 0.62,
                                        }}
                                    >
                                        Use your wallet to sign in into your
                                        treasury.
                                    </motion.p>
                                </div>
                            </div>
                            <motion.div
                                className="flex flex-col w-full px-4 lg:px-16 px gap-3 items-center justify-center"
                                initial={{ opacity: 0, y: 16 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{
                                    duration: 0.4,
                                    ease: "easeOut",
                                    delay: 0.74,
                                }}
                            >
                                <Button
                                    size="default"
                                    className="w-full max-w-md"
                                    onClick={() => {
                                        if (authError) clearError();
                                        connect();
                                    }}
                                    disabled={
                                        isAuthenticating || isInitializing
                                    }
                                >
                                    {(isAuthenticating || isInitializing) && (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    )}
                                    {buttonText}
                                </Button>
                                <Button
                                    variant="link"
                                    className="font-medium text-sm text-foreground hover:text-foreground/80"
                                    onClick={() => {
                                        trackEvent("wallet_missing_click", {
                                            source: "welcome_page",
                                        });
                                        setIsWalletSuggestionOpen(true);
                                    }}
                                >
                                    I don&apos;t have a wallet
                                </Button>
                            </motion.div>
                        </div>
                    </motion.div>
                </div>
                <div className="hidden h-fit my-auto lg:flex w-3/5 pt-12 pb-7 pl-16 flex-col gap-9">
                    <div className="w-full pr-[72px]">
                        <GradientTitle />
                    </div>
                    <div className="perspective-distant">
                        <motion.div
                            className="relative w-full h-fit rounded-[16px] rounded-r-none overflow-hidden min-h-[360px]"
                            initial={{ opacity: 0, x: 48, scale: 0.97 }}
                            animate={{ opacity: 1, x: 0, scale: 1 }}
                            transition={{
                                duration: 0.75,
                                ease: [0.22, 1, 0.36, 1],
                                delay: 0.5,
                            }}
                            style={{ transformOrigin: "center bottom" }}
                        >
                            <motion.div
                                aria-hidden
                                className="absolute inset-0 rounded-l-[16px] bg-linear-to-br from-blue-200/50 via-blue-100/40 to-white/40"
                                initial={{ opacity: 1 }}
                                animate={{
                                    opacity:
                                        isWelcomeImageLoaded &&
                                        !isWelcomeImageFailed
                                            ? 0
                                            : [0.45, 0.75, 0.45],
                                }}
                                transition={{
                                    duration: 1.6,
                                    repeat:
                                        isWelcomeImageLoaded &&
                                        !isWelcomeImageFailed
                                            ? 0
                                            : Infinity,
                                    ease: "easeInOut",
                                }}
                            />
                            <Image
                                src="/welcome.svg"
                                loading="eager"
                                alt="welcome"
                                priority
                                width={1000}
                                height={500}
                                onLoad={() => setIsWelcomeImageLoaded(true)}
                                onError={() => setIsWelcomeImageFailed(true)}
                                className={`h-full rounded-l-[16px] w-auto min-w-[calc(100%+200px)] transition-opacity duration-500 ${
                                    isWelcomeImageLoaded &&
                                    !isWelcomeImageFailed
                                        ? "opacity-100"
                                        : "opacity-0"
                                }`}
                            />
                        </motion.div>
                    </div>
                </div>
            </div>
            <WalletSuggestionModal
                open={isWalletSuggestionOpen}
                onOpenChange={setIsWalletSuggestionOpen}
            />
        </div>
    );
}

export default function Page() {
    return (
        <QueryProvider>
            <NearInitializer />
            <AuthProvider>
                <Content />
            </AuthProvider>
        </QueryProvider>
    );
}
