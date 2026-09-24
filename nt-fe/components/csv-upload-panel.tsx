"use client";

import { Icon } from "@/components/icon";
import {
    Cancel01Icon,
    File01Icon,
    FileUpIcon,
    UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { useState, useEffect, useId } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/button";
import { Textarea } from "@/components/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

interface CsvUploadPanelProps {
    csvData: string | null;
    onCsvDataChange: (data: string | null) => void;
    pasteData: string;
    onPasteDataChange: (data: string) => void;
    activeTab: "upload" | "paste";
    onActiveTabChange: (tab: "upload" | "paste") => void;
    uploadedFileName: string | null;
    onUploadedFileNameChange: (name: string | null) => void;
    templateCsvContent: string;
    templateFileName: string;
    pastePlaceholder: string;
    errors: Array<{ row: number; message: string }> | null;
    onErrorsClear: () => void;
    disabled?: boolean;
    maxFileSizeMB?: number;
}

export function CsvUploadPanel({
    onCsvDataChange,
    pasteData,
    onPasteDataChange,
    activeTab,
    onActiveTabChange,
    uploadedFileName,
    onUploadedFileNameChange,
    templateCsvContent,
    templateFileName,
    pastePlaceholder,
    errors,
    onErrorsClear,
    disabled = false,
    maxFileSizeMB = 1.5,
}: CsvUploadPanelProps) {
    const t = useTranslations("csvUpload");
    const inputId = useId();
    const [isDragging, setIsDragging] = useState(false);
    const [uploadedFile, setUploadedFile] = useState<File | null>(null);
    const [fileError, setFileError] = useState<string | null>(null);

    // Restore uploaded file state when navigating back
    useEffect(() => {
        if (uploadedFileName && !uploadedFile) {
            const file = new File([""], uploadedFileName, { type: "text/csv" });
            setUploadedFile(file);
        }
    }, [uploadedFileName, uploadedFile]);

    const handleFileUpload = (file: File) => {
        if (file.type !== "text/csv" && !file.name.endsWith(".csv")) {
            setFileError(t("pleaseUploadCsv"));
            return;
        }

        if (file.size > maxFileSizeMB * 1024 * 1024) {
            setFileError(t("fileSizeLimit"));
            return;
        }

        setFileError(null);
        onErrorsClear();
        setUploadedFile(file);
        onUploadedFileNameChange(file.name);

        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target?.result as string;
            onCsvDataChange(text);
        };
        reader.readAsText(file);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);

        const file = e.dataTransfer.files[0];
        if (file) {
            handleFileUpload(file);
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = () => {
        setIsDragging(false);
    };

    const downloadTemplate = () => {
        const blob = new Blob([templateCsvContent], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = templateFileName;
        a.click();
        URL.revokeObjectURL(url);
    };

    const clearFile = () => {
        setUploadedFile(null);
        setFileError(null);
        onCsvDataChange(null);
        onUploadedFileNameChange(null);
        onErrorsClear();
    };

    const hasErrors =
        Boolean(errors && errors.length > 0) || Boolean(fileError);
    const errorList = fileError ? (
        <p className="wrap-anywhere text-sm text-destructive">{fileError}</p>
    ) : errors && errors.length > 0 ? (
        <div className="max-h-48 space-y-1 overflow-y-auto overflow-x-hidden">
            {errors.map((error) => (
                <p
                    key={`${error.row}-${error.message}`}
                    className="wrap-anywhere text-sm text-destructive"
                >
                    {error.message}
                </p>
            ))}
        </div>
    ) : null;

    return (
        <Tabs
            value={activeTab}
            onValueChange={(value) => {
                onActiveTabChange(value as "upload" | "paste");
                setFileError(null);
                onErrorsClear();
            }}
        >
            <TabsList className="h-12 w-full justify-stretch gap-1 rounded-2xl border border-general-border bg-transparent">
                <TabsTrigger
                    value="upload"
                    className="h-10 flex-1 cursor-pointer rounded-xl px-2 py-3 font-bold text-general-unofficial-ghost-foreground data-[state=active]:border-general-border data-[state=active]:bg-card dark:data-[state=active]:border-general-border dark:data-[state=active]:bg-card"
                >
                    <Icon icon={File01Icon} />
                    {t("uploadFile")}
                </TabsTrigger>
                <TabsTrigger
                    value="paste"
                    className="h-10 flex-1 cursor-pointer rounded-xl px-2 py-3 font-bold text-general-unofficial-ghost-foreground data-[state=active]:border-general-border data-[state=active]:bg-card dark:data-[state=active]:border-general-border dark:data-[state=active]:bg-card"
                >
                    <Icon icon={UserGroupIcon} />
                    {t("provideData")}
                </TabsTrigger>
            </TabsList>

            <TabsContent value="upload">
                <div className="flex flex-col gap-1">
                    {!uploadedFile ? (
                        <>
                            {/* biome-ignore lint/a11y/noStaticElementInteractions: Drag-and-drop supplements the accessible file button below. */}
                            <div
                                className={cn(
                                    "flex h-44 items-center justify-center rounded-3xl border border-general-border bg-card px-6 text-center transition-colors hover:bg-general-tertiary focus-within:bg-general-tertiary",
                                    isDragging && "border-primary bg-primary/5",
                                    hasErrors && "border-destructive",
                                )}
                                onDrop={handleDrop}
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                            >
                                <div className="flex flex-col items-center gap-2.5">
                                    <span className="flex size-10 items-center justify-center rounded-full border border-general-border bg-muted">
                                        <Icon
                                            icon={FileUpIcon}
                                            className="text-muted-foreground"
                                        />
                                    </span>
                                    <div className="flex flex-col gap-1">
                                        <p className="text-base leading-tight">
                                            <Button
                                                type="button"
                                                variant="link"
                                                className="h-auto p-0! font-semibold text-foreground hover:underline disabled:text-muted-foreground"
                                                onClick={() =>
                                                    document
                                                        .getElementById(inputId)
                                                        ?.click()
                                                }
                                                disabled={disabled}
                                            >
                                                {t("chooseFile")}
                                            </Button>{" "}
                                            <span className="font-medium text-muted-foreground">
                                                {t("orDragDrop")}
                                            </span>
                                        </p>
                                        <p className="text-sm leading-5 text-muted-foreground">
                                            {t("maxFileSize", {
                                                maxSize: maxFileSizeMB,
                                            })}
                                        </p>
                                    </div>
                                    <input
                                        id={inputId}
                                        type="file"
                                        accept=".csv"
                                        className="hidden"
                                        disabled={disabled}
                                        onChange={(event) => {
                                            const file =
                                                event.target.files?.[0];
                                            if (file) handleFileUpload(file);
                                            event.target.value = "";
                                        }}
                                    />
                                </div>
                            </div>

                            {errorList}

                            <div className="flex min-h-7 flex-wrap items-center gap-1 text-sm font-medium">
                                <span>{t("noFilePrompt")}</span>
                                <Button
                                    type="button"
                                    variant="link"
                                    onClick={downloadTemplate}
                                    className="h-7 px-2! py-0.5 text-xs font-bold text-general-unofficial-ghost-foreground hover:underline"
                                >
                                    {t("downloadTemplate")}
                                </Button>
                            </div>
                        </>
                    ) : (
                        <>
                            <div
                                className={cn(
                                    "flex h-18 items-center justify-between rounded-3xl border border-general-border bg-card px-4",
                                    hasErrors && "border-destructive",
                                )}
                            >
                                <div className="flex min-w-0 items-center gap-3">
                                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-general-border bg-muted">
                                        <Icon
                                            icon={File01Icon}
                                            className={cn(
                                                "text-primary",
                                                hasErrors && "text-destructive",
                                            )}
                                        />
                                    </span>
                                    <div className="min-w-0 text-left">
                                        <p className="truncate text-sm font-semibold">
                                            {uploadedFile.name}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {(uploadedFile.size / 1024).toFixed(
                                                0,
                                            )}
                                            KB
                                        </p>
                                    </div>
                                </div>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    onClick={clearFile}
                                    className={cn(
                                        "text-muted-foreground hover:text-foreground",
                                        hasErrors &&
                                            "text-destructive hover:text-destructive/80",
                                    )}
                                >
                                    <Icon icon={Cancel01Icon} />
                                    <span className="sr-only">
                                        {t("removeFile")}
                                    </span>
                                </Button>
                            </div>
                            {errorList}
                        </>
                    )}
                </div>
            </TabsContent>

            <TabsContent value="paste">
                <div className="flex flex-col gap-1">
                    <div
                        className={cn(
                            "rounded-3xl border border-general-border bg-card",
                            hasErrors && "border-destructive",
                        )}
                    >
                        <Textarea
                            value={pasteData}
                            onChange={(event) => {
                                onPasteDataChange(event.target.value);
                                if (hasErrors) {
                                    setFileError(null);
                                    onErrorsClear();
                                }
                            }}
                            borderless
                            placeholder={pastePlaceholder}
                            rows={8}
                            className="min-h-44 w-full max-w-full resize-none overflow-x-hidden rounded-3xl bg-transparent! p-4 font-mono text-base whitespace-pre-wrap shadow-none hover:bg-transparent! focus-within:bg-transparent! focus:outline-none disabled:opacity-100 md:text-sm"
                            disabled={disabled}
                        />
                    </div>
                    {errorList}
                </div>
            </TabsContent>
        </Tabs>
    );
}
