/**
 * Time zones offered by account settings.
 *
 * One IANA zone per city group, labelled the way desktop calendars do —
 * "(UTC+01:00) Amsterdam, Berlin, Bern, Rome, Stockholm, Vienna". Only `zone`
 * is persisted and used for formatting; the offset shown in the label is
 * derived at render time, so DST and political changes need no maintenance
 * here.
 */

interface TimezoneGroup {
    /** IANA zone, the value handed to `Intl.DateTimeFormat`. */
    zone: string;
    /** Cities the group is known by, in the label's own order. */
    cities: string;
}

const TIMEZONE_GROUPS = [
    { zone: "Etc/GMT+12", cities: "International Date Line West" },
    { zone: "Pacific/Pago_Pago", cities: "Midway Island, American Samoa" },
    { zone: "Pacific/Honolulu", cities: "Hawaii" },
    { zone: "America/Anchorage", cities: "Alaska" },
    { zone: "America/Los_Angeles", cities: "Pacific Time (US & Canada)" },
    { zone: "America/Tijuana", cities: "Baja California" },
    { zone: "America/Phoenix", cities: "Arizona" },
    { zone: "America/Chihuahua", cities: "Chihuahua, La Paz, Mazatlan" },
    { zone: "America/Denver", cities: "Mountain Time (US & Canada)" },
    { zone: "America/Guatemala", cities: "Central America" },
    { zone: "America/Chicago", cities: "Central Time (US & Canada)" },
    {
        zone: "America/Mexico_City",
        cities: "Guadalajara, Mexico City, Monterrey",
    },
    { zone: "America/Regina", cities: "Saskatchewan" },
    { zone: "America/Bogota", cities: "Bogota, Lima, Quito, Rio Branco" },
    { zone: "America/New_York", cities: "Eastern Time (US & Canada)" },
    { zone: "America/Indiana/Indianapolis", cities: "Indiana (East)" },
    { zone: "America/Halifax", cities: "Atlantic Time (Canada)" },
    { zone: "America/Caracas", cities: "Caracas" },
    { zone: "America/Cuiaba", cities: "Cuiaba" },
    { zone: "America/La_Paz", cities: "Georgetown, La Paz, Manaus, San Juan" },
    { zone: "America/Santiago", cities: "Santiago" },
    { zone: "America/St_Johns", cities: "Newfoundland" },
    { zone: "America/Sao_Paulo", cities: "Brasilia" },
    {
        zone: "America/Argentina/Buenos_Aires",
        cities: "City of Buenos Aires",
    },
    { zone: "America/Cayenne", cities: "Cayenne, Fortaleza" },
    { zone: "America/Godthab", cities: "Greenland" },
    { zone: "America/Montevideo", cities: "Montevideo" },
    { zone: "Etc/GMT+2", cities: "Coordinated Universal Time-02" },
    { zone: "Atlantic/Azores", cities: "Azores" },
    { zone: "Atlantic/Cape_Verde", cities: "Cape Verde Is." },
    { zone: "UTC", cities: "Coordinated Universal Time" },
    { zone: "Europe/London", cities: "Dublin, Edinburgh, Lisbon, London" },
    { zone: "Atlantic/Reykjavik", cities: "Monrovia, Reykjavik" },
    {
        zone: "Europe/Prague",
        cities: "Belgrade, Bratislava, Budapest, Ljubljana, Prague",
    },
    { zone: "Europe/Warsaw", cities: "Sarajevo, Skopje, Warsaw, Zagreb" },
    { zone: "Europe/Paris", cities: "Brussels, Copenhagen, Madrid, Paris" },
    {
        zone: "Europe/Berlin",
        cities: "Amsterdam, Berlin, Bern, Rome, Stockholm, Vienna",
    },
    { zone: "Africa/Lagos", cities: "West Central Africa" },
    { zone: "Africa/Casablanca", cities: "Casablanca" },
    { zone: "Africa/Windhoek", cities: "Windhoek" },
    { zone: "Europe/Bucharest", cities: "Athens, Bucharest" },
    { zone: "Asia/Beirut", cities: "Beirut" },
    { zone: "Africa/Cairo", cities: "Cairo" },
    { zone: "Asia/Damascus", cities: "Damascus" },
    { zone: "Africa/Johannesburg", cities: "Harare, Pretoria" },
    {
        zone: "Europe/Kyiv",
        cities: "Helsinki, Kyiv, Riga, Sofia, Tallinn, Vilnius",
    },
    { zone: "Asia/Jerusalem", cities: "Jerusalem" },
    { zone: "Asia/Baghdad", cities: "Baghdad" },
    { zone: "Europe/Istanbul", cities: "Istanbul" },
    { zone: "Asia/Riyadh", cities: "Kuwait, Riyadh" },
    { zone: "Europe/Minsk", cities: "Minsk" },
    { zone: "Europe/Moscow", cities: "Moscow, St. Petersburg, Volgograd" },
    { zone: "Africa/Nairobi", cities: "Nairobi" },
    { zone: "Asia/Tehran", cities: "Tehran" },
    { zone: "Asia/Dubai", cities: "Abu Dhabi, Muscat" },
    { zone: "Asia/Baku", cities: "Baku" },
    { zone: "Asia/Tbilisi", cities: "Tbilisi" },
    { zone: "Asia/Yerevan", cities: "Yerevan" },
    { zone: "Asia/Kabul", cities: "Kabul" },
    { zone: "Asia/Karachi", cities: "Islamabad, Karachi" },
    { zone: "Asia/Tashkent", cities: "Tashkent" },
    { zone: "Asia/Kolkata", cities: "Chennai, Kolkata, Mumbai, New Delhi" },
    { zone: "Asia/Colombo", cities: "Sri Jayawardenepura" },
    { zone: "Asia/Kathmandu", cities: "Kathmandu" },
    { zone: "Asia/Almaty", cities: "Almaty, Novosibirsk" },
    { zone: "Asia/Dhaka", cities: "Astana, Dhaka" },
    { zone: "Asia/Yangon", cities: "Yangon (Rangoon)" },
    { zone: "Asia/Bangkok", cities: "Bangkok, Hanoi, Jakarta" },
    { zone: "Asia/Krasnoyarsk", cities: "Krasnoyarsk" },
    {
        zone: "Asia/Shanghai",
        cities: "Beijing, Chongqing, Hong Kong, Urumqi",
    },
    { zone: "Asia/Singapore", cities: "Kuala Lumpur, Singapore" },
    { zone: "Australia/Perth", cities: "Perth" },
    { zone: "Asia/Taipei", cities: "Taipei" },
    { zone: "Asia/Ulaanbaatar", cities: "Ulaanbaatar" },
    { zone: "Asia/Irkutsk", cities: "Irkutsk" },
    { zone: "Asia/Tokyo", cities: "Osaka, Sapporo, Tokyo" },
    { zone: "Asia/Seoul", cities: "Seoul" },
    { zone: "Australia/Adelaide", cities: "Adelaide" },
    { zone: "Australia/Darwin", cities: "Darwin" },
    { zone: "Australia/Brisbane", cities: "Brisbane" },
    { zone: "Australia/Sydney", cities: "Canberra, Melbourne, Sydney" },
    { zone: "Pacific/Port_Moresby", cities: "Guam, Port Moresby" },
    { zone: "Australia/Hobart", cities: "Hobart" },
    { zone: "Asia/Yakutsk", cities: "Yakutsk" },
    { zone: "Pacific/Guadalcanal", cities: "Solomon Is., New Caledonia" },
    { zone: "Asia/Vladivostok", cities: "Vladivostok" },
    { zone: "Pacific/Auckland", cities: "Auckland, Wellington" },
    { zone: "Pacific/Fiji", cities: "Fiji" },
    { zone: "Asia/Magadan", cities: "Magadan" },
    { zone: "Pacific/Tongatapu", cities: "Nuku'alofa" },
    { zone: "Pacific/Apia", cities: "Samoa" },
] as const satisfies readonly TimezoneGroup[];

/** The zone the browser reports, or UTC where the platform withholds it. */
export function detectTimezone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/**
 * "UTC+01:00" for the zone's *current* offset. `longOffset` yields "GMT+1",
 * "GMT+05:30" or a bare "GMT", so the minutes are padded back on here.
 */
function offsetLabel(zone: string, at: Date): string {
    let raw = "GMT";
    try {
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: zone,
            timeZoneName: "longOffset",
        }).formatToParts(at);
        raw =
            parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
    } catch {
        // Zone this platform's ICU doesn't know — show it at UTC rather than throw.
    }
    const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(raw);
    if (!match) return "UTC+00:00";
    const [, sign, hours, minutes = "00"] = match;
    return `UTC${sign}${hours.padStart(2, "0")}:${minutes}`;
}

/** Minutes east of UTC — the sort key behind the "(UTC…)" prefix. */
function offsetMinutes(zone: string, at: Date): number {
    const label = offsetLabel(zone, at);
    const sign = label[3] === "-" ? -1 : 1;
    const [hours, minutes] = label.slice(4).split(":").map(Number);
    return sign * (hours * 60 + minutes);
}

interface TimezoneOption {
    /** IANA zone. */
    value: string;
    /** "(UTC+01:00) Amsterdam, Berlin, Bern, Rome, Stockholm, Vienna". */
    label: string;
}

/**
 * Every group as a pickable option, ordered west to east by the offset in
 * force at `at`. An unlisted zone (a new IANA name, or one this list doesn't
 * cover) is appended under its own name so a stored preference stays visible.
 */
export function buildTimezoneOptions(
    includeZone?: string | null,
    at: Date = new Date(),
): TimezoneOption[] {
    const groups: TimezoneGroup[] = [...TIMEZONE_GROUPS];
    if (includeZone && !groups.some((group) => group.zone === includeZone)) {
        groups.push({ zone: includeZone, cities: includeZone });
    }

    return groups
        .map((group) => ({
            value: group.zone,
            label: `(${offsetLabel(group.zone, at)}) ${group.cities}`,
            sort: offsetMinutes(group.zone, at),
        }))
        .sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label))
        .map(({ value, label }) => ({ value, label }));
}
