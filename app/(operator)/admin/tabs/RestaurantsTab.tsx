"use client";
import { useState } from "react";
import {
  Store,
  Upload,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import { DialogFocus } from "../../DialogFocus";
import { ListCount, ListEmpty, ListToolbar, listCountLabel, Pager, pageRows, selectRows } from "../../ListScope";
import RestaurantEditsQueue from "../RestaurantEditsQueue";
import { shrinkPhotoForUpload } from "../../../photo-resize";
import { photoSrc } from "../../../photo-url";
import type { AdminRestaurant, InviteResult } from "../types";
import { useListScope, useWorkspace } from "../workspace";

export default function RestaurantsTab() {
  const { data, busy, setBusy, setNotice, load, action, permissions, setConfirmDialog, canManageUsers } = useWorkspace();
  const { listQueryFor, setListQueryFor, pageFor, setPageFor } = useListScope();
  const [photoDialog, setPhotoDialog] = useState<AdminRestaurant | null>(null),
    [photoUrlInput, setPhotoUrlInput] = useState(""),
    [photoUploading, setPhotoUploading] = useState(false),
    [inviteDialog, setInviteDialog] = useState<AdminRestaurant | null>(null),
    [inviteEmail, setInviteEmail] = useState(""),
    [inviteResult, setInviteResult] = useState<InviteResult | null>(null);
  const restaurantList = selectRows(data?.restaurants || [], (row) => `${row.name} ${row.website || ""}`,
    { query: listQueryFor("restaurants"), showAll: true });
  const restaurantPage = pageRows(restaurantList.matched, pageFor("restaurants", listQueryFor("restaurants")));
  const canManageRestaurantPhotos = permissions.has("manage_restaurant_photos");
  async function inviteManager(restaurantId: string, email: string) {
    setBusy(`invite-${restaurantId}`);
    setNotice("");
    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "invite_restaurant_manager", restaurantId, email }),
      });
      const result = await response.json() as { error?: { message?: string }; invite?: InviteResult };
      if (!response.ok) throw new Error(result?.error?.message || "Invitation could not be sent.");
      await load();
      return result.invite ?? null;
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Invitation could not be sent.");
      return null;
    } finally {
      setBusy("");
    }
  }
  async function uploadRestaurantPhoto(restaurantId: string, file: File) {
    setPhotoUploading(true);
    setNotice("");
    try {
      // Stored at card size rather than as chosen; see app/photo-resize.ts.
      const photo = await shrinkPhotoForUpload(file);
      const response = await fetch(`/api/admin/photo-upload?restaurantId=${encodeURIComponent(restaurantId)}`, {
        method: "POST",
        headers: { "content-type": photo.type },
        body: photo,
      });
      const result = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(result?.error?.message || "Photo upload failed.");
      await load();
      setNotice("Photo updated.");
      setPhotoDialog(null);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Photo upload failed.");
    } finally {
      setPhotoUploading(false);
    }
  }
  return (
    <>
      <RestaurantEditsQueue
        requests={data.dealChangeRequests || []}
        busy={busy}
        onDecide={async (id, decision, notes) => Boolean(await action({ action: "review_deal_change", id, status: decision, notes }))}
      />
      <section className="portal-card">
        <ListToolbar query={listQueryFor("restaurants")} onQuery={setListQueryFor("restaurants")} placeholder="Search by restaurant or website" label="Search restaurants" />
        <ListCount>{listCountLabel(restaurantList, data.restaurants.length, "restaurant", true)}</ListCount>
        <div className="inventory-table restaurant-manager-table">
          <div className="table-head">
            <span>Restaurant</span>
            <span>Manager</span>
            <span>Actions</span>
          </div>
          {restaurantPage.rows.map((r) => {
            const manager = data.restaurantManagers?.find((m) => m.restaurant_id === r.id);
            return (
              <article key={r.id}>
                <div className="restaurant-cell">
                  {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary admin-set external photo URL */}
                  {r.photo_url ? <img className="restaurant-photo-thumb" src={photoSrc(r.photo_url)} alt="" /> : <i>{(r.name || "?")[0].toUpperCase()}</i>}
                  <span>
                    <b title={r.name}>{r.name}</b>
                    <small title={r.website || undefined}>{r.website || "No website on file"}</small>
                  </span>
                </div>
                <div>
                  <b>{manager ? (manager.user_name || manager.user_email || manager.invited_email) : "No manager"}</b>
                  <small title={manager && manager.status !== "active" ? manager.invited_email : undefined}>
                    {manager ? (manager.status === "active" ? "Active manager" : `Invited · ${manager.invited_email}`) : "Not yet registered"}
                  </small>
                </div>
                <div className="row-actions">
                  <button
                    disabled={!canManageRestaurantPhotos}
                    onClick={() => { setPhotoDialog(r); setPhotoUrlInput(r.photo_url || ""); }}
                  >
                    <Upload /> Set photo
                  </button>
                  {manager && manager.status !== "revoked" ? (
                    <button
                      disabled={!canManageUsers || busy === `revoke_restaurant_manager-${manager.id}`}
                      onClick={() => setConfirmDialog({
                        title: "Revoke this manager?",
                        body: `This immediately removes portal access for the manager of ${r.name}. They will need a fresh invitation to get back in.`,
                        confirmLabel: "Revoke access",
                        busyKey: `revoke_restaurant_manager-${manager.id}`,
                        run: () => action({ action: "revoke_restaurant_manager", id: manager.id }),
                      })}
                    >
                      <UserMinus /> Revoke manager
                    </button>
                  ) : (
                    <button
                      disabled={!canManageUsers}
                      onClick={() => { setInviteDialog(r); setInviteEmail(""); setInviteResult(null); }}
                    >
                      <UserPlus /> Invite manager
                    </button>
                  )}
                </div>
              </article>
            );
          })}
          {!data.restaurants.length ? (
            <div className="portal-empty">
              <Store />
              <h3>No restaurants yet</h3>
              <p>Restaurants are created automatically when a deal is added.</p>
            </div>
          ) : !restaurantList.visible.length ? (
            <ListEmpty>No restaurant matches that search.</ListEmpty>
          ) : null}
        </div>
        <Pager paged={restaurantPage} noun="restaurant" onPage={setPageFor("restaurants", listQueryFor("restaurants"))} />
      </section>
      {photoDialog && <div className="overlay" onMouseDown={() => setPhotoDialog(null)}><section className="modal confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="photo-title" onMouseDown={(event) => event.stopPropagation()}><DialogFocus onClose={() => setPhotoDialog(null)} /><button className="close" aria-label="Close" onClick={() => setPhotoDialog(null)}><X/></button><span className="kicker">RESTAURANT PHOTO</span><h2 id="photo-title">{photoDialog.name}</h2>{photoDialog.photo_url && <img className="restaurant-photo-preview" src={photoSrc(photoDialog.photo_url)} alt=""/>}<label className="typed-confirmation">Image URL<input value={photoUrlInput} onChange={(event) => setPhotoUrlInput(event.target.value)} placeholder="https://…" autoComplete="off"/></label><label className="typed-confirmation">Or upload a file<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadRestaurantPhoto(photoDialog.id,file); }} disabled={photoUploading}/></label><div className="editor-actions"><button onClick={() => setPhotoDialog(null)}>Cancel</button><button className="primary" disabled={busy === `set_restaurant_photo-${photoDialog.id}`} onClick={async () => { if (await action({action:"set_restaurant_photo",id:photoDialog.id,photoUrl:photoUrlInput})) setPhotoDialog(null); }}>Save URL</button></div></section></div>}{/* eslint-disable-line jsx-a11y/no-static-element-interactions, jsx-a11y/no-noninteractive-element-interactions, @next/next/no-img-element -- backdrop click-to-dismiss is a mouse convenience; photo URL is an arbitrary admin-set external image */}
      {inviteDialog && <div className="overlay" onMouseDown={() => setInviteDialog(null)}><section className="modal confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="invite-title" onMouseDown={(event) => event.stopPropagation()}><DialogFocus onClose={() => setInviteDialog(null)} /><button className="close" aria-label="Close" onClick={() => setInviteDialog(null)}><X/></button><span className="kicker">RESTAURANT PORTAL</span><h2 id="invite-title">Invite a manager for {inviteDialog.name}</h2>{!inviteResult ? <><label className="typed-confirmation">Manager email<input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="owner@restaurant.com" autoComplete="off"/></label><div className="editor-actions"><button onClick={() => setInviteDialog(null)}>Cancel</button><button className="primary" disabled={!inviteEmail.trim() || busy === `invite-${inviteDialog.id}`} onClick={async () => { const invite = await inviteManager(inviteDialog.id,inviteEmail); if (invite) setInviteResult(invite); }}>Send invitation</button></div></> : <><p>{inviteResult.delivered ? "The invitation email was sent." : "Email delivery is pilot-restricted — share this link with them directly."}</p><label className="typed-confirmation">Invite link<input readOnly value={inviteResult.link} onFocus={(event) => event.target.select()}/></label><div className="editor-actions"><button className="primary" onClick={() => setInviteDialog(null)}>Done</button></div></>}</section></div>}{/* eslint-disable-line jsx-a11y/no-static-element-interactions, jsx-a11y/no-noninteractive-element-interactions -- backdrop click-to-dismiss is a mouse convenience; the close button above is the keyboard-accessible dismissal */}
    </>
  );
}
