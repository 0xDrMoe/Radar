// Why a suggestion was turned down, in words the person who sent it can act on.
//
// Pure and import-free, so the review screen offers exactly the reasons the server accepts and the
// server stores exactly the sentence the screen showed. A rejection is read by its submitter - a
// creator sees it in their workspace - so each standard reason is written to them, not about them.
//
// "other" takes a written explanation instead, and that explanation has to say something: an empty
// box, "no", "rejected" or a row of the same key pressed is refused, because a reason nobody can
// learn from is no better than none.

export const SUGGESTION_REJECTION_REASONS = [
  { code: "duplicate", label: "Already listed", text: "Radar already lists this offer, so it was not added a second time." },
  { code: "not_a_deal", label: "Not a deal", text: "This is a regular menu price rather than a discount, special or limited offer, so it is not something Radar lists." },
  { code: "no_source", label: "Could not find a source", text: "We could not find this offer on the restaurant's own website, menu or social accounts, so we could not confirm it." },
  { code: "expired", label: "Offer has ended", text: "The restaurant's own information shows this offer has already ended." },
  { code: "unverifiable", label: "Details did not match", text: "What the restaurant publishes did not match the details sent in (price, days or times), so it could not be confirmed as described." },
  { code: "outside_coverage", label: "Outside where Radar lists deals", text: "This restaurant is outside the areas Radar currently covers. We may add it when we expand there." },
  { code: "drink_rules", label: "Breaks drink-advertising rules", text: "This offer can't be listed as written because of the alcohol advertising rules where the restaurant operates." },
  { code: "closed", label: "Restaurant closed", text: "The restaurant appears to be permanently closed." },
  { code: "other", label: "Other (write a reason)", text: "" },
] as const;

export type SuggestionRejectionCode = (typeof SUGGESTION_REJECTION_REASONS)[number]["code"];

export const MIN_CUSTOM_REASON_LENGTH = 20;

const MEANINGLESS = /^(no|nope|n\/a|na|none|rejected?|reject|denied|bad|spam|test|invalid|wrong|x+|\.+|-+|\?+)$/i;

/** Why a written reason would be refused, or null when it is acceptable. */
export function customReasonProblem(text: string): string | null {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) return "Write a reason for the person who sent this in.";
  if (MEANINGLESS.test(trimmed)) return "Say what was wrong, so the person who sent it can fix it next time.";
  if (trimmed.length < MIN_CUSTOM_REASON_LENGTH) return `Write at least ${MIN_CUSTOM_REASON_LENGTH} characters, in a full sentence.`;
  if (trimmed.split(" ").filter((word) => /[a-z]{2,}/i.test(word)).length < 4) return "Write the reason as a sentence of at least four words.";
  if (/(.)\1{5,}/.test(trimmed)) return "That reads like repeated keys rather than a reason.";
  return null;
}

/**
 * The stored reason for a rejection: a standard reason's sentence, or a written one that says
 * something. `code` is what the audit log records.
 */
export function resolveRejectionReason(code: unknown, custom: unknown):
  | { ok: true; code: SuggestionRejectionCode; text: string }
  | { ok: false; message: string } {
  const reason = SUGGESTION_REJECTION_REASONS.find((entry) => entry.code === code);
  if (!reason) return { ok: false, message: "Choose a reason for rejecting this suggestion." };
  const written = typeof custom === "string" ? custom.trim().replace(/\s+/g, " ").slice(0, 500) : "";
  if (reason.code === "other") {
    const problem = customReasonProblem(written);
    return problem ? { ok: false, message: problem } : { ok: true, code: reason.code, text: written };
  }
  // A standard reason may carry a short note after it ("Already listed — see the Tuesday wing
  // night"), which is kept, but it is never required.
  return { ok: true, code: reason.code, text: written ? `${reason.text} ${written}` : reason.text };
}
