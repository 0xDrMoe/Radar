"use client";

import { useId, type ButtonHTMLAttributes } from "react";

type GatedButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Why this control will not act for this person (their role, a missing source URL), or null
   *  when it will. */
  blocked?: string | null;
};

/**
 * A workspace button that explains itself when it is unavailable.
 *
 * A `disabled` button leaves the tab order, so the reason written on its `title` ("Your role does
 * not include verifying deals.") reached only a mouse user who happened to hover it. Blocked here
 * means `aria-disabled` instead: the button stays focusable, is announced as unavailable, carries
 * the reason as its description, and ignores clicks. Plain `disabled` is still right for a
 * momentary state such as a request in flight, and still passes straight through.
 */
export function GatedButton({ blocked, onClick, disabled, title, children, ...rest }: GatedButtonProps) {
  const reasonId = useId();
  if (!blocked) {
    return <button {...rest} disabled={disabled} title={title} onClick={onClick}>{children}</button>;
  }
  return <>
    <button
      {...rest}
      aria-disabled="true"
      aria-describedby={reasonId}
      title={blocked}
      onClick={(event) => event.preventDefault()}
    >
      {children}
    </button>
    <span id={reasonId} className="sr-only">{blocked}</span>
  </>;
}
