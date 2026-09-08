import { describe, expect, it } from "bun:test";
import {
    isInsideDialog,
    isKeyboardOccluding,
    isTextEntryElement,
    shouldHideBottomNavForKeyboard,
} from "./mobile-keyboard";

describe("isTextEntryElement", () => {
    it("treats text inputs and textareas as text entry", () => {
        expect(isTextEntryElement({ tagName: "INPUT", type: "text" })).toBe(
            true,
        );
        expect(isTextEntryElement({ tagName: "INPUT", type: "number" })).toBe(
            true,
        );
        expect(isTextEntryElement({ tagName: "TEXTAREA" })).toBe(true);
    });

    it("ignores buttons, checkboxes, and non-elements", () => {
        expect(isTextEntryElement({ tagName: "INPUT", type: "button" })).toBe(
            false,
        );
        expect(isTextEntryElement({ tagName: "INPUT", type: "checkbox" })).toBe(
            false,
        );
        expect(isTextEntryElement({ tagName: "BUTTON" })).toBe(false);
        expect(isTextEntryElement(null)).toBe(false);
    });
});

describe("isKeyboardOccluding", () => {
    it("detects a typical mobile keyboard overlap", () => {
        expect(isKeyboardOccluding(800, 400)).toBe(true);
        expect(isKeyboardOccluding(800, 800)).toBe(false);
        expect(isKeyboardOccluding(800, 780)).toBe(false);
    });
});

describe("isInsideDialog", () => {
    it("is false for page fields and objects without closest", () => {
        expect(isInsideDialog(null)).toBe(false);
        expect(isInsideDialog({ tagName: "INPUT" })).toBe(false);
    });

    it("is true when the field is inside a dialog", () => {
        expect(
            isInsideDialog({
                closest: (selector: string) =>
                    selector.includes('[role="dialog"]')
                        ? { role: "dialog" }
                        : null,
            }),
        ).toBe(true);
        expect(
            isInsideDialog({
                closest: () => null,
            }),
        ).toBe(false);
    });
});

describe("shouldHideBottomNavForKeyboard", () => {
    it("hides for an on-page field or a squeezed viewport, not a dialog field", () => {
        expect(
            shouldHideBottomNavForKeyboard({
                pageTextEntryFocused: true,
                keyboardOccluding: false,
            }),
        ).toBe(true);
        expect(
            shouldHideBottomNavForKeyboard({
                pageTextEntryFocused: false,
                keyboardOccluding: true,
            }),
        ).toBe(true);
        expect(
            shouldHideBottomNavForKeyboard({
                pageTextEntryFocused: false,
                keyboardOccluding: false,
            }),
        ).toBe(false);
    });
});
