import { describe, expect, it } from "bun:test";
import {
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

describe("shouldHideBottomNavForKeyboard", () => {
    it("waits for the viewport to squeeze so the first tap can raise the keyboard", () => {
        expect(
            shouldHideBottomNavForKeyboard({
                keyboardOccluding: false,
            }),
        ).toBe(false);
        expect(
            shouldHideBottomNavForKeyboard({
                keyboardOccluding: true,
            }),
        ).toBe(true);
    });
});
