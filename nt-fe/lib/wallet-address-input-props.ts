import {
    useRef,
    type FocusEventHandler,
    type InputHTMLAttributes,
    type PointerEventHandler,
} from "react";

/**
 * Stop iOS/Safari Contact AutoFill from treating a wallet field as a
 * postal "Home Address". `autocomplete="off"` is not enough when the
 * visible label or placeholder contains the word "address".
 */
export const WALLET_ADDRESS_INPUT_PROPS = {
    autoComplete: "off",
    autoCorrect: "off",
    autoCapitalize: "none",
    spellCheck: false,
    inputMode: "text",
    name: "wallet-recipient",
    enterKeyHint: "done",
} satisfies InputHTMLAttributes<HTMLInputElement>;

/** iOS will not raise the keyboard for dialog auto-focus. */
export function shouldPreventMobileDialogAutoFocus(
    viewportWidth: number,
): boolean {
    return viewportWidth < 1024;
}

/** iOS skips Contact AutoFill on read-only fields; unlock on the same tap. */
export function useWalletAddressAutofillGuard(
    onFocus?: FocusEventHandler<HTMLInputElement>,
) {
    const unlockedRef = useRef(false);

    const unlock = (el: HTMLInputElement) => {
        unlockedRef.current = true;
        el.readOnly = false;
    };

    return {
        ...WALLET_ADDRESS_INPUT_PROPS,
        // Ref, not state: a parent re-render must not put readOnly back.
        readOnly: !unlockedRef.current,
        onPointerDown: ((event) => {
            unlock(event.currentTarget);
        }) satisfies PointerEventHandler<HTMLInputElement>,
        onFocus: ((event) => {
            unlock(event.currentTarget);
            onFocus?.(event);
        }) satisfies FocusEventHandler<HTMLInputElement>,
    };
}
