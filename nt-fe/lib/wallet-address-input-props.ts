import {
    useState,
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
    const [readOnly, setReadOnly] = useState(true);

    const unlock = (el: HTMLInputElement) => {
        el.readOnly = false;
        setReadOnly(false);
    };

    return {
        ...WALLET_ADDRESS_INPUT_PROPS,
        readOnly,
        onPointerDown: ((event) => {
            unlock(event.currentTarget);
        }) satisfies PointerEventHandler<HTMLInputElement>,
        onFocus: ((event) => {
            unlock(event.currentTarget);
            onFocus?.(event);
        }) satisfies FocusEventHandler<HTMLInputElement>,
    };
}
