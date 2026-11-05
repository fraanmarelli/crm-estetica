import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROLE_LABEL } from "@/lib/format";
import type { Role } from "@/lib/types";
import { AcceptForm } from "./accept-form";

export const metadata: Metadata = { title: "Invitación", robots: { index: false, follow: false } };

// Página pública para aceptar una invitación al CRM
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const { data } = await admin
    .from("member_invites")
    .select("email, role, branch:branches(name), organization:organizations(name, settings)")
    .eq("token", token)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  const invite = data as unknown as {
    email: string;
    role: Role;
    branch: { name: string } | null;
    organization: { name: string; settings: { brand?: { logo_url?: string } } } | null;
  } | null;

  let hasAccount = false;
  if (invite) {
    const { data: existing } = await admin.rpc("auth_user_id_by_email", { p_email: invite.email });
    hasAccount = Boolean(existing);
  }
  const orgName = invite?.organization?.name ?? "el CRM";
  const logo = invite?.organization?.settings?.brand?.logo_url;

  return (
    <main
      className="mx-auto min-h-screen max-w-md space-y-6 pb-12 pt-8"
      style={{
        paddingLeft: "max(16px, env(safe-area-inset-left, 0px))",
        paddingRight: "max(16px, env(safe-area-inset-right, 0px))",
      }}
    >
      <header className="flex flex-col items-center gap-3 rounded-2xl bg-chrome px-4 py-6 text-center text-chrome-ink">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt={orgName} className="h-auto w-32" />
        ) : (
          <span className="gold-text font-display text-3xl">{orgName}</span>
        )}
      </header>

      {invite ? (
        <>
          <div>
            <h1>Te invitaron al CRM</h1>
            <p className="page-sub">
              {orgName}
              {invite.branch ? ` ${invite.branch.name}` : ""} · {ROLE_LABEL[invite.role]}
            </p>
          </div>
          <AcceptForm token={token} email={invite.email} hasAccount={hasAccount} />
        </>
      ) : (
        <div className="card space-y-2 text-center">
          <h1>Esta invitación ya no funciona</h1>
          <p className="text-muted">Ya se usó, venció o fue anulada. Pedile una nueva a quien te invitó.</p>
        </div>
      )}
    </main>
  );
}
