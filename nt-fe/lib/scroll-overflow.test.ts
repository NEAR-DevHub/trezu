import { describe, expect, it } from "bun:test";
import { measureScrollOverflow, watchScrollOverflow } from "./scroll-overflow";

describe("measureScrollOverflow", () => {
    it("reports no overflow at the top of a short list", () => {
        expect(
            measureScrollOverflow({
                scrollTop: 0,
                scrollHeight: 200,
                clientHeight: 200,
            }),
        ).toEqual({ hasContentAbove: false, hasContentBelow: false });
    });

    it("ignores sub-pixel scroll at the top", () => {
        expect(
            measureScrollOverflow({
                scrollTop: 1,
                scrollHeight: 400,
                clientHeight: 200,
            }).hasContentAbove,
        ).toBe(false);
    });

    it("marks content above once the list has scrolled", () => {
        expect(
            measureScrollOverflow({
                scrollTop: 2,
                scrollHeight: 400,
                clientHeight: 200,
            }),
        ).toEqual({ hasContentAbove: true, hasContentBelow: true });
    });

    it("marks content below when more list remains", () => {
        expect(
            measureScrollOverflow({
                scrollTop: 0,
                scrollHeight: 400,
                clientHeight: 200,
            }),
        ).toEqual({ hasContentAbove: false, hasContentBelow: true });
    });
});

describe("watchScrollOverflow", () => {
    it("re-measures when children land in an empty viewport", () => {
        const mutationCallbacks: MutationCallback[] = [];
        const observed: MutationObserverInit[] = [];
        const originalMutationObserver = globalThis.MutationObserver;
        const originalResizeObserver = globalThis.ResizeObserver;

        class FakeMutationObserver {
            constructor(callback: MutationCallback) {
                mutationCallbacks.push(callback);
            }
            observe(_target: Node, options?: MutationObserverInit) {
                if (options) observed.push(options);
            }
            disconnect() {}
            takeRecords(): MutationRecord[] {
                return [];
            }
        }
        class FakeResizeObserver {
            observe() {}
            unobserve() {}
            disconnect() {}
        }

        globalThis.MutationObserver =
            FakeMutationObserver as typeof MutationObserver;
        globalThis.ResizeObserver = FakeResizeObserver as typeof ResizeObserver;

        try {
            const viewport = {
                firstElementChild: null,
                addEventListener() {},
                removeEventListener() {},
            } as unknown as HTMLElement;

            let calls = 0;
            const stop = watchScrollOverflow(viewport, () => {
                calls += 1;
            });

            expect(observed).toEqual([{ childList: true, subtree: true }]);
            expect(calls).toBe(1);
            mutationCallbacks[0]?.([], {} as MutationObserver);
            expect(calls).toBe(2);
            stop();
        } finally {
            globalThis.MutationObserver = originalMutationObserver;
            globalThis.ResizeObserver = originalResizeObserver;
        }
    });
});
