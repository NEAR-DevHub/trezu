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

/**
 * Hide the tab bar only after the keyboard has actually resized the
 * viewport. Hiding on focus unmounts the bar during the first tap, which
 * reflows the page and makes iOS drop the keyboard.
 */
export function shouldHideBottomNavForKeyboard(args: {
    textEntryFocused: boolean;
    keyboardOccluding: boolean;
}): boolean {
    void args.textEntryFocused;
    return args.keyboardOccluding;
}
