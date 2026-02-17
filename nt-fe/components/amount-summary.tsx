import Big from "@/lib/big";
import { InputBlock } from "./input-block";
import { Token } from "./token-input";
import { formatCurrency, cn } from "@/lib/utils";
import { useThemeStore } from "@/stores/theme-store";

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
    const { theme } = useThemeStore();

    // Get network icon based on theme
    const networkIcon = showNetworkIcon && token.chainIcons
        ? (theme === 'light' ? token.chainIcons.light : token.chainIcons.dark)
        : null;

    const totalString = total instanceof Big ? total.toString() : total.toString();

    const content = (
        <div className="flex flex-col gap-2 p-2 text-xs text-muted-foreground text-center justify-center items-center">
            <p className="font-medium text-xs">{title}</p>
            <div className="relative flex">
                <img
                    src={token.icon}
                    alt={token.symbol}
                    className="size-9 shrink-0 rounded-full"
                />
                {networkIcon && (
                    <div className="absolute -right-1 -bottom-1 flex items-center justify-center rounded-full bg-muted border border-border">
                        <img
                            src={networkIcon}
                            alt="network"
                            className="size-4 shrink-0 p-0.5"
                        />
                    </div>
                )}
            </div>
            <div className="flex flex-col gap-0.5">
                <p className="text-lg font-semibold text-foreground">
                    {totalString}{" "}
                    <span className="text-muted-foreground font-medium text-xs">
                        {token.symbol}
                    </span>
                </p>
                {totalUSD && (
                    <p className="text-xxs text-muted-foreground">
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
