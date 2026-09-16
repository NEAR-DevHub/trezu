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

/**
 * Until the account page was redesigned the zone was stored as the picker's
 * whole row, `{ utc, value, name }`, and `name` held the IANA zone. The key is
 * unchanged, so anyone who pinned a zone back then still has that object; read
 * it rather than dropping them back to "automatic".
 */
function readTimezone(timezone: unknown): string | null {
    if (typeof timezone === "string") return timezone || null;
    if (!timezone || typeof timezone !== "object") return null;
    const { name, value } = timezone as { name?: unknown; value?: unknown };
    if (typeof name === "string" && name) return name;
    if (typeof value === "string" && value) return value;
    return null;
}

export function parseUserPreferences(stored: string | null): UserPreferences {
    if (!stored) return DEFAULT_PREFERENCES;
    try {
        const parsed: unknown = JSON.parse(stored);
        if (!parsed || typeof parsed !== "object") return DEFAULT_PREFERENCES;
        const { timeFormat, autoTimezone, timezone } = parsed as Record<
            string,
            unknown
        >;
        return {
            timeFormat: timeFormat === "24" ? "24" : "12",
            autoTimezone: autoTimezone !== false,
            timezone: readTimezone(timezone),
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
        cachedValue = parseUserPreferences(raw);
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
