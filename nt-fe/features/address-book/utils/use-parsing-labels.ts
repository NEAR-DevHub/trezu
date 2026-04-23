"use client";

import { useTranslations } from "next-intl";
import type { AddressBookParsingLabels } from "./parsing";

export function useAddressBookParsingLabels(): AddressBookParsingLabels {
    const t = useTranslations("addressBook.parsing");
    return {
        rowPrefix: (row, message) => t("rowPrefix", { row, message }),
        missingName: t("missingName"),
        missingAddress: t("missingAddress"),
        invalidAddressFormat: (address) =>
            t("invalidAddressFormat", { address }),
        unknownNetwork: (network, available) =>
            t("unknownNetwork", { network, available }),
        incompatibleNetwork: (address, network, compatible) =>
            t("incompatibleNetwork", { address, network, compatible }),
        noDataFound: t("noDataFound"),
        headerColumnsNotFound: t("headerColumnsNotFound"),
        failedToParseCsv: t("failedToParseCsv"),
    };
}
