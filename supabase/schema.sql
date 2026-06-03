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
-- CATATAN KEAMANAN (MVP): policy di bawah memberi anon key akses penuh.
-- Ini "gerbang UX + akuntabilitas", BUKAN keamanan server sejati.
-- Untuk produksi multi-user sungguhan, ganti ke Supabase Auth + RLS per auth.uid().
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

    -- 3) RLS aktif + policy permisif untuk anon (MVP)
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I on public.%I;', t || '_anon_all', t);
    execute format(
      'create policy %I on public.%I for all to anon using (true) with check (true);',
      t || '_anon_all', t
    );

    -- 4) Realtime: tambahkan tabel ke publication (abaikan jika sudah ada)
    begin
      execute format('alter publication supabase_realtime add table public.%I;', t);
    exception
      when duplicate_object then null;
    end;
  end loop;
end $$;
