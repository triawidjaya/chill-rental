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
  tables text[] := array['motors','rentals','owners','damages','staff','audit_log'];
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
