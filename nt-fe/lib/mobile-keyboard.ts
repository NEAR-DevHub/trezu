const NON_TEXT_INPUT_TYPES = new Set([
    "button",
    "checkbox",
    "color",
    "file",
    "hidden",
    "image",
    "radio",
    "range",
    "reset",
    "submit",
]);

/** Overlap that means a virtual keyboard, not a browser chrome tweak. */
export const KEYBOARD_OVERLAP_PX = 120;

export type TextEntryLike = {
    isContentEditable?: boolean;
    tagName?: string;
    type?: string;
    getAttribute?: (name: string) => string | null;
    closest?: (selectors: string) => unknown;
};

export function isTextEntryElement(
    el: EventTarget | TextEntryLike | null,
): boolean {
    if (!el || typeof el !== "object") return false;
    const node = el as TextEntryLike;
    if (node.isContentEditable) return true;

    const tag = node.tagName?.toUpperCase();
    if (tag === "TEXTAREA") return true;
    if (tag === "INPUT") {
        const type = (
            node.type ??
            node.getAttribute?.("type") ??
            "text"
        ).toLowerCase();
        return !NON_TEXT_INPUT_TYPES.has(type);
    }

    return (
        node.getAttribute?.("role") === "textbox" ||
        node.getAttribute?.("inputmode") != null
    );
}

export function isKeyboardOccluding(
    innerHeight: number,
    visualViewportHeight: number,
    visualViewportOffsetTop = 0,
    minOverlapPx = KEYBOARD_OVERLAP_PX,
): boolean {
    return (
        innerHeight - visualViewportHeight - visualViewportOffsetTop >
        minOverlapPx
    );
}

/** Recipient (and other) pickers are dialogs; hiding the tab bar there steals the first tap. */
export function isInsideDialog(
    el: EventTarget | TextEntryLike | null,
): boolean {
    if (!el || typeof el !== "object") return false;
    const node = el as TextEntryLike;
    if (typeof node.closest !== "function") return false;
    return !!node.closest('[role="dialog"], [data-slot="dialog-content"]');
}

/**
 * Hide for an on-page field (the Send amount) or once the keyboard has
 * resized the viewport. Skip dialog fields so the address picker can type.
 */
export function shouldHideBottomNavForKeyboard(args: {
    pageTextEntryFocused: boolean;
    keyboardOccluding: boolean;
}): boolean {
    return args.pageTextEntryFocused || args.keyboardOccluding;
}
