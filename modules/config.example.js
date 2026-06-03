// =============================================================
// modules/config.example.js
// Template konfigurasi Supabase.
//
// CARA PAKAI:
//   1. Copy file ini menjadi  modules/config.js
//   2. Isi SUPABASE_URL dan SUPABASE_ANON_KEY dari:
//        Supabase Dashboard -> Project Settings -> API
//   3. config.js sudah di-gitignore (kunci tidak ikut ter-commit)
//
// Anon key MEMANG aman diekspos ke browser — keamanan sesungguhnya
// ada di Row Level Security (RLS), bukan pada kerahasiaan key ini.
// =============================================================

export const SUPABASE_URL = 'https://YOUR-PROJECT-ref.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';

// Aktifkan/matikan sinkronisasi ke Supabase tanpa mengubah kode lain.
// false = app jalan 100% lokal (localStorage) seperti sebelumnya.
export const SYNC_ENABLED = true;
