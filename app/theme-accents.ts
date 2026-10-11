export interface AccentDefinition {
  label: string;
  light: string;
  dark: string;
  /**
   * The light-mode accent again, deep enough to be read at body size.
   *
   * `light` is the fill and stays the brand hex. As text on cream it is a different measurement
   * and half the palette fails it — coral at 3.07:1, amber 3.26, teal 3.85, gold 4.19, against
   * the 4.5:1 that anything under 24px needs. Deep enough to sit behind white is not the same as
   * deep enough to be read, and no single hex is both.
   *
   * Dark mode needs no equivalent: its accents are pale by design and already read at 6.80:1 or
   * better on the page ground, so `--coral-strong` resolves to `dark` there.
   *
   * Kept identical to `strong` in mobile/lib/accents.ts, which tests/mobile-appearance.test.mjs
   * checks hex for hex.
   */
  strong: string;
  pro?: boolean;
}

export const ACCENTS: Record<string, AccentDefinition> = {
  coral: { label: "Coral", light: "#e95f3b", dark: "#ff6f4a", strong: "#c23916" },
  amber: { label: "Amber", light: "#b9790f", dark: "#f5b942", strong: "#92600c" },
  teal: { label: "Teal", light: "#1f8a70", dark: "#3ddba0", strong: "#1b7861" },
  blue: { label: "Blue", light: "#2f5fd6", dark: "#6fa0ff", strong: "#2f5fd6" },
  violet: { label: "Violet", light: "#7c3aed", dark: "#b98bff", strong: "#7c3aed" },
  rose: { label: "Rose", light: "#be185d", dark: "#ff6fa5", strong: "#be185d" },
  gold: { label: "Gold", light: "#9c6b0a", dark: "#e8c766", strong: "#8e6109", pro: true },
  graphite: { label: "Graphite", light: "#44403c", dark: "#d6d3d1", strong: "#44403c", pro: true },
};

export const ACCENT_KEYS = Object.keys(ACCENTS);

export function isAccentKey(value: unknown): value is keyof typeof ACCENTS {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ACCENTS, value);
}

/** The app's near-black, repeated here so this module keeps importing nothing. */
const INK = "#17261e";

function luminance(hex: string) {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) => {
    const part = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/**
 * Text that can be read on a block of this color.
 *
 * White was the answer everywhere for as long as the accent was one hex, and it was wrong in both
 * themes: 3.41:1 on the light coral fill and 2.75:1 on the pale dark one, against the 4.5:1 that
 * a 13px button label needs. The dark accents are picked to *be* text on near-black, so nothing
 * light can sit on them — white on dark gold is 1.64:1.
 *
 * Choosing per color rather than per theme clears 4.5:1 on all sixteen, worst at 5.38, and keeps
 * working if an accent is ever added or retuned. A port of readableOn in mobile/lib/accents.ts.
 */
export function readableOn(background: string) {
  const light = luminance(background);
  const onWhite = 1.05 / (light + 0.05);
  const onInk = (light + 0.05) / (luminance(INK) + 0.05);
  return onWhite >= onInk ? "#ffffff" : INK;
}
