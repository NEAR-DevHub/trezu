import type { ReactNode } from "react";
import { NEAR_COM_ICON } from "@/constants/token";
import { formatFiatValue } from "@/lib/amount-format";
import {
    type MinDepositCopy,
    resolveMinDepositCopy,
} from "./deposit-min-deposit-copy";
import type { DepositReceiveCardProps } from "./deposit-receive-card";

/** Compatible with next-intl `useTranslations("depositModal")`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DepositTranslator = any;

export type ReceiveCardCopy = Pick<
    DepositReceiveCardProps,
    | "title"
    | "subtitle"
    | "addressLabel"
    | "notices"
    | "centerIcon"
    | "qrLabel"
    | "preferPlainAddress"
>;

const NEAR_COM_LABEL = "near.com";

function richForeground(chunks: ReactNode) {
    return <span className="text-foreground">{chunks}</span>;
}

/** The treasury's internal `nearcom:` address: any token, from Trezu / near.com users only. */
export function buildInternalReceiveCopy(
    t: DepositTranslator,
): ReceiveCardCopy {
    return {
        title: t("receive.sendAnyToken"),
        subtitle: t("receive.onNearcomNetwork"),
        addressLabel: t("receive.nearcomAddressLabel"),
        notices: [
            { id: "internal-only", content: t("receive.internalOnly") },
            { id: "internal-lost", content: t("receive.internalLost") },
        ],
        centerIcon: { icon: NEAR_COM_ICON, name: NEAR_COM_LABEL },
        qrLabel: t("receive.qrLabel", { network: NEAR_COM_LABEL }),
        preferPlainAddress: true,
    };
}

/**
 * A chain address for one asset on one network (reusable confidential or
 * public treasury). `anyToken` is the public "Other" asset: no symbol or
 * minimum to headline, just the network restriction.
 */
export function buildExternalReceiveCopy(
    t: DepositTranslator,
    params: {
        symbol: string;
        network: string;
        locale: string;
        minCopy: MinDepositCopy;
        centerIcon: ReceiveCardCopy["centerIcon"];
        anyToken?: boolean;
    },
): ReceiveCardCopy {
    const { symbol, network, locale, minCopy, centerIcon, anyToken } = params;
    const title = anyToken
        ? t("receive.sendAnyToken")
        : minCopy.kind === "usd"
          ? t("receive.sendAtLeastUsd", {
                usd: formatFiatValue(minCopy.usd, {
                    locale,
                    // Whole dollars stay bare ("$1"); real minimums keep cents.
                    fractionDigits: Number.isInteger(minCopy.usd) ? 0 : 2,
                }).display,
                symbol,
            })
          : minCopy.kind === "amount"
            ? t("receive.sendAtLeastAmount", {
                  amount: minCopy.amount,
                  symbol,
              })
            : t("receive.sendAsset", { symbol });
    const notice = anyToken
        ? t("otherNetworkInfo")
        : t.rich("onlySendAssetNetwork", {
              symbol,
              network,
              bold: richForeground,
          });
    return {
        title,
        subtitle: t("receive.onNetwork", { network }),
        addressLabel: t("receive.networkAddressLabel", { network }),
        notices: [{ id: "only-send", content: notice }],
        centerIcon,
        qrLabel: t("receive.qrLabel", { network }),
        preferPlainAddress: false,
    };
}

export { resolveMinDepositCopy };
