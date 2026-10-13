import { describe, expect, it } from "bun:test";
import { AutoRefreshCooldown } from "./use-confidential-history-auto-refresh";

describe("AutoRefreshCooldown", () => {
    it("allows the first trigger and blocks until the cooldown passes", () => {
        const cooldown = new AutoRefreshCooldown(60_000);

        expect(cooldown.tryAcquire("a.sputnik-dao.near", 0)).toBe(true);
        expect(cooldown.tryAcquire("a.sputnik-dao.near", 59_999)).toBe(false);
        expect(cooldown.tryAcquire("a.sputnik-dao.near", 60_000)).toBe(true);
    });

    it("tracks treasuries independently", () => {
        const cooldown = new AutoRefreshCooldown(60_000);

        expect(cooldown.tryAcquire("a.sputnik-dao.near", 0)).toBe(true);
        expect(cooldown.tryAcquire("b.sputnik-dao.near", 0)).toBe(true);
        expect(cooldown.tryAcquire("a.sputnik-dao.near", 1)).toBe(false);
    });
});
