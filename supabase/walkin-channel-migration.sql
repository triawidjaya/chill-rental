-- =============================================================
-- Chill Rental — Walk-in vs Online channel detection (server-side)
-- Run ONCE in the Supabase SQL Editor. Re-runnable & fully additive:
-- no DDL on bookings/rentals, no data backfill, zero risk to guest data.
--
-- What it adds:
--   1. pgcrypto (for hmac + gen_random_bytes)
--   2. public.app_secrets         — locked-down secret store (no RLS policy)
--   3. public.mint_walkin_token() — staff-only (authenticated) token minter
--   4. public.submit_booking()    — REPLACED: verifies the walk-in token and
--                                   stamps data->>'channel' = 'online' | 'walk-in'
--
-- Channel logic at submit time:
--   valid, unexpired token  -> channel = 'walk-in'
--   no / invalid / expired  -> channel = 'online'   (never rejects the booking)
-- =============================================================

-- 1. Extension ------------------------------------------------
create extension if not exists pgcrypto;

-- 2. Secret store (intentionally NO RLS policy -> anon & authenticated
--    cannot read/write; only SECURITY DEFINER functions bypass RLS). -----
create table if not exists public.app_secrets (
  key   text primary key,
  value text not null
);
alter table public.app_secrets enable row level security;

insert into public.app_secrets (key, value)
values ('walkin_hmac', encode(gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

-- 3. Staff-only token minter ----------------------------------
--    Returns "<expiry_epoch>.<hmac_sha256_hex>". The secret never leaves
--    the database; the browser only ever sees the signed token.
create or replace function public.mint_walkin_token(ttl_seconds int default 1800)
returns text
language plpgsql
security definer
-- `extensions` is on the path so pgcrypto's hmac() resolves: Supabase installs
-- pgcrypto in the `extensions` schema, not `public`.
set search_path = public, extensions
as $$
declare
  v_secret text;
  v_exp    bigint := extract(epoch from now())::bigint + ttl_seconds;
begin
  select value into v_secret from public.app_secrets where key = 'walkin_hmac';
  if v_secret is null then raise exception 'walkin secret missing'; end if;
  return v_exp::text || '.' || encode(hmac(v_exp::text, v_secret, 'sha256'), 'hex');
end $$;

revoke all on function public.mint_walkin_token(int) from public;
grant execute on function public.mint_walkin_token(int) to authenticated;  -- staff login only

-- 4. submit_booking — REPLACED. Identical to the current version except the
--    three blocks marked [BARU]: token vars, token verification, channel field.
create or replace function public.submit_booking(p jsonb)
returns text
language plpgsql
security definer
-- `extensions` on the path so pgcrypto's hmac() (walk-in token check) resolves.
set search_path = public, extensions
as $$
declare
  v_name    text := nullif(btrim(left(coalesce(p->>'guestName',''), 120)), '');
  v_wa      text := nullif(btrim(left(coalesce(p->>'wa',''),         40)), '');
  v_email   text := nullif(btrim(left(coalesce(p->>'email',''),     160)), '');
  v_pass    text := btrim(left(coalesce(p->>'passportNo',''),        60));
  v_cc      text := btrim(coalesce(p->>'ccClass',''));
  v_surf    boolean := coalesce((p->>'surfrack')::boolean, false);
  v_start   text := nullif(btrim(coalesce(p->>'startDate','')), '');
  v_finish  text := nullif(btrim(coalesce(p->>'finishDate','')), '');
  v_tver    text := nullif(btrim(coalesce(p->>'agreedTermsVersion','')), '');
  v_agreed  text := nullif(btrim(coalesce(p->>'agreedAt','')), '');
  v_price   integer;
  v_alpha   text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- tanpa O/0/I/1 (anti-ambigu)
  v_code    text;
  v_id      text;
  v_now     timestamptz := now();
  i         integer;
  -- [BARU] channel detection
  v_token   text := nullif(btrim(coalesce(p->>'walkinToken','')), '');
  v_channel text := 'online';
  v_secret  text;
  v_exp     bigint;
begin
  -- Validasi wajib
  if v_name is null then raise exception 'guestName is required'; end if;
  if v_wa   is null then raise exception 'wa is required';        end if;
  if v_email is null or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
    then raise exception 'valid email is required'; end if;
  if v_tver is null then raise exception 'agreedTermsVersion is required'; end if;

  -- [BARU] Verifikasi token walk-in (jika ada). Gagal verifikasi -> tetap
  -- 'online'; booking TIDAK pernah ditolak hanya karena token bermasalah.
  if v_token is not null then
    select value into v_secret from public.app_secrets where key = 'walkin_hmac';
    begin
      v_exp := split_part(v_token, '.', 1)::bigint;
    exception when others then
      v_exp := 0;
    end;
    if v_secret is not null
       and v_exp >= extract(epoch from v_now)::bigint
       and split_part(v_token, '.', 2) = encode(hmac(v_exp::text, v_secret, 'sha256'), 'hex')
    then
      v_channel := 'walk-in';
    end if;
  end if;

  -- Harga ditetapkan server-side dari kelas CC (info ke tamu). Kelas di luar
  -- daftar publik ditolak — 155/160 hanya lewat jalur manual staf.
  v_price := case v_cc
               when '110 - 125' then 70000
               when '150'       then 150000
               else null
             end;
  if v_price is null then raise exception 'unsupported ccClass'; end if;

  -- Generate kode pendek unik (4 char). Beberapa percobaan jika bentrok.
  for i in 1..20 loop
    v_code := '';
    for _ in 1..4 loop
      v_code := v_code || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1);
    end loop;
    exit when not exists (
      select 1 from public.bookings b where b.data->>'code' = v_code
    );
    v_code := null;
  end loop;
  if v_code is null then raise exception 'could not allocate booking code'; end if;

  v_id := 'bkg_' || replace(gen_random_uuid()::text, '-', '');

  insert into public.bookings (id, data, updated_at)
  values (
    v_id,
    jsonb_build_object(
      'id',                 v_id,
      'code',               v_code,
      'status',             'pending',
      'channel',            v_channel,          -- [BARU] 'online' | 'walk-in'
      'agreedTermsVersion', v_tver,
      'agreedAt',           coalesce(v_agreed, to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
      'guestName',          v_name,
      'wa',                 v_wa,
      'email',              v_email,
      'passportNo',         v_pass,
      'ccClass',            v_cc,
      'surfrack',           v_surf,
      'startDate',          v_start,
      'finishDate',         v_finish,
      'quotedPricePerDay',  v_price,
      'assignedMotorId',    null,
      'rejectionReason',    null,
      'rentalId',           null,
      'submittedAt',        to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'confirmedAt',        null,
      'checkedInAt',        null,
      'createdAt',          to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'updatedAt',          to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ),
    v_now
  );

  return v_code;
end $$;

-- Anon hanya boleh MEMANGGIL fungsi ini — tidak ada akses tabel.
revoke all on function public.submit_booking(jsonb) from public;
grant execute on function public.submit_booking(jsonb) to anon, authenticated;
