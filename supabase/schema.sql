-- =============================================================
-- Chill Rental — Supabase schema (offline-first sync, MVP single-business)
-- Pola "sync the blob": tiap koleksi = 1 baris per record berisi JSON utuh.
--   id          text  -> uid() dari client (bukan auto-increment)
--   data        jsonb -> seluruh objek record
--   updated_at  -> dasar conflict resolution (last-write-wins)
--   deleted_at  -> soft delete (tombstone) supaya hapus ikut ter-sync
--
-- Cara pakai: Supabase Dashboard -> SQL Editor -> paste semua -> Run.
-- Re-runnable (aman dijalankan ulang).
--
-- KEAMANAN: policy di bawah memberi akses ke role `authenticated` saja — yaitu
-- klien yang sudah login lewat akun bisnis (Supabase Auth email/password).
-- Anon key sendiri TIDAK bisa baca/tulis data, jadi aman ikut ter-deploy.
-- (Jika DB lama Anda masih pakai policy anon, jalankan supabase/auth-rls.sql.)
-- 'settings' (tema/bahasa) sengaja TIDAK disertakan — itu preferensi per-perangkat.
-- =============================================================

do $$
declare
  t text;
  tables text[] := array['motors','rentals','owners','damages','staff','audit_log','bookings'];
begin
  foreach t in array tables
  loop
    -- 1) Tabel
    execute format($f$
      create table if not exists public.%I (
        id          text primary key,
        data        jsonb       not null,
        updated_at  timestamptz not null default now(),
        deleted_at  timestamptz
      );
    $f$, t);

    -- 2) Index untuk pull cursor (ambil baris yang berubah sejak terakhir sync)
    execute format(
      'create index if not exists %I on public.%I (updated_at);',
      t || '_updated_at_idx', t
    );

    -- 3) RLS aktif + policy untuk pengguna terautentикasi (akun bisnis)
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I on public.%I;', t || '_anon_all', t);
    execute format('drop policy if exists %I on public.%I;', t || '_auth_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true);',
      t || '_auth_all', t
    );

    -- 4) Realtime: tambahkan tabel ke publication (abaikan jika sudah ada)
    begin
      execute format('alter publication supabase_realtime add table public.%I;', t);
    exception
      when duplicate_object then null;
    end;
  end loop;
end $$;

-- =============================================================
-- Booking publik (form tamu via HP) — jalur tulis anon TANPA akses tabel.
--
-- Tabel `bookings` di atas sudah dapat policy `authenticated` (staf baca/ubah)
-- + Realtime. Anon TIDAK punya policy apa pun ke tabel itu, jadi tak bisa
-- select/insert/update langsung. Satu-satunya jalan masuk dari tamu adalah
-- fungsi SECURITY DEFINER di bawah — ia berjalan sebagai owner (bypass RLS),
-- memvalidasi input, lalu menyisipkan baris berstatus 'pending'.
--
-- Mengembalikan HANYA `code` (kode pendek utk dicocokkan staf↔tamu) —
-- tidak membocorkan baris apa pun ke anon.
-- =============================================================

create or replace function public.submit_booking(p jsonb)
returns text
language plpgsql
security definer
set search_path = public
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
begin
  -- Validasi wajib
  if v_name is null then raise exception 'guestName is required'; end if;
  if v_wa   is null then raise exception 'wa is required';        end if;
  if v_email is null or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
    then raise exception 'valid email is required'; end if;
  if v_tver is null then raise exception 'agreedTermsVersion is required'; end if;

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
