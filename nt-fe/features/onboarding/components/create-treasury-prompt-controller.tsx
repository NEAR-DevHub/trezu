"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTreasury } from "@/hooks/use-treasury";
import { useTreasuryCreationStatus } from "@/hooks/use-treasury-queries";
import { useNear } from "@/stores/near-store";
import { useOnboardingStore } from "@/stores/onboarding-store";
import { CreateTreasuryPromptModal } from "./create-treasury-prompt-modal";

const MODAL_SUPPRESSED_PATHS = new Set(["/app/new"]);

export function CreateTreasuryPromptController() {
    const router = useRouter();
    const pathname = usePathname();
    const [open, setOpen] = useState(false);
    const lastHandledOpenRequestIdRef = useRef(0);
    const prevIsAuthenticatingRef = useRef(false);
    const lastHandledLoginNonceRef = useRef(0);
    const [loginNonce, setLoginNonce] = useState(0);
    const { accountId, isInitializing, isAuthenticating } = useNear();
    const createTreasuryPromptOpenRequestId = useOnboardingStore(
        (state) => state.createTreasuryPromptOpenRequestId,
    );
    const { treasuries, isLoading } = useTreasury();
    const { data: creationStatus } = useTreasuryCreationStatus();

    const creationAvailable = creationStatus?.creationAvailable ?? true;
    const isOnboardingPath = pathname === "/";
    const isSuppressedPath = pathname
        ? MODAL_SUPPRESSED_PATHS.has(pathname)
        : false;
    const canOpenPrompt =
        !!accountId &&
        creationAvailable &&
        !isInitializing &&
        !isLoading &&
        treasuries.length === 0 &&
        !isSuppressedPath;

    useEffect(() => {
        if (!accountId) {
            lastHandledOpenRequestIdRef.current = 0;
            lastHandledLoginNonceRef.current = 0;
            setLoginNonce(0);
            setOpen(false);
        }
    }, [accountId]);

    useEffect(() => {
        const justCompletedLogin =
            prevIsAuthenticatingRef.current && !isAuthenticating && !!accountId;

        if (justCompletedLogin) {
            setLoginNonce((prev) => prev + 1);
        }

        prevIsAuthenticatingRef.current = isAuthenticating;
    }, [isAuthenticating, accountId]);

    useEffect(() => {
        if (!canOpenPrompt) {
            if (!isOnboardingPath) {
                setOpen(false);
            }
            return;
        }

        if (loginNonce > 0 && lastHandledLoginNonceRef.current !== loginNonce) {
            lastHandledLoginNonceRef.current = loginNonce;
            setOpen(true);
        }
    }, [canOpenPrompt, isOnboardingPath, loginNonce]);

    useEffect(() => {
        if (!canOpenPrompt) {
            if (!isOnboardingPath) {
                setOpen(false);
            }
            return;
        }

        if (
            createTreasuryPromptOpenRequestId >
            lastHandledOpenRequestIdRef.current
        ) {
            lastHandledOpenRequestIdRef.current =
                createTreasuryPromptOpenRequestId;
            setOpen(true);
        }
    }, [canOpenPrompt, isOnboardingPath, createTreasuryPromptOpenRequestId]);

    const handleOpenChange = (nextOpen: boolean) => setOpen(nextOpen);

    return (
        <CreateTreasuryPromptModal
            open={open}
            onOpenChange={handleOpenChange}
            onCreateTreasury={() => {
                handleOpenChange(false);
                router.push("/app/new");
            }}
        />
    );
}
