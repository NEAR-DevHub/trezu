/**
 * Typed or pasted amount text. Keeps the first decimal point and drops any
 * later ones, so "0.5." stays "0.5" and "1.2.3" becomes "1.23".
 * Characters other than digits and "." are removed, which is how this field
 * already treated commas.
 */
export function sanitizeAmountInput(value: string): string {
    const digitsAndDots = value.replace(/[^0-9.]/g, "");
    const firstDotIndex = digitsAndDots.indexOf(".");
    const singleDot =
        firstDotIndex === -1
            ? digitsAndDots
            : digitsAndDots.slice(0, firstDotIndex + 1) +
              digitsAndDots.slice(firstDotIndex + 1).replace(/\./g, "");
    return singleDot.replace(/^0+(?=\d)/, "");
}
