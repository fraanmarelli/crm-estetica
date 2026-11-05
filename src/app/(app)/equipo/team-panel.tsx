import { createClient } from "@/lib/supabase/server";
import { fmtDate, ROLE_LABEL } from "@/lib/format";
import type { Role } from "@/lib/types";
import { revokeInvite } from "./actions";
import { InviteForm } from "./invite-form";
import { RemoveMemberButton } from "./member-row";

type Member = {
  membership_id: string;
  user_id: string;
  email: string;
  role: Role;
  created_at: string;
  last_sign_in_at: string | null;
};
type Invite = { id: string; email: string; role: Role; expires_at: string; created_at: string };

// Equipo de una sucursal (branchId) o de la marca (branchId null): quiénes entran, invitaciones e invitar
export async function TeamPanel({
  orgId,
  orgName,
  branchId,
  roles,
  currentUserId,
}: {
  orgId: string;
  orgName: string;
  branchId: string | null;
  roles: Role[];
  currentUserId: string;
}) {
  const supabase = await createClient();
  const invitesQuery = supabase
    .from("member_invites")
    .select("id, email, role, expires_at, created_at")
    .eq("organization_id", orgId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });

  const [{ data: memberData, error }, { data: inviteData }, { data: profData }] = await Promise.all([
    supabase.rpc("team_members", { p_org: orgId, p_branch: branchId }),
    branchId ? invitesQuery.eq("branch_id", branchId) : invitesQuery.is("branch_id", null),
    branchId
      ? supabase
          .from("professionals")
          .select("id, full_name, user_id")
          .eq("organization_id", orgId)
          .eq("is_active", true)
          .is("user_id", null)
          .or(`branch_id.is.null,branch_id.eq.${branchId}`)
          .order("full_name")
      : Promise.resolve({ data: [] }),
  ]);
  const members = (memberData ?? []) as Member[];
  const invites = (inviteData ?? []) as Invite[];

  if (error) return <p className="alert-error">No se pudo cargar el equipo: {error.message}</p>;

  return (
    <div className="space-y-5">
      <ul className="divide-y divide-line">
        {members.map((m) => (
          <li key={m.membership_id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
            <div className="min-w-0">
              <p className="truncate font-semibold">
                {m.email}
                {m.user_id === currentUserId && <span className="font-normal text-muted"> (vos)</span>}
              </p>
              <p className="text-xs text-muted">
                {ROLE_LABEL[m.role]} · {m.last_sign_in_at ? `entró por última vez el ${fmtDate(m.last_sign_in_at)}` : "todavía no entró"}
              </p>
            </div>
            {m.user_id !== currentUserId && roles.includes(m.role) && (
              <RemoveMemberButton id={m.membership_id} email={m.email} />
            )}
          </li>
        ))}
        {invites.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
            <div className="min-w-0">
              <p className="truncate font-semibold text-muted">{i.email}</p>
              <p className="text-xs text-muted">
                {ROLE_LABEL[i.role]} · invitación pendiente, vence el {fmtDate(i.expires_at)}
              </p>
            </div>
            <form action={revokeInvite}>
              <input type="hidden" name="id" value={i.id} />
              <button className="text-xs text-muted hover:text-bad">Anular invitación</button>
            </form>
          </li>
        ))}
        {members.length === 0 && invites.length === 0 && (
          <li className="py-2.5 text-sm text-muted">Todavía no hay nadie. Invitá a la primera persona abajo.</li>
        )}
      </ul>

      <div className="space-y-2 border-t border-line pt-4">
        <h3 className="text-sm font-semibold">Invitar a alguien</h3>
        <InviteForm
          roles={roles}
          orgName={orgName}
          fixedBranchId={branchId ?? undefined}
          professionals={((profData ?? []) as { id: string; full_name: string }[]).map((p) => ({ id: p.id, full_name: p.full_name }))}
        />
      </div>
    </div>
  );
}
