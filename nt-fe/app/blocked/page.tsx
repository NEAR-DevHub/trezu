import { getTranslations } from "next-intl/server";
import Image from "next/image";

export default async function BlockedPage() {
    const t = await getTranslations("blocked");
    return (
        <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-black">
            {/* Blue glow */}
            <div
                className="absolute left-1/2 -translate-x-1/2 w-full max-w-[943px] aspect-943/286 rounded-full -rotate-[0.43deg] blur-[80px] md:blur-[176.5px]"
                style={{
                    background:
                        "linear-gradient(229.17deg, rgba(31, 156, 240, 0) -10.13%, rgba(31, 156, 240, 0.592) 26.64%, rgba(31, 156, 240, 0.576) 73.76%, rgba(31, 156, 240, 0) 109.39%)",
                }}
            />

            {/* World map */}
            <Image
                src="/world.svg"
                alt=""
                width={800}
                height={450}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80%] max-w-[800px] opacity-40"
                priority
            />

            {/* Text content */}
            <div className="relative z-10 flex flex-col items-center gap-3 px-6 text-center">
                <h1 className="text-lg md:text-5xl font-medium tracking-[-0.32px] text-white">
                    {t("title")}
                </h1>
                <p className="text-sm md:text-base text-white/80">
                    {t("description")}
                </p>
            </div>
        </div>
    );
}
