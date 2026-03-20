"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/button";
import { StepperHeader } from "@/components/step-wizard";
import { CsvUploadPanel } from "@/components/csv-upload-panel";
import { useChains } from "../chains";
import {
    parseAndValidateAddressBookCsv,
    parseAndValidateAddressBookPaste,
    type ParsedRecipient,
} from "../utils/parsing";

export type { ParsedRecipient };

const TEMPLATE_CSV = `Recipient Name,Recipient Address,Network,Note (optional)
alice,alice.near,Near,Payroll
bob,0x82bAFB7aC512C62160C218bf184A3823AF60e9aD,Ethereum;BNB,Payroll
charlie,F4k6615fhQZerPEGyhhfyfkZR7p8Fd1RK2jdegRcg2Qo,Solana,`;

const PASTE_PLACEHOLDER = `alice, alice.near, Near, Payroll
bob, 0x82bA..., Ethereum, Payroll
charlie, F4k6..., Solana,`;

interface ImportUploadStepProps {
    handleBack: () => void;
    onReview: (recipients: ParsedRecipient[]) => void;
}

export function ImportUploadStep({
    handleBack,
    onReview,
}: ImportUploadStepProps) {
    const { data: chains = [] } = useChains();

    const [csvData, setCsvData] = useState<string | null>(null);
    const [pasteData, setPasteData] = useState("");
    const [activeTab, setActiveTab] = useState<"upload" | "paste">("upload");
    const [uploadedFileName, setUploadedFileName] = useState<string | null>(
        null,
    );
    const [dataErrors, setDataErrors] = useState<Array<{
        row: number;
        message: string;
    }> | null>(null);

    // Eagerly parse data to show preview summary and errors
    const preview = useMemo(() => {
        const input =
            activeTab === "upload" ? csvData : pasteData.trim() || null;
        if (!input || chains.length === 0) return null;

        const result =
            activeTab === "upload"
                ? parseAndValidateAddressBookCsv(input, chains)
                : parseAndValidateAddressBookPaste(input, chains);

        if (result.errors.length > 0) {
            return { recipients: [], errors: result.errors };
        }

        const uniqueNetworks = new Set(
            result.recipients.flatMap((r) => r.networks),
        );
        return {
            recipients: result.recipients,
            errors: [] as Array<{ row: number; message: string }>,
            recipientCount: result.recipients.length,
            networkCount: uniqueNetworks.size,
        };
    }, [csvData, pasteData, activeTab, chains]);

    const hasData =
        (activeTab === "upload" && !!csvData) ||
        (activeTab === "paste" && !!pasteData.trim());
    const hasErrors = preview !== null && preview.errors.length > 0;
    const isValid =
        preview !== null && preview.recipients.length > 0 && !hasErrors;

    const handleContinue = () => {
        if (!isValid || !preview) return;
        onReview(preview.recipients);
    };

    return (
        <div className="flex flex-col gap-4">
            <StepperHeader
                title="Import Recipients"
                description="Upload a list of recipient addresses to quickly add multiple contacts to your address book."
                handleBack={handleBack}
            />

            <div className="flex flex-col gap-1">
                <CsvUploadPanel
                    csvData={csvData}
                    onCsvDataChange={setCsvData}
                    pasteData={pasteData}
                    onPasteDataChange={setPasteData}
                    activeTab={activeTab}
                    onActiveTabChange={setActiveTab}
                    uploadedFileName={uploadedFileName}
                    onUploadedFileNameChange={setUploadedFileName}
                    templateCsvContent={TEMPLATE_CSV}
                    templateFileName="address_book_import_template.csv"
                    pastePlaceholder={PASTE_PLACEHOLDER}
                    errors={hasErrors ? preview.errors : dataErrors}
                    onErrorsClear={() => setDataErrors(null)}
                />

                {isValid && preview && "recipientCount" in preview && (
                    <p className="text-sm text-muted-foreground">
                        Found {preview.recipientCount}{" "}
                        {preview.recipientCount === 1
                            ? "recipient"
                            : "recipients"}{" "}
                        on {preview.networkCount}{" "}
                        {preview.networkCount === 1 ? "network" : "networks"}
                    </p>
                )}
            </div>
            <Button
                className="w-full"
                disabled={!isValid}
                onClick={handleContinue}
            >
                {!hasData
                    ? "Upload or paste recipient data"
                    : hasErrors
                      ? "Fix errors to continue"
                      : "Continue to Review"}
            </Button>
        </div>
    );
}
