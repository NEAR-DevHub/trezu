/**
 * Pins the click contract for in-page nav links. No DOM harness in this
 * package, so the real handler runs against stubbed `document` / `window`
 * globals and a fake event that records whether the default was prevented.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { SectionLink } from "./section-link";

const section = { scrollIntoView: mock(), focus: mock() };
const replaceState = mock();

beforeEach(() => {
    Object.assign(globalThis, {
        document: {
            getElementById: (id: string) => (id === "pricing" ? section : null),
        },
        window: {
            matchMedia: () => ({ matches: false }),
            history: { replaceState },
        },
    });
});

afterEach(() => {
    Reflect.deleteProperty(globalThis, "document");
    Reflect.deleteProperty(globalThis, "window");
    section.scrollIntoView.mockClear();
    section.focus.mockClear();
    replaceState.mockClear();
});

type ClickInit = Partial<
    Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">
>;

function click(href: string, init: ClickInit = {}) {
    const event = {
        button: 0,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        ...init,
        defaultPrevented: false,
        preventDefault() {
            event.defaultPrevented = true;
        },
    };
    const link: React.ReactElement<React.ComponentProps<"a">> = SectionLink({
        href,
        children: "Pricing",
    });
    // The handler only reads the fields above; a full MouseEvent needs a DOM.
    link.props.onClick?.(
        event as unknown as React.MouseEvent<HTMLAnchorElement>,
    );
    return event;
}

describe("SectionLink", () => {
    it("smooth-scrolls to a section on the current page and focuses it", () => {
        const event = click("/#pricing");

        expect(event.defaultPrevented).toBe(true);
        expect(section.scrollIntoView).toHaveBeenCalledWith({
            behavior: "smooth",
        });
        expect(section.focus).toHaveBeenCalledWith({ preventScroll: true });
        expect(replaceState).toHaveBeenCalledWith(null, "", "#pricing");
    });

    it("lets the browser navigate when the section is not on this page", () => {
        const event = click("/#product");

        expect(event.defaultPrevented).toBe(false);
        expect(section.scrollIntoView).not.toHaveBeenCalled();
        expect(replaceState).not.toHaveBeenCalled();
    });

    it.each<ClickInit>([
        { metaKey: true },
        { ctrlKey: true },
        { shiftKey: true },
        { altKey: true },
        { button: 1 },
    ])("leaves %o clicks to the browser", (init) => {
        const event = click("/#pricing", init);

        expect(event.defaultPrevented).toBe(false);
        expect(section.scrollIntoView).not.toHaveBeenCalled();
        expect(replaceState).not.toHaveBeenCalled();
    });
});
