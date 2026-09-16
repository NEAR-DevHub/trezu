"use client";

import {
    LoaderCircleIcon,
    User02Icon,
    User03Icon,
} from "@hugeicons/core-free-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { PageCard } from "@/components/card";
import { Icon } from "@/components/icon";
import { Input } from "@/components/input";
import {
    disabledActionClasses,
    SectionIcon,
    SectionText,
} from "@/components/settings-section";
import { useProfile } from "@/hooks/use-treasury-queries";
import { updateProfile } from "@/lib/api";
import { resolveProfileImageUrl } from "@/lib/profile-image";
import { cn } from "@/lib/utils";

const MAX_AVATAR_FILE_BYTES = 2 * 1024 * 1024; // 2 MB

/** The 40px tile leading the avatar section: the photo, or a glyph on brand green. */
function AvatarTile({
    imageUrl,
    name,
}: {
    imageUrl: string | null;
    name: string;
}) {
    if (imageUrl) {
        return (
            // biome-ignore lint/performance/noImgElement: arbitrary remote hosts, which `next/image` cannot optimise
            <img
                src={imageUrl}
                alt={name}
                className="size-10 shrink-0 rounded-lg object-cover"
            />
        );
    }

    return (
        <SectionIcon
            icon={User02Icon}
            className="rounded-lg bg-green-700 text-white"
        />
    );
}

/**
 * Name and avatar, each in its own card. They share one profile record — the
 * backend always takes both — so a change to either sends the current value of
 * the other alongside it.
 */
export function ProfileSections({ accountId }: { accountId: string }) {
    const t = useTranslations("account");
    const { data: profile } = useProfile(accountId);
    const queryClient = useQueryClient();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [name, setName] = useState("");
    const [savedName, setSavedName] = useState("");
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
    const [savingName, setSavingName] = useState(false);
    const [uploadingImage, setUploadingImage] = useState(false);

    useEffect(() => {
        setName(profile?.name || "");
        setSavedName(profile?.name || "");
        setAvatarUrl(resolveProfileImageUrl(profile?.image) ?? null);
    }, [profile]);

    const persist = async (patch: {
        displayName?: string;
        avatarUrl?: string | null;
    }) => {
        const next = {
            displayName: patch.displayName ?? savedName,
            avatarUrl:
                patch.avatarUrl !== undefined ? patch.avatarUrl : avatarUrl,
        };
        try {
            await updateProfile(next);
            await queryClient.invalidateQueries({ queryKey: ["profile"] });
            setSavedName(next.displayName);
            setAvatarUrl(next.avatarUrl);
            toast.success(t("saveSuccess"));
            return true;
        } catch (error) {
            console.error("Failed to save profile:", error);
            toast.error(t("saveError"));
            return false;
        }
    };

    // `PUT /user/profile` replaces the whole row — `displayName` is required and
    // an omitted `avatarUrl` clears the avatar — so every save has to carry both
    // fields. Two writes must therefore never overlap: the second would ship the
    // render-time value of the field the first is still changing. One busy flag
    // for both cards keeps them in single file.
    const busy = savingName || uploadingImage;

    const trimmedName = name.trim();
    const canSaveName =
        trimmedName.length > 0 &&
        trimmedName.length <= 100 &&
        trimmedName !== savedName;

    const handleSaveName = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!canSaveName) return;
        setSavingName(true);
        if (await persist({ displayName: trimmedName })) {
            setName(trimmedName);
        }
        setSavingName(false);
    };

    const uploadImageToIpfs = async (file: File) => {
        setUploadingImage(true);
        try {
            const response = await fetch("https://ipfs.near.social/add", {
                method: "POST",
                headers: { Accept: "application/json" },
                body: file,
            });
            const result = await response.json();
            if (!result.cid) {
                toast.error(t("uploadError"));
                return;
            }
            await persist({
                avatarUrl: `https://ipfs.near.social/ipfs/${result.cid}`,
            });
        } catch (error) {
            console.error("Avatar upload error:", error);
            toast.error(t("uploadError"));
        } finally {
            setUploadingImage(false);
        }
    };

    const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        // Clearing the input lets the same file be picked again after an error.
        event.target.value = "";
        if (!file) return;

        if (!file.type.startsWith("image/")) {
            toast.error(t("invalidImage"));
            return;
        }
        if (file.size > MAX_AVATAR_FILE_BYTES) {
            toast.error(t("imageTooLarge"));
            return;
        }

        void uploadImageToIpfs(file);
    };

    const handleRemoveAvatar = async () => {
        setUploadingImage(true);
        await persist({ avatarUrl: null });
        setUploadingImage(false);
    };

    return (
        <>
            <PageCard className="flex-row gap-3 rounded-3xl">
                <SectionIcon
                    icon={User03Icon}
                    className="rounded-full bg-general-bg-primary text-green-500"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-4">
                    <SectionText
                        title={t("nameTitle")}
                        description={t("nameDescription")}
                    />
                    <form
                        onSubmit={handleSaveName}
                        className="flex items-center gap-2"
                    >
                        <Input
                            id="display-name"
                            className="min-w-0 flex-1"
                            clearable={false}
                            maxLength={100}
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            placeholder={accountId}
                            inputClassName="h-10 rounded-lg"
                            aria-label={t("nameTitle")}
                            // Typing through the round-trip would be thrown
                            // away: both the reseed below and the refetched
                            // profile overwrite whatever is in the field.
                            disabled={busy}
                        />
                        <Button
                            type="submit"
                            className={cn(
                                "h-10 px-4 text-sm leading-none",
                                disabledActionClasses,
                            )}
                            disabled={busy || !canSaveName}
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
                </div>
            </PageCard>

            <PageCard className="flex-row gap-3 rounded-3xl">
                <AvatarTile
                    imageUrl={avatarUrl}
                    name={savedName || accountId}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-4">
                    <SectionText
                        title={t("avatarTitle")}
                        description={t("avatarDescription")}
                    />
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                        onChange={handleImageChange}
                        className="hidden"
                    />
                    <div className="flex items-center gap-2">
                        <Button
                            type="button"
                            variant="neutral"
                            className="h-10 px-4 text-sm leading-none"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={busy}
                        >
                            {uploadingImage && (
                                <Icon
                                    icon={LoaderCircleIcon}
                                    className="animate-spin"
                                />
                            )}
                            {uploadingImage ? t("uploading") : t("edit")}
                        </Button>
                        {avatarUrl && (
                            <Button
                                type="button"
                                variant="neutral"
                                className="h-10 px-4 text-sm leading-none"
                                onClick={handleRemoveAvatar}
                                disabled={busy}
                            >
                                {t("remove")}
                            </Button>
                        )}
                    </div>
                </div>
            </PageCard>
        </>
    );
}
