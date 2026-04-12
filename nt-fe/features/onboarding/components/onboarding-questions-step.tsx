"use client";

import posthog from "posthog-js";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
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

const ROLE_OPTIONS: QuestionnaireOption[] = [
    { id: "founder", label: "Founder" },
    { id: "co-founder", label: "Co-founder" },
    { id: "cfo-finance-lead", label: "CFO / Finance Lead" },
    { id: "operations-manager", label: "Operations Manager" },
    { id: "treasury-manager", label: "Treasury Manager" },
    { id: "other", label: "Other" },
];

const USE_CASE_OPTIONS: QuestionnaireOption[] = [
    { id: "team-payroll-grants", label: "Team payroll & grants" },
    { id: "company-assets-management", label: "Company assets management" },
    { id: "dao-treasury-management", label: "DAO treasury management" },
    { id: "investment-portfolio", label: "Investment portfolio" },
    { id: "operational-spending", label: "Operational spending" },
    { id: "other", label: "Other" },
];

const TEAM_SIZE_OPTIONS: QuestionnaireOption[] = [
    { id: "just-me", label: "Just me" },
    { id: "2-5-people", label: "2-5 people" },
    { id: "6-15-people", label: "6-15 people" },
    { id: "15-plus-people", label: "15+" },
];

const NETWORK_OPTIONS: QuestionnaireOption[] = [
    { id: "near", label: "NEAR" },
    { id: "bitcoin", label: "Bitcoin" },
    { id: "ethereum", label: "Ethereum" },
    { id: "solana", label: "Solana" },
    { id: "arbitrum", label: "Arbitrum" },
    { id: "base", label: "Base" },
    { id: "optimism", label: "Optimism" },
    { id: "polygon", label: "Polygon" },
    { id: "gnosis", label: "Gnosis" },
    { id: "avalanche", label: "Avalanche" },
    { id: "bnb-chain", label: "BNB Chain" },
    { id: "other", label: "Other" },
];

const MULTISIG_EXPERIENCE_OPTIONS: QuestionnaireOption[] = [
    { id: "never-heard-of-it", label: "Never heard of it" },
    { id: "heard-about-it", label: "Heard about it" },
    { id: "never-used-it", label: "Never used it" },
    { id: "used-gnosis-safe-or-similar", label: "Used Gnosis Safe or similar" },
    { id: "experienced", label: "Experienced" },
    { id: "looking-for-a-better-option", label: "Looking for a better option" },
];

const CURRENT_TOOLS_OPTIONS: QuestionnaireOption[] = [
    {
        id: "gnosis-safe",
        label: "Gnosis Safe",
        iconSrc: "/icons/gnosis-safe.svg",
    },
    { id: "fireblocks", label: "Fireblocks", iconSrc: "/icons/fireblocks.svg" },
    { id: "tholos", label: "Tholos", iconSrc: "/icons/tholos.svg" },
    {
        id: "squads-multisig",
        label: "Squads Multisig",
        iconSrc: "/icons/squads-multisig.svg",
    },
    { id: "mpc-vault", label: "MPC Vault", iconSrc: "/icons/mpc-vault.svg" },
    { id: "other", label: "Other" },
];

const MONTHLY_VOLUME_OPTIONS: QuestionnaireOption[] = [
    { id: "under-10k", label: "Under $10K" },
    { id: "10k-100k", label: "$10K - $100K" },
    { id: "100k-1m", label: "$100K - $1M" },
    { id: "1m-plus", label: "$1M+" },
];

const BIGGEST_CHALLENGE_OPTIONS: QuestionnaireOption[] = [
    { id: "slow-approvals-and-signing", label: "Slow approvals and signing" },
    {
        id: "lack-of-transparency-in-the-team",
        label: "Lack of transparency in the team",
    },
    {
        id: "hard-to-track-spending-and-balances",
        label: "Hard to track spending and balances",
    },
    { id: "security-and-access-control", label: "Security and access control" },
    { id: "no-good-web3-tool-yet", label: "No good Web3 tool yet" },
    {
        id: "looking-for-crypto-earnings",
        label: "I am looking for crypto earnings",
    },
    { id: "other", label: "Other" },
];

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

const QUESTIONNAIRE_STEPS: QuestionnaireStep[] = [
    {
        title: "A few quick questions to begin.",
        question: "What best describes your role?",
        fieldName: "about.role",
        placeholder: "Describe your role (optional)",
        options: ROLE_OPTIONS,
        selectionMode: "single",
    },
    {
        title: "",
        question: "What do you plan to use Trezu for?",
        fieldName: "about.useCases",
        placeholder: "Describe your use case (optional)",
        options: USE_CASE_OPTIONS,
        selectionMode: "multiple",
    },
    {
        title: "",
        question: "How many people will manage the treasury?",
        fieldName: "about.teamSize",
        options: TEAM_SIZE_OPTIONS,
        selectionMode: "single",
    },
    {
        title: "",
        question: "Which networks do you use most often?",
        fieldName: "about.networks",
        placeholder: "Enter network name (optional)",
        options: NETWORK_OPTIONS,
        selectionMode: "multiple",
    },
    {
        title: "",
        question: "What's your experience with multisig?",
        fieldName: "about.multisigExperience",
        options: MULTISIG_EXPERIENCE_OPTIONS,
        selectionMode: "single",
    },
    {
        title: "",
        question: "What tools do you currently use to manage finances?",
        fieldName: "about.currentTools",
        options: CURRENT_TOOLS_OPTIONS,
        selectionMode: "multiple",
    },
    {
        title: "",
        question: "Approximate monthly transaction volume?",
        fieldName: "about.monthlyVolume",
        options: MONTHLY_VOLUME_OPTIONS,
        selectionMode: "single",
    },
    {
        title: "",
        question: "What's your biggest challenge right now?",
        fieldName: "about.biggestChallenges",
        placeholder: "Enter your current challenge (optional)",
        options: BIGGEST_CHALLENGE_OPTIONS,
        selectionMode: "multiple",
    },
];

export const ONBOARDING_QUESTIONNAIRE_STEP_COUNT = QUESTIONNAIRE_STEPS.length;

function getVisibleQuestionnaireSteps(selectedExperience?: string) {
    // Hide the "current tools" step for beginner users with little/no multisig exposure.
    const skipToolsQuestion =
        !!selectedExperience &&
        MULTISIG_BEGINNER_EXPERIENCE_OPTIONS.has(selectedExperience);

    if (!skipToolsQuestion) {
        return QUESTIONNAIRE_STEPS;
    }

    return QUESTIONNAIRE_STEPS.filter(
        (step) => step.fieldName !== "about.currentTools",
    );
}

function formatSurveyResponse(
    answer: { selected: string[]; other?: string },
    options: QuestionnaireOption[],
    selectionMode: QuestionnaireSelectionMode,
): string | string[] {
    const optionLabelById = new Map(
        options.map((option) => [option.id, option.label]),
    );
    const values = answer.selected.map((id) => {
        if (id === "other") {
            return answer.other?.trim() || "Other";
        }
        return optionLabelById.get(id) ?? id;
    });
    return selectionMode === "single" ? (values[0] ?? "") : values;
}

function buildCumulativeSurveyResponses(
    about: OnboardingAboutValues,
    steps: QuestionnaireStep[],
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
        );
    }
    return responses;
}

export function getQuestionnaireSummary(about: OnboardingAboutValues) {
    return {
        role_selected: about.role.selected,
        role_other: about.role.other?.trim() || undefined,
        team_size_selected: about.teamSize.selected,
        networks_selected: about.networks.selected,
        networks_count: about.networks.selected.length,
        networks_other: about.networks.other?.trim() || undefined,
        use_cases_selected: about.useCases.selected,
        use_cases_count: about.useCases.selected.length,
        use_cases_other: about.useCases.other?.trim() || undefined,
        multisig_experience_selected: about.multisigExperience.selected,
        current_tools_selected: about.currentTools.selected,
        current_tools_count: about.currentTools.selected.length,
        monthly_volume_selected: about.monthlyVolume.selected,
        biggest_challenges_selected: about.biggestChallenges.selected,
        biggest_challenges_count: about.biggestChallenges.selected.length,
        biggest_challenges_other:
            about.biggestChallenges.other?.trim() || undefined,
        discovery_sources_selected: about.discoverySources.selected,
        discovery_sources_count: about.discoverySources.selected.length,
        discovery_sources_other:
            about.discoverySources.other?.trim() || undefined,
    };
}

export function OnboardingQuestionsStep({ handleNext }: StepProps) {
    const form = useFormContext<{ about: OnboardingAboutValues }>();
    const { data: chains = [] } = useChains();
    const [activeQuestionField, setActiveQuestionField] =
        useState<QuestionnaireBaseFieldName>(QUESTIONNAIRE_STEPS[0].fieldName);
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
    const visibleQuestions = useMemo(
        () => getVisibleQuestionnaireSteps(selectedExperience),
        [selectedExperience],
    );
    const isSurveyConfigReady = useMemo(() => {
        if (!POSTHOG_SURVEY_ID) return false;
        return QUESTIONNAIRE_STEPS.every((step) =>
            Boolean(POSTHOG_SURVEY_QUESTION_IDS[step.fieldName]),
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
            ...buildCumulativeSurveyResponses(about, latestVisible),
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
                    currentQuestion.placeholder ?? "Describe other (optional)",
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
