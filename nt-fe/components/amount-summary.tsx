import Big from "@/lib/big";
import { InputBlock } from "./input-block";
import { Token } from "./token-input";
import { formatCurrency } from "@/lib/utils";
import { TokenDisplay } from "./token-display-with-network";

interface AmountSummaryProps {
    total: Big | string;
    totalUSD?: number;
    token: Token;
    title?: string;
    children?: React.ReactNode;
    /**
     * When false, renders without InputBlock wrapper
     * Default: true
     */
    useInputBlock?: boolean;
    /**
     * When true, shows network icon badge on token
     * Default: false
     */
    showNetworkIcon?: boolean;
}

export function AmountSummary({
    total,
    token,
    title = "You are sending a total of",
    totalUSD,
    children,
    useInputBlock = true,
    showNetworkIcon = false,
}: AmountSummaryProps) {
    const totalString =
        total instanceof Big ? total.toString() : total.toString();

    const content = (
        <div className="flex flex-col gap-2 p-2 text-xs text-muted-foreground text-center justify-center items-center">
            <p className="font-medium text-xs">{title}</p>
            <TokenDisplay
                symbol={token.symbol}
                icon={token.icon || ""}
                chainIcons={showNetworkIcon ? token.chainIcons : undefined}
                iconSize="xl"
            />
            <div className="flex flex-col gap-0.5 max-w-full">
                <p className="text-lg font-semibold text-foreground break-all">
                    {totalString}{" "}
                    <span className="text-muted-foreground font-medium text-xs">
                        {token.symbol}
                    </span>
                </p>
                {totalUSD && (
                    <p className="text-xxs text-muted-foreground break-all">
                        ≈{formatCurrency(totalUSD)}
                    </p>
                )}
            </div>
            <div>{children}</div>
        </div>
    );

    if (!useInputBlock) {
        return (
            <div className="w-full max-w-[280px] rounded-lg border bg-muted h-[180px] flex items-center justify-center">
                {content}
            </div>
        );
    }

    return (
        <InputBlock title="" invalid={false}>
            {content}
        </InputBlock>
    );
}
