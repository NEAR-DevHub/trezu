export interface SectionRule<T> {
    title: string;
    filter: (option: T) => boolean;
    disabled?: boolean;
}

export interface Section<T> {
    title: string;
    options: (T & { disabled?: boolean })[];
}

export function buildSectionedOptions<T extends { id: string }>(
    options: T[],
    rules: SectionRule<T>[],
): Section<T>[] {
    const remaining = [...options];
    const sections: Section<T>[] = [];

    for (const rule of rules) {
        const matched: T[] = [];
        const unmatched: T[] = [];

        for (const option of remaining) {
            if (rule.filter(option)) {
                matched.push(option);
            } else {
                unmatched.push(option);
            }
        }

        remaining.splice(0, remaining.length, ...unmatched);

        if (matched.length === 0) {
            continue;
        }

        sections.push({
            title: rule.title,
            options: matched.map((option) =>
                rule.disabled ? { ...option, disabled: true } : option,
            ),
        });
    }

    return sections;
}
