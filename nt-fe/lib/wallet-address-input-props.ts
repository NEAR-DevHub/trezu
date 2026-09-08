import {
    useRef,
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

/**
 * iOS will not raise the keyboard if the first focus lands on a read-only
 * field. Unlock first; if focus already happened, ask the caller to focus
 * again after the attribute flips.
 */
export function walletAddressAutofillUnlock(wasReadOnly: boolean): {
    readOnly: false;
    refocus: boolean;
} {
    return { readOnly: false, refocus: wasReadOnly };
}

/** iOS skips Contact AutoFill on read-only fields; clear it before typing. */
export function useWalletAddressAutofillGuard(
    onFocus?: FocusEventHandler<HTMLInputElement>,
) {
    const readOnlyRef = useRef(true);
    const [readOnly, setReadOnly] = useState(true);

    const unlock = () => {
        readOnlyRef.current = false;
        setReadOnly(false);
    };

    return {
        ...WALLET_ADDRESS_INPUT_PROPS,
        readOnly,
        onPointerDown: (() => {
            unlock();
        }) satisfies PointerEventHandler<HTMLInputElement>,
        onFocus: ((event) => {
            const { refocus } = walletAddressAutofillUnlock(
                readOnlyRef.current,
            );
            unlock();
            if (refocus) {
                const el = event.currentTarget;
                requestAnimationFrame(() => el.focus());
            }
            onFocus?.(event);
        }) satisfies FocusEventHandler<HTMLInputElement>,
    };
}
