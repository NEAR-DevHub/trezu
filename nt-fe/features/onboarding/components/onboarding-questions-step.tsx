"use client";

import posthog from "posthog-js";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { useTranslations } from "next-intl";
import z from "zod";
import { type StepProps } from "@/components/step-wizard";
import { useChains } from "@/features/address-book/chains";
import { OnboardingQuestionnaireCard } from "./onboarding-questionnaire-card";

const questionnaireAnswerSchema = z.object({
    selected: z.array(z.string()),
    other: z.string().max(280).optional(),
});

export const ONBOARDING_ABOUT_SCHEMA = z.object({
    role: questionnaireAnswerSchema,
    useCases: questionnaireAnswerSchema,
    teamSize: questionnaireAnswerSchema,
    networks: questionnaireAnswerSchema,
    multisigExperience: questionnaireAnswerSchema,
    currentTools: questionnaireAnswerSchema,
    monthlyVolume: questionnaireAnswerSchema,
    biggestChallenges: questionnaireAnswerSchema,
    discoverySources: questionnaireAnswerSchema,
});

export type OnboardingAboutValues = z.infer<typeof ONBOARDING_ABOUT_SCHEMA>;

export const ONBOARDING_ABOUT_DEFAULT_VALUES: OnboardingAboutValues = {
    role: { selected: [], other: "" },
    teamSize: { selected: [], other: "" },
    networks: { selected: [], other: "" },
    useCases: { selected: [], other: "" },
    multisigExperience: { selected: [], other: "" },
    currentTools: { selected: [], other: "" },
    monthlyVolume: { selected: [], other: "" },
    biggestChallenges: { selected: [], other: "" },
    discoverySources: { selected: [], other: "" },
};

interface QuestionnaireOption {
    id: string;
    label: string;
    iconSrc?: string;
    iconDark?: string;
    iconLight?: string;
    iconImageClassName?: string;
}

type QuestionnaireBaseFieldName =
    | "about.role"
    | "about.teamSize"
    | "about.networks"
    | "about.useCases"
    | "about.multisigExperience"
    | "about.currentTools"
    | "about.monthlyVolume"
    | "about.biggestChallenges"
    | "about.discoverySources";

type QuestionnaireFieldName =
    | `${QuestionnaireBaseFieldName}.selected`
    | `${QuestionnaireBaseFieldName}.other`;

type QuestionnaireSelectionMode = "single" | "multiple";

interface QuestionnaireStep {
    title: string;
    question: string;
    fieldName: QuestionnaireBaseFieldName;
    options: QuestionnaireOption[];
    selectionMode: QuestionnaireSelectionMode;
    placeholder?: string;
}

const ROLE_OPTION_IDS = [
    "founder",
    "co-founder",
    "cfo-finance-lead",
    "operations-manager",
    "treasury-manager",
    "other",
] as const;

const USE_CASE_OPTION_IDS = [
    "team-payroll-grants",
    "company-assets-management",
    "dao-treasury-management",
    "investment-portfolio",
    "operational-spending",
    "other",
] as const;

const TEAM_SIZE_OPTION_IDS = [
    "just-me",
    "2-5-people",
    "6-15-people",
    "15-plus-people",
] as const;

const NETWORK_OPTION_IDS = [
    "near",
    "bitcoin",
    "ethereum",
    "solana",
    "arbitrum",
    "base",
    "optimism",
    "polygon",
    "gnosis",
    "avalanche",
    "bnb-chain",
    "other",
] as const;

const MULTISIG_EXPERIENCE_OPTION_IDS = [
    "never-heard-of-it",
    "heard-about-it",
    "never-used-it",
    "used-gnosis-safe-or-similar",
    "experienced",
    "looking-for-a-better-option",
] as const;

const CURRENT_TOOLS_WITH_ICONS: Record<string, string> = {
    "gnosis-safe": "/icons/gnosis-safe.svg",
    fireblocks: "/icons/fireblocks.svg",
    tholos: "/icons/tholos.svg",
    "squads-multisig": "/icons/squads-multisig.svg",
    "mpc-vault": "/icons/mpc-vault.svg",
};

const CURRENT_TOOLS_OPTION_IDS = [
    "gnosis-safe",
    "fireblocks",
    "tholos",
    "squads-multisig",
    "mpc-vault",
    "other",
] as const;

const MONTHLY_VOLUME_OPTION_IDS = [
    "under-10k",
    "10k-100k",
    "100k-1m",
    "1m-plus",
] as const;

const BIGGEST_CHALLENGE_OPTION_IDS = [
    "slow-approvals-and-signing",
    "lack-of-transparency-in-the-team",
    "hard-to-track-spending-and-balances",
    "security-and-access-control",
    "no-good-web3-tool-yet",
    "looking-for-crypto-earnings",
    "other",
] as const;

const MULTISIG_BEGINNER_EXPERIENCE_OPTIONS = new Set([
    "never-heard-of-it",
    "heard-about-it",
    "never-used-it",
]);

const NETWORK_OPTION_CHAIN_KEY: Record<string, string> = {
    near: "near",
    bitcoin: "bitcoin",
    ethereum: "eth",
    solana: "solana",
    arbitrum: "arbitrum",
    base: "base",
    optimism: "optimism",
    polygon: "polygon",
    gnosis: "gnosis",
    avalanche: "avalanche",
    "bnb-chain": "bsc",
};

const POSTHOG_SURVEY_ID = process.env.NEXT_PUBLIC_POSTHOG_ONBOARDING_SURVEY_ID;

const POSTHOG_SURVEY_QUESTION_IDS: Record<string, string> = {
    "about.role":
        process.env.NEXT_PUBLIC_POSTHOG_ONBOARDING_SURVEY_QUESTION_ROLE_ID ??
        "",
    "about.useCases":
        process.env
            .NEXT_PUBLIC_POSTHOG_ONBOARDING_SURVEY_QUESTION_USE_CASES_ID ?? "",
    "about.teamSize":
        process.env
            .NEXT_PUBLIC_POSTHOG_ONBOARDING_SURVEY_QUESTION_TEAM_SIZE_ID ?? "",
    "about.networks":
        process.env
            .NEXT_PUBLIC_POSTHOG_ONBOARDING_SURVEY_QUESTION_NETWORKS_ID ?? "",
    "about.multisigExperience":
        process.env
            .NEXT_PUBLIC_POSTHOG_ONBOARDING_SURVEY_QUESTION_MULTISIG_EXPERIENCE_ID ??
        "",
    "about.currentTools":
        process.env
            .NEXT_PUBLIC_POSTHOG_ONBOARDING_SURVEY_QUESTION_CURRENT_TOOLS_ID ??
        "",
    "about.monthlyVolume":
        process.env
            .NEXT_PUBLIC_POSTHOG_ONBOARDING_SURVEY_QUESTION_MONTHLY_VOLUME_ID ??
        "",
    "about.biggestChallenges":
        process.env
            .NEXT_PUBLIC_POSTHOG_ONBOARDING_SURVEY_QUESTION_BIGGEST_CHALLENGES_ID ??
        "",
};

const QUESTIONNAIRE_FIELD_ORDER: QuestionnaireBaseFieldName[] = [
    "about.role",
    "about.useCases",
    "about.teamSize",
    "about.networks",
    "about.multisigExperience",
    "about.currentTools",
    "about.monthlyVolume",
    "about.biggestChallenges",
];

export const ONBOARDING_QUESTIONNAIRE_STEP_COUNT =
    QUESTIONNAIRE_FIELD_ORDER.length;

function getVisibleQuestionnaireSteps(
    steps: QuestionnaireStep[],
    selectedExperience?: string,
) {
    // Hide the "current tools" step for beginner users with little/no multisig exposure.
    const skipToolsQuestion =
        !!selectedExperience &&
        MULTISIG_BEGINNER_EXPERIENCE_OPTIONS.has(selectedExperience);

    if (!skipToolsQuestion) {
        return steps;
    }

    return steps.filter((step) => step.fieldName !== "about.currentTools");
}

function formatSurveyResponse(
    answer: { selected: string[]; other?: string },
    options: QuestionnaireOption[],
    selectionMode: QuestionnaireSelectionMode,
    otherLabel: string,
): string | string[] {
    const optionLabelById = new Map(
        options.map((option) => [option.id, option.label]),
    );
    const values = answer.selected.map((id) => {
        if (id === "other") {
            return answer.other?.trim() || otherLabel;
        }
        return optionLabelById.get(id) ?? id;
    });
    return selectionMode === "single" ? (values[0] ?? "") : values;
}

function buildCumulativeSurveyResponses(
    about: OnboardingAboutValues,
    steps: QuestionnaireStep[],
    otherLabel: string,
): Record<string, string | string[]> {
    const responses: Record<string, string | string[]> = {};
    for (const step of steps) {
        const fieldKey = step.fieldName.replace(
            "about.",
            "",
        ) as keyof OnboardingAboutValues;
        const answer = about[fieldKey];
        if (answer.selected.length === 0) continue;
        const questionId = POSTHOG_SURVEY_QUESTION_IDS[step.fieldName];
        if (!questionId) continue;
        responses[`$survey_response_${questionId}`] = formatSurveyResponse(
            answer,
            step.options,
            step.selectionMode,
            otherLabel,
        );
    }
    return responses;
}

export function OnboardingQuestionsStep({
    handleNext,
    startFromLastQuestion = false,
}: StepProps & { startFromLastQuestion?: boolean }) {
    const t = useTranslations("onboardingQuestions");
    const form = useFormContext<{ about: OnboardingAboutValues }>();
    const { data: chains = [] } = useChains();
    const [activeQuestionField, setActiveQuestionField] =
        useState<QuestionnaireBaseFieldName>(QUESTIONNAIRE_FIELD_ORDER[0]);
    const hasInitializedQuestionRef = useRef(false);
    const surveySubmissionIdRef = useRef(crypto.randomUUID());
    const surveyShownFiredRef = useRef(false);
    const selectedExperience = useWatch({
        control: form.control,
        name: "about.multisigExperience.selected",
    })?.[0];
    const currentToolsValue = useWatch({
        control: form.control,
        name: "about.currentTools",
    });

    const buildOptions = useMemo(
        () =>
            (
                namespace:
                    | "role"
                    | "useCases"
                    | "teamSize"
                    | "networks"
                    | "multisigExperience"
                    | "currentTools"
                    | "monthlyVolume"
                    | "biggestChallenges",
                ids: readonly string[],
            ): QuestionnaireOption[] =>
                ids.map((id) => {
                    const base: QuestionnaireOption = {
                        id,
                        label: t(`options.${namespace}.${id}`),
                    };
                    if (namespace === "currentTools") {
                        const icon = CURRENT_TOOLS_WITH_ICONS[id];
                        if (icon) base.iconSrc = icon;
                    }
                    return base;
                }),
        [t],
    );

    const questionnaireSteps: QuestionnaireStep[] = useMemo(
        () => [
            {
                title: t("stepTitle"),
                question: t("questions.role"),
                fieldName: "about.role",
                placeholder: t("placeholders.describeRole"),
                options: buildOptions("role", ROLE_OPTION_IDS),
                selectionMode: "single",
            },
            {
                title: "",
                question: t("questions.useCases"),
                fieldName: "about.useCases",
                placeholder: t("placeholders.describeUseCase"),
                options: buildOptions("useCases", USE_CASE_OPTION_IDS),
                selectionMode: "multiple",
            },
            {
                title: "",
                question: t("questions.teamSize"),
                fieldName: "about.teamSize",
                options: buildOptions("teamSize", TEAM_SIZE_OPTION_IDS),
                selectionMode: "single",
            },
            {
                title: "",
                question: t("questions.networks"),
                fieldName: "about.networks",
                placeholder: t("placeholders.networkName"),
                options: buildOptions("networks", NETWORK_OPTION_IDS),
                selectionMode: "multiple",
            },
            {
                title: "",
                question: t("questions.multisigExperience"),
                fieldName: "about.multisigExperience",
                options: buildOptions(
                    "multisigExperience",
                    MULTISIG_EXPERIENCE_OPTION_IDS,
                ),
                selectionMode: "single",
            },
            {
                title: "",
                question: t("questions.currentTools"),
                fieldName: "about.currentTools",
                options: buildOptions("currentTools", CURRENT_TOOLS_OPTION_IDS),
                selectionMode: "multiple",
            },
            {
                title: "",
                question: t("questions.monthlyVolume"),
                fieldName: "about.monthlyVolume",
                options: buildOptions(
                    "monthlyVolume",
                    MONTHLY_VOLUME_OPTION_IDS,
                ),
                selectionMode: "single",
            },
            {
                title: "",
                question: t("questions.biggestChallenges"),
                fieldName: "about.biggestChallenges",
                placeholder: t("placeholders.currentChallenge"),
                options: buildOptions(
                    "biggestChallenges",
                    BIGGEST_CHALLENGE_OPTION_IDS,
                ),
                selectionMode: "multiple",
            },
        ],
        [t, buildOptions],
    );

    const visibleQuestions = useMemo(
        () =>
            getVisibleQuestionnaireSteps(
                questionnaireSteps,
                selectedExperience,
            ),
        [questionnaireSteps, selectedExperience],
    );
    const isSurveyConfigReady = useMemo(() => {
        if (!POSTHOG_SURVEY_ID) return false;
        return QUESTIONNAIRE_FIELD_ORDER.every((field) =>
            Boolean(POSTHOG_SURVEY_QUESTION_IDS[field]),
        );
    }, []);
    const visibleQuestionIndexMap = useMemo(
        () =>
            new Map(
                visibleQuestions.map((step, index) => [step.fieldName, index]),
            ),
        [visibleQuestions],
    );
    const questionIndex =
        visibleQuestionIndexMap.get(activeQuestionField) ?? -1;
    const currentQuestion =
        questionIndex === -1
            ? visibleQuestions[0]
            : visibleQuestions[questionIndex];
    const currentStepIndex = questionIndex === -1 ? 0 : questionIndex;
    const progressLabel = `${currentStepIndex + 1}/${visibleQuestions.length}`;

    useEffect(() => {
        if (hasInitializedQuestionRef.current) return;
        if (!visibleQuestions.length) return;

        setActiveQuestionField(
            startFromLastQuestion
                ? visibleQuestions[visibleQuestions.length - 1].fieldName
                : visibleQuestions[0].fieldName,
        );
        hasInitializedQuestionRef.current = true;
    }, [startFromLastQuestion, visibleQuestions]);

    useEffect(() => {
        if (!visibleQuestions.length) return;
        if (
            visibleQuestions.some(
                (step) => step.fieldName === activeQuestionField,
            )
        ) {
            return;
        }
        setActiveQuestionField(visibleQuestions[0].fieldName);
    }, [activeQuestionField, visibleQuestions]);

    const shouldSkipToolsQuestion = !visibleQuestions.some(
        (step) => step.fieldName === "about.currentTools",
    );

    useEffect(() => {
        if (!shouldSkipToolsQuestion) return;
        const hasCurrentToolsAnswer =
            (currentToolsValue?.selected?.length ?? 0) > 0 ||
            !!currentToolsValue?.other;
        if (!hasCurrentToolsAnswer) return;
        form.setValue("about.currentTools.selected", []);
        form.setValue("about.currentTools.other", "");
    }, [
        currentToolsValue?.other,
        currentToolsValue?.selected,
        form,
        shouldSkipToolsQuestion,
    ]);

    useEffect(() => {
        if (!isSurveyConfigReady || !POSTHOG_SURVEY_ID) return;
        if (surveyShownFiredRef.current) return;
        surveyShownFiredRef.current = true;
        posthog.capture("survey shown", { $survey_id: POSTHOG_SURVEY_ID });
    }, [isSurveyConfigReady]);

    if (!currentQuestion) return null;

    const currentValue = form.watch(currentQuestion.fieldName) as
        | { selected: string[]; other?: string }
        | undefined;
    const selectedValues = currentValue?.selected ?? [];
    const hasOtherSelected = selectedValues.includes("other");
    const questionHasOtherOption = currentQuestion.options.some(
        (option) => option.id === "other",
    );
    const canContinue = selectedValues.length > 0;
    const chainByKey = useMemo(
        () => new Map(chains.map((chain) => [chain.key, chain])),
        [chains],
    );

    const updateSelection = (optionId: string) => {
        const isSelected = selectedValues.includes(optionId);
        const nextSelected =
            currentQuestion.selectionMode === "single"
                ? isSelected
                    ? selectedValues
                    : [optionId]
                : isSelected
                  ? selectedValues.filter((id) => id !== optionId)
                  : [...selectedValues, optionId];

        form.setValue(
            `${currentQuestion.fieldName}.selected` as QuestionnaireFieldName,
            nextSelected,
            { shouldDirty: true },
        );

        if (!nextSelected.includes("other")) {
            form.setValue(
                `${currentQuestion.fieldName}.other` as QuestionnaireFieldName,
                "",
                { shouldDirty: true },
            );
        }
    };

    const advanceQuestion = () => {
        const latestVisibleQuestions = getVisibleQuestionnaireSteps(
            questionnaireSteps,
            form.getValues("about.multisigExperience.selected")?.[0],
        );
        const currentFieldName = activeQuestionField;
        const currentIndex = latestVisibleQuestions.findIndex(
            (step) => step.fieldName === currentFieldName,
        );

        if (
            currentIndex === -1 ||
            currentIndex === latestVisibleQuestions.length - 1
        ) {
            handleNext?.();
            return;
        }
        setActiveQuestionField(
            latestVisibleQuestions[currentIndex + 1].fieldName,
        );
    };

    const goToPreviousQuestion = () => {
        const latestVisibleQuestions = getVisibleQuestionnaireSteps(
            questionnaireSteps,
            form.getValues("about.multisigExperience.selected")?.[0],
        );
        const currentFieldName = activeQuestionField;
        const currentIndex = latestVisibleQuestions.findIndex(
            (step) => step.fieldName === currentFieldName,
        );
        if (currentIndex <= 0) return;
        setActiveQuestionField(
            latestVisibleQuestions[currentIndex - 1].fieldName,
        );
    };

    const captureSurveyProgress = () => {
        if (!isSurveyConfigReady || !POSTHOG_SURVEY_ID) return;
        const about = form.getValues("about");
        const latestVisible = getVisibleQuestionnaireSteps(
            questionnaireSteps,
            about.multisigExperience.selected?.[0],
        );
        const idx = latestVisible.findIndex(
            (s) => s.fieldName === activeQuestionField,
        );
        const isCompleted = idx !== -1 && idx === latestVisible.length - 1;

        posthog.capture("survey sent", {
            $survey_id: POSTHOG_SURVEY_ID,
            $survey_submission_id: surveySubmissionIdRef.current,
            $survey_completed: isCompleted,
            ...buildCumulativeSurveyResponses(about, latestVisible, t("other")),
            ...(isCompleted && {
                $set: {
                    onboarding_role: about.role.selected[0],
                    onboarding_team_size: about.teamSize.selected[0],
                    onboarding_multisig_experience:
                        about.multisigExperience.selected[0],
                    onboarding_networks: about.networks.selected,
                    onboarding_monthly_volume: about.monthlyVolume.selected[0],
                },
            }),
        });
    };

    const moveNext = () => {
        captureSurveyProgress();
        advanceQuestion();
    };

    const handleSkip = () => {
        form.setValue(
            `${currentQuestion.fieldName}.selected` as QuestionnaireFieldName,
            [],
            { shouldDirty: true },
        );
        form.setValue(
            `${currentQuestion.fieldName}.other` as QuestionnaireFieldName,
            "",
            { shouldDirty: true },
        );
        captureSurveyProgress();
        advanceQuestion();
    };

    const renderedOptions = currentQuestion.options.map((option) => {
        const chainKey = NETWORK_OPTION_CHAIN_KEY[option.id];
        const chain = chainKey ? chainByKey.get(chainKey) : undefined;
        if (currentQuestion.fieldName !== "about.networks" || !chain) {
            return option;
        }
        return {
            ...option,
            iconDark: chain.iconDark,
            iconLight: chain.iconLight,
            iconImageClassName: option.id === "near" ? "p-0.5" : "rounded-full",
        };
    });

    return (
        <OnboardingQuestionnaireCard
            question={{
                title: currentQuestion.title,
                text: currentQuestion.question,
                progressLabel,
                options: renderedOptions,
                selectedValues,
                indicatorType:
                    currentQuestion.selectionMode === "single"
                        ? "radio"
                        : "checkbox",
                showOtherInput: hasOtherSelected && questionHasOtherOption,
                otherValue: currentValue?.other ?? "",
                otherPlaceholder:
                    currentQuestion.placeholder ??
                    t("placeholders.describeOther"),
                canContinue,
            }}
            actions={{
                onBack: goToPreviousQuestion,
                onOptionClick: updateSelection,
                onOtherChange: (value) => {
                    form.setValue(
                        `${currentQuestion.fieldName}.other` as QuestionnaireFieldName,
                        value,
                        { shouldDirty: true },
                    );
                },
                onContinue: moveNext,
                onSkip: handleSkip,
            }}
            showBack={currentStepIndex > 0}
        />
    );
}
