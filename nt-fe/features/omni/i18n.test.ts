import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * next-intl parses `<name>` inside a message as a rich-text tag and throws
 * INVALID_MESSAGE: UNCLOSED_TAG at render time when the tag is not closed
 * (this bit us with a literal `<voter-account>` placeholder). The production
 * build of use-intl used by bun test swallows that error, so the static
 * render tests cannot catch it; this test scans the source strings instead.
 */

const MESSAGES_DIR = join(import.meta.dir, "..", "..", "messages");

function walk(value: unknown, path: string, out: Array<[string, string]>) {
    if (typeof value === "string") {
        out.push([path, value]);
    } else if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
            walk(child, path ? `${path}.${key}` : key, out);
        }
    }
}

describe("omni i18n messages", () => {
    const locales = readdirSync(MESSAGES_DIR).filter((f) =>
        f.endsWith(".json"),
    );

    it("contain no rich-text tags or unbalanced ICU braces in any locale", () => {
        expect(locales.length).toBeGreaterThan(0);
        for (const file of locales) {
            const messages = JSON.parse(
                readFileSync(join(MESSAGES_DIR, file), "utf8"),
            );
            const entries: Array<[string, string]> = [];
            walk(messages.proposals?.omni, "proposals.omni", entries);
            expect(entries.length).toBeGreaterThan(50);
            for (const [path, text] of entries) {
                // An unquoted `<…>` would be parsed as a tag by next-intl.
                const unquoted = text.replace(/'[^']*'/g, "");
                expect(unquoted, `${file} ${path}: ${text}`).not.toMatch(
                    /<[^>]*>/,
                );
                let depth = 0;
                for (const ch of unquoted) {
                    if (ch === "{") depth += 1;
                    if (ch === "}") depth -= 1;
                    expect(
                        depth,
                        `${file} ${path}: ${text}`,
                    ).toBeGreaterThanOrEqual(0);
                }
                expect(depth, `${file} ${path}: ${text}`).toBe(0);
            }
        }
    });

    it("keeps the proposalKinds label for the omni kind in every locale", () => {
        for (const file of locales) {
            const messages = JSON.parse(
                readFileSync(join(MESSAGES_DIR, file), "utf8"),
            );
            expect(
                messages.proposalKinds?.["Omni Chain Signature"],
                file,
            ).toBeTruthy();
        }
    });
});
