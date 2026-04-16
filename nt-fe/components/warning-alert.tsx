import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/alert";

interface WarningAlertProps {
    message: string | React.ReactNode;
    title?: string;
    className?: string;
}

export function WarningAlert({ title, message, className }: WarningAlertProps) {
    return (
        <Alert variant="warning" className={className}>
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <div className="flex flex-col">
                {title && <AlertTitle>{title}</AlertTitle>}
                <AlertDescription>{message}</AlertDescription>
            </div>
        </Alert>
    );
}
