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

export const SUPABASE_URL = 'https://rxqmrynnsregemjegbwx.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4cW1yeW5uc3JlZ2VtamVnYnd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0NzgxNDIsImV4cCI6MjA5NjA1NDE0Mn0.K0_TEdNEqtv2g-QIY97PiSZX5CRDLoj0InqQeote5ds';

// Aktifkan/matikan sinkronisasi ke Supabase tanpa mengubah kode lain.
// false = app jalan 100% lokal (localStorage) seperti sebelumnya.
export const SYNC_ENABLED = true;
