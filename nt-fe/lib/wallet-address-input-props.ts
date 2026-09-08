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
 * field. Unlock first; if this is still the first focus on the input, ask
 * the caller to focus again after the attribute flips.
 */
export function walletAddressAutofillUnlock(isFirstFocus: boolean): {
    readOnly: false;
    refocus: boolean;
} {
    return { readOnly: false, refocus: isFirstFocus };
}

/** iOS skips Contact AutoFill on read-only fields; clear it before typing. */
export function useWalletAddressAutofillGuard(
    onFocus?: FocusEventHandler<HTMLInputElement>,
) {
    const [readOnly, setReadOnly] = useState(true);
    // pointerdown unlocks the attribute so the upcoming focus can land
    // editable. First-focus still refocuses — iOS may have already focused
    // the field while it was read-only (no keyboard).
    const pendingFirstFocusRef = useRef(true);

    const unlock = () => {
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
                pendingFirstFocusRef.current &&
                    document.activeElement === event.currentTarget,
            );
            pendingFirstFocusRef.current = false;
            unlock();
            if (refocus) {
                const el = event.currentTarget;
                requestAnimationFrame(() => el.focus());
            }
            onFocus?.(event);
        }) satisfies FocusEventHandler<HTMLInputElement>,
    };
}
