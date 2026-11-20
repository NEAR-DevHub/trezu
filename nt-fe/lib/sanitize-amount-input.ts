const THOUSANDS_BEFORE_DOT = /^\D*\d{1,3}(,\d{3})+\./;

/**
 * Typed or pasted amount text. Keeps the first decimal point and drops any
 * later ones, so "0.5." stays "0.5" and "1.2.3" becomes "1.23".
 * A comma is a decimal separator ("1,5" becomes "1.5") unless it is grouping
 * digits in threes before a ".", in which case it is a thousands separator
 * ("1,234.56" becomes "1234.56"). Other characters are removed.
 */
export function sanitizeAmountInput(value: string): string {
    const normalized = THOUSANDS_BEFORE_DOT.test(value)
        ? value.replace(/,/g, "")
        : value.replace(/,/g, ".");
    const digitsAndDots = normalized.replace(/[^0-9.]/g, "");
    const firstDotIndex = digitsAndDots.indexOf(".");
    const singleDot =
        firstDotIndex === -1
            ? digitsAndDots
            : digitsAndDots.slice(0, firstDotIndex + 1) +
              digitsAndDots.slice(firstDotIndex + 1).replace(/\./g, "");
    return singleDot.replace(/^0+(?=\d)/, "");
}
