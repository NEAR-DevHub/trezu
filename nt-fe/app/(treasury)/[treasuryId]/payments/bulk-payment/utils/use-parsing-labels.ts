"use client";

import { useTranslations } from "next-intl";
import type { BulkParsingLabels } from "./parsing";
import { useIntentsFeeLabels } from "@/lib/intents-fee-labels";

export function useBulkParsingLabels(): BulkParsingLabels {
    const t = useTranslations("bulkPayment.parsing");
    const intentsFee = useIntentsFeeLabels();
    return {
        rowPrefix: (row, message) => t("rowPrefix", { row, message }),
        rowPrefixOnly: (row) => t("rowPrefix", { row, message: "" }),
        missingRecipientFirstColumn: t("missingRecipientFirstColumn"),
        invalidNearAddress: (address) => t("invalidNearAddress", { address }),
        invalidChainAddress: (address, chain) =>
            t("invalidChainAddress", { address, chain }),
        rowNeedsAmountRecipient: t("rowNeedsAmountRecipient"),
        missingRecipientBeforeComma: t("missingRecipientBeforeComma"),
        missingAmountAfterComma: (recipient) =>
            t("missingAmountAfterComma", { recipient }),
        invalidAmountNumber: (amountStr) =>
            t("invalidAmountNumber", { amountStr }),
        amountGreaterThanZero: (amountStr) =>
            t("amountGreaterThanZero", { amountStr }),
        amountTooLarge: (amountStr) => t("amountTooLarge", { amountStr }),
        invalidAmountFallback: t("invalidAmountFallback"),
        pleaseRemoveChars: (chars) => t("pleaseRemoveChars", { chars }),
        amountCannotBeEmpty: t("amountCannotBeEmpty"),
        tokenMismatch: (provided, expected, suggested) =>
            t("tokenMismatch", { provided, expected, suggested }),
        multipleTokenSymbols: (symbols) =>
            t("multipleTokenSymbols", { symbols }),
        noPaymentDataFound: t("noPaymentDataFound"),
        exceedsRecipientLimit: (count, limit, excess) =>
            t("exceedsRecipientLimit", { count, limit, excess }),
        noPaymentDataProvided: t("noPaymentDataProvided"),
        headerColumnsNotFound: t("headerColumnsNotFound"),
        failedToParseCsv: t("failedToParseCsv"),
        failedToParsePaste: t("failedToParsePaste"),
        failedToValidateAccount: t("failedToValidateAccount"),
        feeEstimationFailed: t("feeEstimationFailed"),
        feeEstimationFailedRow: (row, recipient) =>
            t("feeEstimationFailedRow", { row, recipient }),
        intentsFee,
    };
}
