import { AlertTriangle } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/alert";

interface WarningAlertProps {
    title?: string;
    message: string | React.ReactNode;
    className?: string;
}

export function WarningAlert({ title, message, className }: WarningAlertProps) {
    return (
        <Alert variant="warning" className={className}>
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {title && <AlertTitle>{title}</AlertTitle>}
            <AlertDescription>{message}</AlertDescription>
        </Alert>
    );
}
