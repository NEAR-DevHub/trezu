"use client";

import {
    Delete01Icon,
    Edit03Icon,
    Wallet03Icon,
} from "@hugeicons/core-free-icons";
import { useRef } from "react";
import { useTranslations } from "next-intl";
import {
    type ArrayPath,
    type Control,
    type FieldValues,
    type Path,
    type PathValue,
    useFieldArray,
    useFormContext,
} from "react-hook-form";
import z from "zod";
import { Icon } from "@/components/icon";
import { selectorTriggerClassName } from "@/components/selector-field";
import { formatShortAddress } from "@/lib/format-short-address";
import {
    getCommittedMembers,
    isCompleteMember,
    isEmptyMember,
} from "@/lib/member-draft";
import { cn } from "@/lib/utils";
import { WALLET_ADDRESS_INPUT_PROPS } from "@/lib/wallet-address-input-props";
import { buildAccountIdSchema } from "./account-id-input";
import { Button } from "./button";
import { RoleBadge } from "./role-badge";
import { ROLES, RoleSelector } from "./role-selector";
import { FormField, FormMessage } from "./ui/form";

export function buildMemberSchema(messages: {
    rolesRequired: string;
    duplicateAddress: string;
    accountId: {
        minLength: string;
        maxLength: string;
        charset: string;
        doesNotExist: string;
    };
}) {
    return z
        .array(
            z.object({
                accountId: buildAccountIdSchema(messages.accountId),
                roles: z
                    .array(z.enum(ROLES.map((r) => r.id)))
                    .min(1, messages.rolesRequired),
            }),
        )
        .superRefine((data, ctx) => {
            const sortedData = data.sort((a, b) =>
                a.accountId.localeCompare(b.accountId),
            );
            for (const [index, member] of sortedData.entries()) {
                if (
                    index < sortedData.length - 1 &&
                    member.accountId === sortedData[index + 1]?.accountId
                ) {
                    ctx.addIssue({
                        code: "custom",
                        message: messages.duplicateAddress,
                        path: [index + 1, "accountId"],
                    });
                }
            }
        });
}

const _memberSchemaForTypes = buildMemberSchema({
    rolesRequired: "",
    duplicateAddress: "",
    accountId: {
        minLength: "",
        maxLength: "",
        charset: "",
        doesNotExist: "",
    },
});

export type MembersArray = z.infer<typeof _memberSchemaForTypes>;
export type Member = MembersArray[number];

type Role = {
    id: string;
    title: string;
    description?: string;
};

type MemberInputMode = "onboarding" | "add" | "edit";

interface MemberInputProps<
    TFieldValues extends FieldValues = FieldValues,
    TMemberPath extends Path<TFieldValues> = Path<TFieldValues>,
> {
    control: Control<TFieldValues>;
    mode?: MemberInputMode;
    availableRoles?: readonly Role[];
    name: TMemberPath extends ArrayPath<TFieldValues>
        ? PathValue<TFieldValues, TMemberPath> extends MembersArray
            ? TMemberPath
            : never
        : never;
    getDisabledRoles?: (
        accountId: string,
        currentRoles: string[],
    ) => { roleId: string; reason: string }[];
}

export function MemberInput<
    TFieldValues extends FieldValues = FieldValues,
    TMemberPath extends Path<TFieldValues> = Path<TFieldValues>,
>({
    control,
    mode = "add",
    availableRoles = ROLES,
    name,
    getDisabledRoles,
}: MemberInputProps<TFieldValues, TMemberPath>) {
    const t = useTranslations("memberInput");
    const tCommon = useTranslations("common");
    const { watch, trigger } = useFormContext<TFieldValues>();
    const { fields, append, remove, replace } = useFieldArray({
        control,
        name: name,
    });

    const members = (watch(name) ?? []) as MembersArray;
    const addressInputRef = useRef<HTMLInputElement>(null);
    const isEditMode = mode === "edit";
    const draftIndex = fields.length - 1;
    const committedMembers = isEditMode
        ? members
        : getCommittedMembers(members);
    const defaultRoles: string[] = [];

    const emptyMember = {
        accountId: "",
        roles: defaultRoles,
    } as TMemberPath extends ArrayPath<TFieldValues>
        ? PathValue<TFieldValues, TMemberPath> extends Member
            ? PathValue<TFieldValues, TMemberPath>[number]
            : never
        : never;

    const handleAddAnother = async () => {
        if (isEditMode || draftIndex < 0) return;
        const draft = members[draftIndex];
        if (!draft || isEmptyMember(draft)) {
            addressInputRef.current?.focus();
            return;
        }
        if (!isCompleteMember(draft)) {
            await trigger(name);
            return;
        }
        append(emptyMember);
    };

    const handleEditCommitted = (index: number) => {
        if (isEditMode) return;
        const draft = members[draftIndex];
        if (draft && !isEmptyMember(draft) && !isCompleteMember(draft)) {
            void trigger(name);
            return;
        }

        const selected = members[index];
        if (!selected) return;

        const next = members.filter((_, itemIndex) => itemIndex !== index);
        if (draft && isEmptyMember(draft)) {
            next[next.length - 1] = selected;
        } else {
            next.push(selected);
        }
        replace(next as (typeof emptyMember)[]);
        void trigger(name);
    };

    return (
        <div className="flex flex-col gap-6">
            {!isEditMode && draftIndex >= 0 && (
                <div className="flex flex-col gap-2">
                    <FormField
                        control={control}
                        name={
                            `${name}.${draftIndex}.accountId` as Path<TFieldValues>
                        }
                        render={({ field, fieldState }) => (
                            <div className="flex flex-col gap-1">
                                <label
                                    className={cn(
                                        selectorTriggerClassName,
                                        "cursor-text",
                                        fieldState.error &&
                                            "border-destructive bg-destructive/5",
                                    )}
                                >
                                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-general-border bg-muted">
                                        <Icon
                                            icon={Wallet03Icon}
                                            className="size-5 text-muted-foreground"
                                        />
                                    </span>
                                    <input
                                        {...WALLET_ADDRESS_INPUT_PROPS}
                                        ref={addressInputRef}
                                        value={field.value ?? ""}
                                        onChange={(event) => {
                                            const input = event.target.value
                                                .toLowerCase()
                                                .replace(/[^a-z0-9_.-]+/g, "")
                                                .slice(0, 64);
                                            field.onChange(input);
                                        }}
                                        onBlur={field.onBlur}
                                        placeholder={t("enterAddress")}
                                        aria-invalid={!!fieldState.error}
                                        className="min-w-0 flex-1 bg-transparent text-base font-medium text-foreground outline-none placeholder:text-muted-foreground"
                                    />
                                </label>
                                {fieldState.error ? (
                                    <FormMessage className="mt-1 text-sm text-destructive" />
                                ) : null}
                            </div>
                        )}
                    />
                    <FormField
                        control={control}
                        name={
                            `${name}.${draftIndex}.roles` as Path<TFieldValues>
                        }
                        render={({ field, fieldState }) => {
                            const accountId = members[draftIndex]?.accountId;
                            const disabledRoles =
                                getDisabledRoles && accountId
                                    ? getDisabledRoles(
                                          accountId,
                                          field.value || [],
                                      )
                                    : [];
                            return (
                                <div className="flex flex-col gap-1">
                                    <RoleSelector
                                        triggerVariant="field"
                                        selectedRoles={field.value || []}
                                        onRolesChange={field.onChange}
                                        availableRoles={availableRoles}
                                        disabledRoles={disabledRoles}
                                        invalid={!!fieldState.error}
                                    />
                                    {fieldState.error ? (
                                        <FormMessage className="mt-1 text-sm text-destructive" />
                                    ) : null}
                                </div>
                            );
                        }}
                    />
                </div>
            )}

            {committedMembers.length > 0 && (
                <div
                    className={cn(
                        "flex flex-col",
                        isEditMode ? "gap-6" : undefined,
                    )}
                >
                    {committedMembers.map((member, index) => {
                        const accountId = member.accountId;
                        const roles = member.roles ?? [];
                        return (
                            <div
                                key={
                                    isEditMode
                                        ? (fields[index]?.id ?? accountId)
                                        : `${accountId}-${index}`
                                }
                                className={cn(
                                    "flex flex-col gap-2",
                                    !isEditMode &&
                                        committedMembers.length > 1 &&
                                        index < committedMembers.length - 1 &&
                                        "py-2",
                                )}
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <p className="text-sm font-medium leading-[1.5] text-general-secondary-foreground">
                                        {t("memberNumber", {
                                            number: index + 1,
                                        })}
                                    </p>
                                    <div className="flex items-center gap-1">
                                        {!isEditMode && (
                                            <>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon-sm"
                                                    className="text-general-unofficial-ghost-foreground"
                                                    aria-label={tCommon("edit")}
                                                    onClick={() =>
                                                        handleEditCommitted(
                                                            index,
                                                        )
                                                    }
                                                >
                                                    <Icon icon={Edit03Icon} />
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon-sm"
                                                    className="text-general-unofficial-ghost-foreground"
                                                    aria-label={tCommon(
                                                        "remove",
                                                    )}
                                                    onClick={() =>
                                                        remove(index)
                                                    }
                                                >
                                                    <Icon icon={Delete01Icon} />
                                                </Button>
                                            </>
                                        )}
                                    </div>
                                </div>
                                {isEditMode ? (
                                    <div className="flex flex-col gap-3">
                                        <span className="min-w-0 overflow-hidden text-ellipsis text-sm font-medium leading-[1.5] text-general-secondary-foreground">
                                            {formatShortAddress(accountId)}
                                        </span>
                                        <FormField
                                            control={control}
                                            name={
                                                `${name}.${index}.roles` as Path<TFieldValues>
                                            }
                                            render={({ field, fieldState }) => {
                                                const disabledRoles =
                                                    getDisabledRoles &&
                                                    accountId
                                                        ? getDisabledRoles(
                                                              accountId,
                                                              field.value || [],
                                                          )
                                                        : [];
                                                return (
                                                    <div className="flex flex-col gap-1">
                                                        <RoleSelector
                                                            triggerVariant="field"
                                                            selectedRoles={
                                                                field.value ||
                                                                []
                                                            }
                                                            onRolesChange={
                                                                field.onChange
                                                            }
                                                            availableRoles={
                                                                availableRoles
                                                            }
                                                            disabledRoles={
                                                                disabledRoles
                                                            }
                                                            invalid={
                                                                !!fieldState.error
                                                            }
                                                        />
                                                        {fieldState.error ? (
                                                            <FormMessage className="mt-1 text-sm text-destructive" />
                                                        ) : null}
                                                    </div>
                                                );
                                            }}
                                        />
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="min-w-0 overflow-hidden text-ellipsis text-sm font-medium leading-[1.5] text-general-secondary-foreground">
                                            {formatShortAddress(accountId)}
                                        </span>
                                        <div className="flex flex-wrap justify-end gap-2">
                                            {roles.map((role) => (
                                                <RoleBadge
                                                    key={role}
                                                    role={role}
                                                    variant="pill"
                                                    showTooltip={false}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {!isEditMode && (
                <Button
                    variant="link"
                    type="button"
                    className="h-auto self-center p-0 text-muted-foreground"
                    onClick={() => {
                        void handleAddAnother();
                    }}
                >
                    {t("addNewMember")}
                </Button>
            )}
        </div>
    );
}
