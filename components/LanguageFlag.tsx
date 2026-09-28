import { flagForLanguage } from "@/lib/language-flags";

export function LanguageFlag({
  tag,
  size = 16,
}: {
  tag: string;
  size?: number;
}) {
  const flag = flagForLanguage(tag);
  const height = Math.max(10, Math.round((size * 3) / 4));

  return (
    // eslint-disable-next-line @next/next/no-img-element -- local SVG assets from public/flags
    <img
      src={`/flags/4x3/${flag}.svg`}
      alt=""
      width={size}
      height={height}
      className="inline-block shrink-0 rounded-[2px] object-cover"
      style={{
        border: "1px solid color-mix(in oklch, var(--text) 14%, transparent)",
        background: "color-mix(in oklch, var(--text) 5%, transparent)",
      }}
      aria-hidden
      onError={(event) => {
        const img = event.currentTarget;
        if (img.dataset.fallback) return;
        img.dataset.fallback = "1";
        img.src = "/flags/4x3/un.svg";
      }}
    />
  );
}
