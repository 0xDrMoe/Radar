"use client";
import DraftReview from "../DraftReview";
import type { DraftReviewRow } from "../../../draft-review";
import type { AdminData } from "../types";
import { useWorkspace } from "../workspace";

export default function DraftsTab() {
  const {
    data, now, load, openEditor, setNotice, canCreateDeals, canPublishDeals, canVerifyDeals,
  } = useWorkspace();
  // The editor opens over this tab rather than switching to the inventory, so the reviewer's place
  // in the draft list is still there when they close it. A draft past the 500 loaded deals is
  // fetched on its own through the inventory's server search first.
  async function editDraft(draft: DraftReviewRow) {
    const loaded = data.deals.find((deal) => deal.id === draft.id);
    if (loaded) return openEditor(loaded);
    try {
      const params = new URLSearchParams({ deal_q: draft.restaurant, deal_status: "draft" });
      const response = await fetch(`/api/admin?${params}`);
      if (!response.ok) throw new Error();
      const found = ((await response.json()) as Pick<AdminData, "deals">).deals.find((deal) => deal.id === draft.id);
      if (found) return openEditor(found);
      setNotice(`${draft.restaurant} (${draft.title}) could not be found to edit. It may have just been published or archived.`);
    } catch {
      setNotice("The draft could not be loaded for editing. Please try again.");
    }
  }
  return (
    <DraftReview
      drafts={data.draftReview || []}
      now={now}
      canPublish={canPublishDeals}
      canVerify={canVerifyDeals}
      canEdit={canCreateDeals}
      onEdit={editDraft}
      onChanged={async () => (await load())?.draftReview || null}
    />
  );
}
