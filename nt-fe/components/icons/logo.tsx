import { cn } from "@/lib/utils";
import { cva } from "class-variance-authority";
import Image from "next/image";

interface LogoProps {
    size?: "sm" | "md" | "lg";
    variant?: "full" | "icon";
    mode?: "auto" | "light" | "dark";
}

const sizeClasses = cva("w-auto", {
    variants: {
        size: {
            sm: "h-6",
            md: "h-8",
            lg: "h-10",
        },
    },
    defaultVariants: {
        size: "md",
    },
});

export default function Logo({
    size = "md",
    variant = "full",
    mode = "auto",
}: LogoProps) {
    const className = sizeClasses({ size });

    const darkSrc = variant === "icon" ? "/favicon_dark.svg" : "/logo_dark.svg";
    const lightSrc = variant === "icon" ? "/favicon_light.svg" : "/logo.svg";

    if (mode === "light") {
        return (
            <Image
                src={lightSrc}
                alt="Near Business"
                height={0}
                width={0}
                className={className}
            />
        );
    }

    if (mode === "dark") {
        return (
            <Image
                src={darkSrc}
                alt="Near Business"
                height={0}
                width={0}
                className={className}
            />
        );
    }

    return (
        <>
            <Image
                src={darkSrc}
                alt="Near Business"
                height={0}
                width={0}
                className={cn(className, "dark:block hidden")}
            />
            <Image
                src={lightSrc}
                alt="Near Business"
                height={0}
                width={0}
                className={cn(className, "dark:hidden")}
            />
        </>
    );
}
