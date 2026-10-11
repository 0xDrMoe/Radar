"use client";
import { useState } from "react";
import { useWorkspace } from "../workspace";

// The written note that goes with closing or reopening an accuracy report or a feedback item.
//
// The server refuses to close either without a resolution (RESOLUTION_REQUIRED) and to reopen a
// completed one without a reason (REOPEN_REASON_REQUIRED), so the form asks for the text up front
// rather than letting someone click Resolve and get an error back. The server's own field error is
// still shown under the box, in case the rule ever tightens there first.
//
// Shared by ReportsTab and FeedbackTab; styles are in the "Reports, feedback, mailing list" block of
// app/staff-workspace.css.

export function DecisionNote({
  id,
  label,
  hint,
  field,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  /** Unique per row and decision, for the label/textarea pairing. */
  id: string;
  label: string;
  hint: string;
  /** The field name the server reports an error under: "resolution" or "reason". */
  field: "resolution" | "reason";
  submitLabel: string;
  busy: boolean;
  onSubmit: (text: string) => Promise<unknown>;
  onCancel: () => void;
}) {
  const { fieldErrors } = useWorkspace();
  const [text, setText] = useState("");
  const serverError = fieldErrors[field];
  const empty = !text.trim();
  return (
    <form
      className="sw-decision"
      onSubmit={(event) => {
        event.preventDefault();
        if (!empty) void onSubmit(text.trim());
      }}
    >
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        value={text}
        maxLength={field === "reason" ? 500 : 1000}
        rows={3}
        required
        aria-describedby={`${id}-hint`}
        aria-invalid={serverError ? true : undefined}
        onChange={(event) => setText(event.target.value)}
      />
      <small id={`${id}-hint`} className={serverError ? "sw-decision-error" : undefined}>
        {serverError ? `${serverError}: ${hint}` : hint}
      </small>
      <div>
        <button type="submit" className="primary" disabled={empty || busy}>
          {busy ? "Saving…" : submitLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
