"use client";
import { useState } from "react";

/**
 * A checkout code, shown on its own and copyable in one tap. The code is the thing a reader has to
 * carry from this page to the chain's checkout, and retyping "WEBBERONI" from memory on a phone is
 * where it goes wrong. Copy failing (no clipboard permission, an old browser) leaves the code on
 * screen to read, which is what this was before the button existed.
 */
export default function PromoCode({ code, copyLabel, copiedLabel }: { code: string; copyLabel: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <p className="promo-code">
      <code>{code}</code>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            // Refused: the code is still on screen.
          }
        }}
      >
        {copied ? copiedLabel : copyLabel}
      </button>
    </p>
  );
}
