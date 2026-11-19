-- =====================================================================
-- Mercado Pago: una cuenta de MP no puede quedar conectada a dos cuentas de cobro de la
-- misma sucursal, y se guarda a nombre de quién quedó (nombre y mail de la cuenta de MP)
-- para que en Ajustes se vea enseguida si se conectó la equivocada.
-- (Si el navegador ya tenía abierta una cuenta de MP que autorizó la app, MP no vuelve a
-- preguntar y conecta esa: este control evita que se pise la cuenta de otra persona.)
-- =====================================================================

alter table public.mp_connections
  add column if not exists mp_name text,
  add column if not exists mp_email text;

-- Si ya hubiera repetidas, queda la más vieja (la que estaba primero)
delete from public.mp_connections c
 using public.mp_connections older
 where c.branch_id = older.branch_id
   and c.mp_user_id = older.mp_user_id
   and (older.created_at, older.id) < (c.created_at, c.id);

create unique index if not exists mp_connections_branch_user_key
  on public.mp_connections (branch_id, mp_user_id);
