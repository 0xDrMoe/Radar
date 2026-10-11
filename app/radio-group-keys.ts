import type { KeyboardEvent } from "react";

// Arrow-key movement for a role="radiogroup" built from buttons. A radiogroup is one Tab stop:
// the checked radio carries tabIndex 0 and the rest -1 (see radioTabIndex), and the arrow keys move
// to the neighboring radio and select it, which is what a screen reader announcing "radio, 2 of 6"
// tells its user to press. Selecting is done by clicking the neighbor, so each group keeps its own
// onClick as the one place a choice is made.
//
// Radios marked data-arrow-skip are passed over: a Pro-locked accent swatch sends its click to the
// upgrade page, which is not something an arrow key should do on the way past.
export function onRadioGroupKey(event: KeyboardEvent<HTMLElement>) {
  const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
  if (!step) return;
  const group = event.currentTarget.closest('[role="radiogroup"]');
  if (!group) return;
  const radios = Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]')).filter(
    (radio) => !radio.hasAttribute("data-arrow-skip") && radio.getAttribute("aria-disabled") !== "true" && !(radio as HTMLButtonElement).disabled,
  );
  if (!radios.length) return;
  event.preventDefault();
  const index = radios.indexOf(event.currentTarget);
  const next = radios[(index + step + radios.length) % radios.length];
  next.focus();
  next.click();
}

/** tabIndex for a radio in a group: the checked one, or the first when nothing is checked yet. */
export function radioTabIndex(checked: boolean, index: number, anyChecked: boolean) {
  return checked || (!anyChecked && index === 0) ? 0 : -1;
}
