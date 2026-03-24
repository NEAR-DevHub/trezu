import Papa from "papaparse";

/**
 * Common Papa Parse configuration
 */
const PAPA_PARSE_CONFIG: Papa.ParseConfig = {
    delimiter: "", // auto-detect delimiter (tries comma, tab, pipe, semicolon, etc.)
    skipEmptyLines: "greedy", // Skip lines with only whitespace
    header: false, // We want arrays, not objects
    dynamicTyping: false, // Keep everything as strings for consistent parsing
};

/**
 * Check if Papa Parse result has critical errors
 */
function hasCriticalParseErrors(errors: Papa.ParseError[]): boolean {
    const criticalErrors = errors.filter(
        (err) => err.type === "FieldMismatch" || err.type === "Quotes",
    );
    return criticalErrors.length > 0;
}

/**
 * Parse CSV or paste data using Papa Parse
 */
export function parseCsv(raw: string): string[][] {
    if (!raw.trim()) return [];

    const result = Papa.parse<string[]>(raw, PAPA_PARSE_CONFIG);

    // Check for critical parsing errors
    if (result.errors && result.errors.length > 0) {
        console.warn("CSV parsing errors:", result.errors);
        if (hasCriticalParseErrors(result.errors)) {
            console.error("Critical CSV parsing errors:", result.errors);
            throw new Error(
                "Failed to parse CSV data. Please check formatting.",
            );
        }
    }

    return result.data.filter((row: any) => row && row.length > 0);
}
