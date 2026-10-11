"use client";
import { useMemo } from "react";
import {
  ALL_PERMISSIONS,
  formatRole,
  PERMISSION_DESCRIPTIONS,
  PRESET_GRID_ROLES,
  ROLE_DESCRIPTIONS,
} from "../../permissions";
import { useWorkspace } from "./workspace";

/**
 * The Roles & permissions grid: which preset role holds which permission.
 *
 * It used to sit at the bottom of the Users tab, drawn for the owner alone. It is about the team's
 * access model rather than any one account, so it now lives in its own component for the Admin
 * area. Owners and admins can read it (GET /api/admin sends rolePermissions to both); only the
 * owner can change a cell, which the server enforces in set_role_permission whatever this draws.
 *
 * Per-person custom permissions are not here: they are chosen in the Users tab's role dialog, on
 * the one account they apply to.
 */
export function RolesGrid() {
  const { data, busy, action, isOwner, isAdminPlus } = useWorkspace();
  const roleGrants = useMemo(
    () => new Set((data?.rolePermissions || []).map((rp) => `${rp.role}:${rp.permission}`)),
    [data?.rolePermissions],
  );
  if (!isAdminPlus) return null;
  return (
    <section className="portal-card permissions-grid-card">
      <div className="portal-card-head">
        <div>
          <span className="kicker">ACCESS CONTROL</span>
          <h2>Roles &amp; permissions</h2>
          <p>
            What each preset role can do. Everyone with that role follows its column.
            {isOwner ? " Changes apply the next time each person loads a page, and every change is in the audit log." : " Only an owner can change these."}
          </p>
        </div>
      </div>
      <div className="permissions-grid-scroll">
        <table className="permissions-grid">
          <thead>
            <tr>
              <th scope="col">Permission</th>
              {PRESET_GRID_ROLES.map((r) => (
                <th scope="col" key={r} title={ROLE_DESCRIPTIONS[r]}>
                  {formatRole(r)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ALL_PERMISSIONS.map((permission) => (
              <tr key={permission}>
                <th scope="row" title={PERMISSION_DESCRIPTIONS[permission]}>
                  {formatRole(permission)}
                </th>
                {PRESET_GRID_ROLES.map((r) => {
                  const granted = roleGrants.has(`${r}:${permission}`);
                  const cellKey = `set_role_permission-${r}:${permission}`;
                  return (
                    <td key={r}>
                      <input
                        type="checkbox"
                        checked={granted}
                        disabled={!isOwner || busy === cellKey}
                        aria-label={`${formatRole(r)}: ${formatRole(permission)}`}
                        title={isOwner ? `${granted ? "Revoke" : "Grant"} ${formatRole(permission)} for ${formatRole(r)}` : `${formatRole(r)} ${granted ? "has" : "does not have"} ${formatRole(permission)}`}
                        onChange={() =>
                          action({
                            action: "set_role_permission",
                            id: `${r}:${permission}`,
                            role: r,
                            permission,
                            granted: !granted,
                          })
                        }
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
