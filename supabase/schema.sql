-- Cuadra — esquema de Supabase.
--
-- Córrelo completo en el SQL Editor de un proyecto nuevo. Es idempotente en lo
-- posible (IF NOT EXISTS / DROP POLICY IF EXISTS), así que se puede repetir.
--
-- Quién puede qué:
--   * El navegador usa la anon key: puede LEER groups, members y charges
--     (para eso es el QR de invitación) y suscribirse a sus cambios en vivo.
--   * Nadie con la anon key puede escribir, ni leer member_secrets (secretos y
--     teléfonos) ni webhook_events (los avisos crudos de pey traen la CLABE
--     de quien pagó).
--   * El servidor usa la service role key, que salta RLS. Todas las escrituras
--     pasan por él, después de que src/lib/groups.ts verificó quién pide.
--
-- Dinero: siempre centavos enteros (bigint). Nunca floats.

-- ── groups ──────────────────────────────────────────────────────────────────
create table if not exists public.groups (
  id          text primary key,
  name        text        not null check (char_length(name) between 1 and 60),
  total_cents bigint      not null check (total_cents > 0),
  payer_id    text        not null,
  split_mode  text        not null default 'equal' check (split_mode in ('equal', 'custom', 'own')),
  status      text        not null default 'open'  check (status in ('open', 'collecting', 'settled')),
  currency    text        not null default 'MXN'   check (currency = 'MXN'),
  created_at  timestamptz not null default now()
);

-- ── members ─────────────────────────────────────────────────────────────────
create table if not exists public.members (
  id          text primary key,
  group_id    text        not null references public.groups (id) on delete cascade,
  name        text        not null check (char_length(name) between 1 and 40),
  is_admin    boolean     not null default false,
  share_cents bigint               check (share_cents is null or share_cents >= 0),
  -- Orden de llegada. Único por grupo: dos personas que escanean a la vez no
  -- pueden quedarse con el mismo lugar.
  seat        integer     not null check (seat >= 0),
  -- Solo el servidor lo cambia, cuando pey confirma el pago.
  paid        boolean     not null default false,
  paid_at     timestamptz,
  joined_at   timestamptz not null default now(),
  unique (group_id, seat)
);
create index if not exists members_group_idx on public.members (group_id);

-- ── member_secrets ──────────────────────────────────────────────────────────
-- Lo que ningún navegador debe ver: el hash del secreto que prueba quién es
-- cada persona, y su celular (para la solicitud de cobro CoDi).
create table if not exists public.member_secrets (
  member_id   text primary key references public.members (id) on delete cascade,
  secret_hash text not null,
  phone       text check (phone is null or phone ~ '^[0-9]{10}$')
);

-- ── charges ─────────────────────────────────────────────────────────────────
-- Un cobro CoDi en pey por la parte de una persona.
--   method = 'push' → pey_charge_id es el transactionId (ULID) de POST /codi/pn
--   method = 'qr'   → pey_charge_id es el IDC del QR de POST /codi/qr
create table if not exists public.charges (
  id                 uuid primary key default gen_random_uuid(),
  group_id           text        not null references public.groups (id) on delete cascade,
  member_id          text        not null references public.members (id) on delete cascade,
  pey_charge_id      text        not null unique,
  -- groupId:memberId:n — única, para no repetir el mismo intento.
  reference          text        not null unique,
  amount_cents       bigint      not null check (amount_cents > 0),
  method             text        not null check (method in ('push', 'qr')),
  status             text        not null default 'pending'
                     check (status in ('pending', 'paid', 'expired', 'failed', 'refunded')),
  -- Lo que se codifica en la imagen del QR (solo method = 'qr').
  qr_string          text,
  -- Folio CoDi de Banxico (solo method = 'push', 20 dígitos).
  codi_id            text,
  -- La transacción de pey que lo pagó (llega en el webhook).
  pey_transaction_id text,
  simulated          boolean     not null default false,
  created_at         timestamptz not null default now(),
  paid_at            timestamptz,
  expires_at         timestamptz
);
create index if not exists charges_group_idx  on public.charges (group_id);
create index if not exists charges_member_idx on public.charges (member_id, status);

-- ── webhook_events ──────────────────────────────────────────────────────────
-- Cada aviso que llegó, tal cual, antes de tocar nada. Es la bitácora que
-- prueba que todo pago se confirmó en el servidor — incluidos los repetidos.
--
-- pey_event_id es el encabezado `webhook-id` de Standard Webhooks, que pey
-- documenta como clave de idempotencia. NO es único a propósito: un reintento
-- con el mismo id se guarda como su propia fila con result = 'duplicado,
-- ignorado', para que se vea. Lo que impide cobrar dos veces es el UPDATE
-- condicional sobre charges.status, no esta tabla.
create table if not exists public.webhook_events (
  id           uuid primary key default gen_random_uuid(),
  received_at  timestamptz not null default now(),
  pey_event_id text,
  group_id     text references public.groups (id) on delete set null,
  type         text        not null,
  payload      jsonb       not null,
  processed    boolean     not null default false,
  result       text
);
create index if not exists webhook_events_group_idx on public.webhook_events (group_id, received_at desc);
create index if not exists webhook_events_event_idx on public.webhook_events (pey_event_id);

-- ── Row-level security ──────────────────────────────────────────────────────
alter table public.groups         enable row level security;
alter table public.members        enable row level security;
alter table public.member_secrets enable row level security;
alter table public.charges        enable row level security;
alter table public.webhook_events enable row level security;

-- Lectura pública: quien tiene el enlace (el id del grupo, aleatorio) ve la
-- cuenta. Sin políticas de escritura: con la anon key no se escribe nada.
drop policy if exists "read groups"  on public.groups;
drop policy if exists "read members" on public.members;
drop policy if exists "read charges" on public.charges;
create policy "read groups"  on public.groups  for select to anon, authenticated using (true);
create policy "read members" on public.members for select to anon, authenticated using (true);
create policy "read charges" on public.charges for select to anon, authenticated using (true);
-- member_secrets y webhook_events: sin políticas = nadie salvo la service role.

-- ── Realtime ────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'groups') then
    alter publication supabase_realtime add table public.groups;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'members') then
    alter publication supabase_realtime add table public.members;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'charges') then
    alter publication supabase_realtime add table public.charges;
  end if;
end $$;
