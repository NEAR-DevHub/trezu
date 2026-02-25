"use client";

import { useState } from "react";
import { LogIn, LogOut, ChevronDown, Loader2, FileText } from "lucide-react";
import { Button } from "@/components/button";
import { useNear } from "@/stores/near-store";
import { User } from "./user";
import Link from "next/link";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Address } from "./address";
import { PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from "@/constants/config";

export function SignIn() {
    const {
        accountId: signedAccountId,
        isInitializing,
        isAuthenticated,
        connect,
        disconnect,
    } = useNear();
    const [isOpen, setIsOpen] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);

    const handleConnect = async () => {
        setIsConnecting(true);
        try {
            await connect();
        } finally {
            setIsConnecting(false);
        }
    };

    if (isInitializing) {
        return (
            <Button disabled className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading...
            </Button>
        );
    }

    // Show connect button if not connected or not authenticated
    if (!signedAccountId || !isAuthenticated) {
        return (
            <Button
                onClick={handleConnect}
                disabled={isConnecting}
                className="flex items-center gap-2"
            >
                {isConnecting ? (
                    <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Connecting...
                    </>
                ) : (
                    <>
                        <LogIn className="h-4 w-4" />
                        Connect <span className="hidden md:inline">Wallet</span>
                    </>
                )}
            </Button>
        );
    }

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                <button className="flex items-center gap-2 rounded-lg px-3 py-1.5 hover:bg-muted cursor-pointer">
                    <div className="hidden md:block">
                        <User
                            accountId={signedAccountId}
                            withLink={false}
                            size="md"
                        />
                    </div>
                    <div className="flex md:hidden">
                        <User
                            accountId={signedAccountId}
                            withLink={false}
                            size="sm"
                            iconOnly
                        />
                    </div>
                    <ChevronDown className="h-4 w-4 text-muted-foreground hidden sm:inline" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-48 p-1">
                <div className="px-3 py-2">
                    <Address address={signedAccountId} />
                </div>
                <Link
                    href={TERMS_OF_SERVICE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center rounded-6 gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors"
                    onClick={() => setIsOpen(false)}
                >
                    <FileText className="h-4 w-4" />
                    Terms of Service
                </Link>
                <Link
                    href={PRIVACY_POLICY_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center rounded-6 gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors"
                    onClick={() => setIsOpen(false)}
                >
                    <FileText className="h-4 w-4" />
                    Privacy Policy
                </Link>
                <div className="border-t border-border dark:border-general-border">
                    <button
                        className="flex items-center rounded-6 gap-2 px-3 py-2 text-sm w-full hover:bg-muted transition-colors"
                        onClick={() => {
                            disconnect();
                            setIsOpen(false);
                        }}
                    >
                        <LogOut className="h-4 w-4" />
                        Disconnect
                    </button>
                </div>
            </PopoverContent>
        </Popover>
    );
}
