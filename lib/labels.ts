/**
 * Label types and their colours (§9.3). Custom labels cycle a fixed palette of
 * four further hues — never a random colour.
 */

export const LOANWORD = "loanword";
export const CODE_SWITCH = "code_switch";
export const UNCLEAR = "unclear";
export const CORRECTION = "correction";

export interface LabelStyle {
  /** css custom property holding the colour */
  varName: string;
  /** underline shape — colour is never the only signal (§13) */
  underline: "solid" | "dashed" | "dotted" | "double" | "overline";
  label: string;
}

export const BUILT_IN_LABELS: Record<string, LabelStyle> = {
  [LOANWORD]: { varName: "--loanword", underline: "solid", label: "Loanword" },
  [CODE_SWITCH]: { varName: "--codeswitch", underline: "dashed", label: "Code-switch" },
  [UNCLEAR]: { varName: "--unclear", underline: "dotted", label: "Unclear" },
  [CORRECTION]: { varName: "--correction", underline: "overline", label: "Correction" },
};

export const CUSTOM_PALETTE = [
  "--custom-1",
  "--custom-2",
  "--custom-3",
  "--custom-4",
] as const;

export const CUSTOM_UNDERLINES = ["dotted", "double", "solid", "dashed"] as const;

export interface ResolvedLabel {
  type: string;
  label: string;
  varName: string;
  underline: "solid" | "dashed" | "dotted" | "double" | "overline";
}

/**
 * Resolve a label type against a project's custom labels. Custom labels take
 * their colour from their position in the project's list, so a given label
 * always looks the same inside a project.
 */
export function resolveLabel(
  type: string,
  customLabels: { type: string; label: string }[],
): ResolvedLabel {
  const builtIn = BUILT_IN_LABELS[type];
  if (builtIn) {
    return { type, label: builtIn.label, varName: builtIn.varName, underline: builtIn.underline };
  }
  const idx = customLabels.findIndex((c) => c.type === type);
  const position = idx >= 0 ? idx : 0;
  return {
    type,
    label: customLabels[position]?.label ?? type,
    varName: CUSTOM_PALETTE[position % CUSTOM_PALETTE.length],
    underline: CUSTOM_UNDERLINES[position % CUSTOM_UNDERLINES.length],
  };
}
