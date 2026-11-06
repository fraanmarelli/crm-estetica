-- =====================================================================
-- Seguimiento de leads: quién le escribió, cuándo y cuántas veces.
-- Escribirle por WhatsApp lo pasa a «Escritos · esperando respuesta»;
-- «Deshacer» lo devuelve si no se llegó a mandar.
-- =====================================================================

alter table public.leads
  add column contacted_by uuid references auth.users(id) on delete set null,
  add column contacted_by_email text,
  add column contact_count integer not null default 0;

update public.leads set contact_count = 1 where contacted_at is not null and contact_count = 0;

-- Se le escribió (primera vez o de nuevo). Corre con los permisos del usuario: RLS de leads.
create or replace function public.mark_lead_contacted(p_lead uuid)
returns void language sql security invoker set search_path = public as $$
  update leads
     set status = case when status = 'new' then 'contacted' else status end,
         contacted_at = now(),
         contacted_by = auth.uid(),
         contacted_by_email = auth.jwt() ->> 'email',
         contact_count = contact_count + 1
   where id = p_lead and status in ('new', 'contacted');
$$;
revoke execute on function public.mark_lead_contacted(uuid) from public, anon;
grant execute on function public.mark_lead_contacted(uuid) to authenticated;

-- Deshacer el último «Escribirle» (se abrió WhatsApp pero no se mandó)
create or replace function public.undo_lead_contacted(p_lead uuid)
returns void language sql security invoker set search_path = public as $$
  update leads
     set contact_count = greatest(contact_count - 1, 0),
         status = case when contact_count <= 1 then 'new' else status end,
         contacted_at = case when contact_count <= 1 then null else contacted_at end,
         contacted_by = case when contact_count <= 1 then null else contacted_by end,
         contacted_by_email = case when contact_count <= 1 then null else contacted_by_email end
   where id = p_lead and status = 'contacted';
$$;
revoke execute on function public.undo_lead_contacted(uuid) from public, anon;
grant execute on function public.undo_lead_contacted(uuid) to authenticated;
