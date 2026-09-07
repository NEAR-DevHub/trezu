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

type TextEntryLike = {
    isContentEditable?: boolean;
    tagName?: string;
    type?: string;
    getAttribute?: (name: string) => string | null;
};

export function isTextEntryElement(el: EventTarget | null): boolean {
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

/** Hide the phone tab bar while a field is focused or the viewport is squeezed. */
export function shouldHideBottomNavForKeyboard(args: {
    textEntryFocused: boolean;
    visualOverlapPx: number;
}): boolean {
    return args.textEntryFocused || args.visualOverlapPx > KEYBOARD_OVERLAP_PX;
}
