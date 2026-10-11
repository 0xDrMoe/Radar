"use client";
import { useState } from "react";
import { Download, PlugZap, ShieldCheck, Smartphone } from "lucide-react";
import { useWorkspace, useTabState } from "../workspace";
import { EMPTY_GEO, GeoFilter, StatePanel, PanelHeader, type GeoFilterValue } from "../ui";

// THE DEVELOPER SECTION.
// What only the developer role (and owners) need: which services are configured, why email
// delivery is or is not possible, how test purchases show up, and the CSV exports. The server sends
// the integration detail only to developer_tools holders and builds every export itself
// (app/api/admin/export/route.ts), so nothing here is a client-side gate on its own.

type ExportKind = "deals" | "restaurants" | "users" | "subscribers" | "audit";

const READINESS = [
  ["pilotEnabled", "Email pilot switched on", "EMAIL_PILOT_ENABLED=true"],
  ["killSwitchClear", "Kill switch cleared", "EMAIL_KILL_SWITCH=false"],
  ["providerConfigured", "Email provider configured", "RESEND_API_KEY + RESEND_FROM_EMAIL"],
  ["signingConfigured", "Link signing key set", "EMAIL_UNSUBSCRIBE_SECRET"],
] as const;

const DEAL_STATUSES = ["", "live", "draft", "scheduled", "paused", "expired", "archived"];

export default function DeveloperTab() {
  const { data, permissions, canUseDeveloperTools, canExport, isAdminPlus } = useWorkspace();
  const [dealStatus, setDealStatus] = useTabState("developer.dealStatus", "");
  const [place, setPlace] = useTabState<GeoFilterValue>("developer.place", EMPTY_GEO);
  const [exporting, setExporting] = useState<ExportKind | "">("");
  const [result, setResult] = useState<{ kind: "error" | "done"; text: string } | null>(null);
  const integrations = data.integrations || {};

  // Which datasets this person may export: export_data plus the dataset's own read permission,
  // the same pairing the export route checks. Shown so a refusal is never the first explanation.
  const datasets: { kind: ExportKind; label: string; detail: string; allowed: boolean; why: string }[] = [
    { kind: "deals", label: "Deals", detail: "Every deal matching the filters below, up to 2,000 rows.", allowed: canExport, why: "" },
    { kind: "restaurants", label: "Restaurants", detail: "Name, website, place, status and whether there is a photo.", allowed: canExport, why: "" },
    { kind: "users", label: "Users", detail: "Accounts with role, plan and postal code. Personal data.", allowed: canExport && permissions.has("manage_users"), why: "Also needs permission to manage users." },
    { kind: "subscribers", label: "Mailing list", detail: "People with confirmed alert emails. Personal data.", allowed: canExport && permissions.has("manage_email"), why: "Also needs permission to manage the mailing list." },
    { kind: "audit", label: "Audit log", detail: "The most recent 2,000 audit events.", allowed: canExport && isAdminPlus, why: "Also needs the owner or admin role." },
  ];

  async function runExport(kind: ExportKind) {
    setExporting(kind);
    setResult(null);
    const params = new URLSearchParams({ kind });
    if (kind === "deals") {
      if (dealStatus) params.set("status", dealStatus);
      if (place.city) params.set("city", place.city);
      if (place.region) params.set("region", place.region);
      if (place.country) params.set("country", place.country);
    }
    try {
      const response = await fetch(`/api/admin/export?${params}`);
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message || "The export could not be made.");
      }
      const rows = Number(response.headers.get("x-export-rows") || 0);
      const blob = await response.blob();
      const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") || "")?.[1] || `radar-${kind}.csv`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      URL.revokeObjectURL(url);
      setResult({ kind: "done", text: `Exported ${rows} row${rows === 1 ? "" : "s"} to ${name}. The export is recorded in the audit log.${rows >= 2000 ? " That is the limit for one file; narrow the filters for the rest." : ""}` });
    } catch (cause) {
      setResult({ kind: "error", text: cause instanceof Error ? cause.message : "The export could not be made." });
    } finally {
      setExporting("");
    }
  }

  return (
    <>
      {canUseDeveloperTools ? (
        <section className="portal-card sw-dev">
          <PanelHeader title="Integrations">Which outside services this deployment is configured to use. Values are never shown, only whether each is set.</PanelHeader>
          <ul className="sw-dev-checks">
            {([
              ["Mapbox (maps and geocoding)", integrations.mapbox, "MAPBOX_ACCESS_TOKEN"],
              ["Resend (email delivery)", integrations.resend, "RESEND_API_KEY"],
              ["Email pilot", integrations.emailPilot, "EMAIL_PILOT_ENABLED=true"],
            ] as const).map(([label, ok, hint]) => (
              <li key={label} className={ok ? "ready" : "missing"}>
                <PlugZap aria-hidden="true" />
                <span>{label}<small>{hint}</small></span>
                <b>{ok ? "Configured" : "Not set"}</b>
              </li>
            ))}
          </ul>
          <PanelHeader title="Email delivery readiness">
            {integrations.deliveryReady
              ? "Every safety rail is in place: invitations and digests can be sent."
              : "Delivery is off. Staff on the Mailing list see only that invitations cannot be sent; this is why."}
          </PanelHeader>
          <ul className="sw-dev-checks">
            {READINESS.map(([key, label, hint]) => {
              const ok = integrations.deliveryReadiness?.[key];
              return (
                <li key={key} className={ok ? "ready" : "missing"}>
                  <ShieldCheck aria-hidden="true" />
                  <span>{label}<small>{hint}</small></span>
                  <b>{ok ? "Ready" : "Missing"}</b>
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <StatePanel kind="empty" title="Integration status is for the developer role.">Exports below are still available to you.</StatePanel>
      )}

      {canUseDeveloperTools && (
        <section className="portal-card sw-dev">
          <PanelHeader title="Test purchases and app review">How Pro that nobody paid for shows up, so it is not mistaken for revenue.</PanelHeader>
          <div className="sw-dev-note">
            <Smartphone aria-hidden="true" />
            <div>
              <p>Purchases made in Apple&apos;s sandbox (App Review, TestFlight testers) and comped accounts give real Pro but are not subscriptions. The Admin section counts them as &quot;Pro (not paying)&quot;, never as paying customers.</p>
              <p>An App Review account that must see paid features is given Pro with a comp in Admin, with a reason, and that grant is audited. Stripe test-mode payments never reach production; check the Stripe dashboard&apos;s test mode for them.</p>
            </div>
          </div>
        </section>
      )}

      <section className="portal-card sw-dev">
        <PanelHeader title="Exports">
          Made on the server, limited to what your role can read, and recorded in the audit log with the filters used. Nothing is exported from the browser.
        </PanelHeader>
        {!canExport ? (
          <StatePanel kind="empty" title="Exports are for the developer role.">Ask a developer or an owner for the file you need.</StatePanel>
        ) : (
          <>
            <div className="sw-dev-filters">
              <label>
                <span>Deal status</span>
                <select value={dealStatus} onChange={(event) => setDealStatus(event.target.value)}>
                  {DEAL_STATUSES.map((status) => <option key={status} value={status}>{status || "Any status"}</option>)}
                </select>
              </label>
              <GeoFilter
                label="Export deals from"
                value={place}
                onChange={setPlace}
                places={data.deals.map((deal) => ({ country: deal.location_country, region: deal.location_region, city: deal.city }))}
              />
            </div>
            <ul className="sw-dev-exports">
              {datasets.map((dataset) => (
                <li key={dataset.kind}>
                  <div>
                    <b>{dataset.label}</b>
                    <small>{dataset.allowed ? dataset.detail : dataset.why}</small>
                  </div>
                  <button className="tool-button" disabled={!dataset.allowed || Boolean(exporting)} onClick={() => runExport(dataset.kind)}>
                    <Download aria-hidden="true" /> {exporting === dataset.kind ? "Exporting…" : "Export CSV"}
                    <span className="sr-only"> of {dataset.label}</span>
                  </button>
                </li>
              ))}
            </ul>
            {result && <StatePanel kind={result.kind === "error" ? "error" : "success"} title={result.kind === "error" ? "Export failed" : "Export ready"}>{result.text}</StatePanel>}
          </>
        )}
      </section>
    </>
  );
}
