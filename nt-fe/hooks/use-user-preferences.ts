"use client";

import { useSyncExternalStore } from "react";

export interface UserPreferences {
    timeFormat: "12" | "24";
    /** Follow the browser's zone instead of the pinned one below. */
    autoTimezone: boolean;
    /** IANA zone, only consulted while `autoTimezone` is off. */
    timezone: string | null;
}

const PREFERENCES_STORAGE_KEY = "treasury-timezone-preferences";
/** `storage` only fires in *other* tabs, so this tab tells itself. */
const PREFERENCES_CHANGE_EVENT = "treasury-preferences-change";

const DEFAULT_PREFERENCES: UserPreferences = {
    timeFormat: "12",
    autoTimezone: true,
    timezone: null,
};

function parse(stored: string | null): UserPreferences {
    if (!stored) return DEFAULT_PREFERENCES;
    try {
        const parsed: unknown = JSON.parse(stored);
        if (!parsed || typeof parsed !== "object") return DEFAULT_PREFERENCES;
        const { timeFormat, autoTimezone, timezone } =
            parsed as Partial<UserPreferences>;
        return {
            timeFormat: timeFormat === "24" ? "24" : "12",
            autoTimezone: autoTimezone !== false,
            timezone: typeof timezone === "string" ? timezone : null,
        };
    } catch {
        return DEFAULT_PREFERENCES;
    }
}

/**
 * `useSyncExternalStore` needs a stable snapshot, so the parsed value is cached
 * against the raw string it came from and only re-parsed when that changes.
 */
let cachedRaw: string | null = null;
let cachedValue: UserPreferences = DEFAULT_PREFERENCES;

function getSnapshot(): UserPreferences {
    const raw = localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (raw !== cachedRaw) {
        cachedRaw = raw;
        cachedValue = parse(raw);
    }
    return cachedValue;
}

function getServerSnapshot(): UserPreferences {
    return DEFAULT_PREFERENCES;
}

function subscribe(onChange: () => void) {
    window.addEventListener("storage", onChange);
    window.addEventListener(PREFERENCES_CHANGE_EVENT, onChange);
    return () => {
        window.removeEventListener("storage", onChange);
        window.removeEventListener(PREFERENCES_CHANGE_EVENT, onChange);
    };
}

/** The saved timezone and time-format preferences. */
export function useUserPreferences(): UserPreferences {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function saveUserPreferences(preferences: UserPreferences) {
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
    window.dispatchEvent(new Event(PREFERENCES_CHANGE_EVENT));
}

/** The zone dates should be rendered in: the pinned one, or the browser's. */
export function resolveTimezone(preferences: UserPreferences): string | null {
    if (preferences.autoTimezone) return null;
    return preferences.timezone;
}
