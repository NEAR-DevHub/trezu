"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
    Coins01Icon,
    LoaderCircleIcon,
    PaletteIcon,
} from "@hugeicons/core-free-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/button";
import { PageCard } from "@/components/card";
import { Icon } from "@/components/icon";
import { Input } from "@/components/input";
import { TreasuryLogo } from "@/components/treasury-info";
import { Form, FormControl, FormField, FormItem } from "@/components/ui/form";
import { useTreasury } from "@/hooks/use-treasury";
import { trackEvent } from "@/lib/analytics";
import { updateTreasurySettings } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useNear } from "@/stores/near-store";
import { disabledActionClasses } from "./button-styles";

const COLOR_OPTIONS = [
    "#000000", // black (appears as white in dark mode)
    "#6B7280", // gray
    "#EF4444", // red
    "#F97316", // orange
    "#F59E0B", // amber
    "#EAB308", // yellow
    "#84CC16", // lime
    "#22C55E", // green
    "#14B8A6", // teal
    "#06B6D4", // cyan
    "#0EA5E9", // sky
    "#0953FF", // blue
    "#6366F1", // indigo
    "#8B5CF6", // violet
    "#A855F7", // purple
    "#D946EF", // fuchsia
    "#EC4899", // pink
    "#F43F5E", // rose
];

type GeneralFormValues = {
    displayName: string;
    primaryColor: string;
    logo: string | null;
};

/** Tile + glyph that leads every settings section; callers own the surface. */
function SectionIcon({
    icon,
    className,
}: {
    icon: typeof Coins01Icon;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "flex size-10 shrink-0 items-center justify-center",
                className,
            )}
        >
            <Icon icon={icon} className="size-[18px]" />
        </div>
    );
}

function SectionText({
    title,
    description,
}: {
    title: string;
    description: string;
}) {
    return (
        <div className="flex flex-col gap-1">
            <h3 className="text-base font-semibold leading-[1.2]">{title}</h3>
            <p className="text-sm font-medium leading-[1.5] text-general-secondary-foreground">
                {description}
            </p>
        </div>
    );
}

export function GeneralTab() {
    const t = useTranslations("settings.general");
    const tAuth = useTranslations("auth");
    const generalSchema = useMemo(
        () =>
            z.object({
                displayName: z
                    .string()
                    .min(1, t("validation.displayNameRequired"))
                    .max(100, t("validation.displayNameMax")),
                primaryColor: z.string(),
                logo: z.string().nullable(),
            }),
        [t],
    );
    const { treasuryId, config, isGuestTreasury } = useTreasury();
    const { accountId } = useNear();
    const queryClient = useQueryClient();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [uploadingImage, setUploadingImage] = useState(false);
    const [savingName, setSavingName] = useState(false);
    const [savingColor, setSavingColor] = useState(false);

    // Any DAO member (not guest / Everyone-only). Backend enforces membership.
    const canEdit = Boolean(accountId && !isGuestTreasury);

    const form = useForm<GeneralFormValues>({
        resolver: zodResolver(generalSchema),
        defaultValues: {
            displayName: "",
            primaryColor: "",
            logo: null,
        },
    });

    // Update form when treasury data loads
    useEffect(() => {
        if (config) {
            form.reset({
                displayName: config?.name || "",
                primaryColor: config.metadata?.primaryColor || "",
                logo: config.metadata?.flagLogo || null,
            });
        }
    }, [config, form]);

    /**
     * Each section saves on its own, so a patch is merged over the current form
     * values — the backend always takes the full settings triple.
     */
    const persist = async (patch: Partial<GeneralFormValues>) => {
        if (!treasuryId || !config) {
            toast.error(t("treasuryNotFound"));
            return false;
        }
        if (!canEdit) {
            toast.error(tAuth("noPermission"));
            return false;
        }

        const values = { ...form.getValues(), ...patch };
        try {
            await updateTreasurySettings({
                treasuryId,
                displayName: values.displayName.trim(),
                flagLogo: values.logo?.trim() || null,
                primaryColor: values.primaryColor.trim() || null,
            });

            await Promise.all([
                queryClient.invalidateQueries({
                    queryKey: ["treasuryConfig", treasuryId],
                }),
                queryClient.invalidateQueries({ queryKey: ["userTreasuries"] }),
            ]);

            form.reset(values);
            toast.success(t("savedToast"));
            trackEvent("treasury-settings-updated", {
                treasury_id: treasuryId ?? "",
            });
            return true;
        } catch (error) {
            console.error("Error saving treasury settings:", error);
            toast.error(t("saveFailed"));
            return false;
        }
    };

    const handleSaveName = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!(await form.trigger("displayName"))) return;

        setSavingName(true);
        await persist({});
        setSavingName(false);
    };

    const handleSaveColor = async () => {
        setSavingColor(true);
        await persist({});
        setSavingColor(false);
    };

    const uploadImageToServer = async (file: File) => {
        setUploadingImage(true);

        try {
            const response = await fetch("https://ipfs.near.social/add", {
                method: "POST",
                headers: { Accept: "application/json" },
                body: file,
            });

            const result = await response.json();
            if (result.cid) {
                const imageUrl = `https://ipfs.near.social/ipfs/${result.cid}`;
                form.setValue("logo", imageUrl, { shouldDirty: true });
                await persist({ logo: imageUrl });
            } else {
                toast.error(t("uploadError"));
            }
        } catch (error) {
            console.error("Upload error:", error);
            toast.error(t("uploadError"));
        } finally {
            setUploadingImage(false);
        }
    };

    const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();

        reader.onload = () => {
            const img = new Image();
            img.src = reader.result as string;

            img.onload = () => {
                // Check dimensions
                if (img.width === 256 && img.height === 256) {
                    uploadImageToServer(file);
                } else {
                    toast.error(t("invalidLogo"));
                }
            };

            img.onerror = () => {
                toast.error(t("invalidImage"));
            };
        };

        reader.onerror = () => {
            console.error("Error reading file");
            toast.error(t("fileReadError"));
        };

        reader.readAsDataURL(file);

        // Reset the input value so the same file can be selected again
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    };

    const handleRemoveLogo = async () => {
        setUploadingImage(true);
        form.setValue("logo", null, { shouldDirty: true });
        await persist({ logo: null });
        setUploadingImage(false);
    };

    const logo = form.watch("logo");

    return (
        <Form {...form}>
            <div className="flex flex-col gap-5">
                <PageCard className="flex-row gap-3">
                    <SectionIcon
                        icon={Coins01Icon}
                        className="rounded-full bg-general-bg-primary text-green-500"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-4">
                        <SectionText
                            title={t("treasuryName")}
                            description={t("treasuryNameDescription")}
                        />
                        <form
                            onSubmit={handleSaveName}
                            className="flex items-center gap-2"
                        >
                            <FormField
                                control={form.control}
                                name="displayName"
                                render={({ field }) => (
                                    <FormItem className="min-w-0 flex-1">
                                        <FormControl>
                                            <Input
                                                id="display-name"
                                                clearable={false}
                                                {...field}
                                                placeholder={t(
                                                    "displayNamePlaceholder",
                                                )}
                                                inputClassName="h-10 rounded-lg"
                                                disabled={!canEdit}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <Button
                                type="submit"
                                className={cn(
                                    "h-10 px-4 text-sm leading-none",
                                    disabledActionClasses,
                                )}
                                disabled={
                                    savingName ||
                                    !form.formState.dirtyFields.displayName ||
                                    !canEdit
                                }
                            >
                                {savingName && (
                                    <Icon
                                        icon={LoaderCircleIcon}
                                        className="animate-spin"
                                    />
                                )}
                                {t("save")}
                            </Button>
                        </form>
                        {form.formState.errors.displayName && (
                            <p className="text-sm text-destructive">
                                {form.formState.errors.displayName.message}
                            </p>
                        )}
                    </div>
                </PageCard>

                <PageCard className="flex-row gap-3">
                    {/* The uploaded logo takes over the tile; the green coins
                        squircle is only the empty state. */}
                    <TreasuryLogo
                        logo={logo}
                        fallbackIcon={Coins01Icon}
                        imageClassName="size-10 shrink-0 rounded-lg object-cover"
                        fallbackClassName="size-10 shrink-0 rounded-lg bg-green-700"
                        fallbackIconClassName="size-[18px] text-white"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-4">
                        <SectionText
                            title={t("logo")}
                            description={t("logoDescription")}
                        />
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/png, image/jpeg, image/svg+xml"
                            onChange={handleImageChange}
                            className="hidden"
                            disabled={!canEdit}
                        />
                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="neutral"
                                className="h-10 px-4 text-sm leading-none"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={uploadingImage || !canEdit}
                            >
                                {uploadingImage && (
                                    <Icon
                                        icon={LoaderCircleIcon}
                                        className="animate-spin"
                                    />
                                )}
                                {uploadingImage ? t("uploading") : t("edit")}
                            </Button>
                            {logo && (
                                <Button
                                    type="button"
                                    variant="neutral"
                                    className="h-10 px-4 text-sm leading-none"
                                    onClick={handleRemoveLogo}
                                    disabled={uploadingImage || !canEdit}
                                >
                                    {t("removeLogo")}
                                </Button>
                            )}
                        </div>
                    </div>
                </PageCard>

                <PageCard className="flex-row gap-3">
                    <SectionIcon
                        icon={PaletteIcon}
                        className="rounded-full bg-general-bg-primary text-green-500"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-4">
                        <SectionText
                            title={t("primaryColor")}
                            description={t("primaryColorDescription")}
                        />
                        <FormField
                            control={form.control}
                            name="primaryColor"
                            render={({ field }) => {
                                // Unset color uses theme default (black / reverse in dark),
                                // same as the first swatch — show it as selected.
                                const selectedColor =
                                    field.value || COLOR_OPTIONS[0];

                                return (
                                    <FormItem>
                                        <div className="flex flex-wrap gap-[11px] py-1">
                                            {COLOR_OPTIONS.map((color) => (
                                                <button
                                                    key={color}
                                                    type="button"
                                                    onClick={() =>
                                                        form.setValue(
                                                            "primaryColor",
                                                            color,
                                                            {
                                                                shouldDirty: true,
                                                            },
                                                        )
                                                    }
                                                    disabled={!canEdit}
                                                    className={`size-7 cursor-pointer rounded-full transition-all hover:scale-110 disabled:cursor-not-allowed disabled:opacity-50 ${
                                                        selectedColor === color
                                                            ? "ring-2 ring-general-bg-primary ring-offset-2 ring-offset-card"
                                                            : ""
                                                    } ${color === "#000000" ? "bg-black dark:bg-white" : ""}`}
                                                    style={
                                                        color === "#000000"
                                                            ? {}
                                                            : {
                                                                  backgroundColor:
                                                                      color,
                                                              }
                                                    }
                                                    aria-label={t(
                                                        "selectColorLabel",
                                                        { color },
                                                    )}
                                                />
                                            ))}
                                        </div>
                                    </FormItem>
                                );
                            }}
                        />
                        <div className="flex items-center">
                            <Button
                                type="button"
                                className={cn(
                                    "h-10 px-4 text-sm leading-none",
                                    disabledActionClasses,
                                )}
                                onClick={handleSaveColor}
                                disabled={
                                    savingColor ||
                                    !form.formState.dirtyFields.primaryColor ||
                                    !canEdit
                                }
                            >
                                {savingColor && (
                                    <Icon
                                        icon={LoaderCircleIcon}
                                        className="animate-spin"
                                    />
                                )}
                                {t("save")}
                            </Button>
                        </div>
                    </div>
                </PageCard>

                {!canEdit && (
                    <p className="text-center text-sm text-muted-foreground">
                        {accountId ? tAuth("noPermission") : tAuth("noWallet")}
                    </p>
                )}
            </div>
        </Form>
    );
}
