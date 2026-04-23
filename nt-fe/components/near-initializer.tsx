"use client";

import { useEffect } from "react";
import { useNearStore } from "@/stores/near-store";
import { useSyncNearStoreMessages } from "@/i18n/store-messages";

export function NearInitializer() {
    useSyncNearStoreMessages();
    useEffect(() => {
        useNearStore.getState().init();
    }, []);

    return null;
}
