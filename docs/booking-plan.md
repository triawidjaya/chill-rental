# 📋 Plan: Booking Online + Agreement (Chill Rental)

> Status: disepakati 2026-06-04. Fitur **Booking/Reservasi online** untuk tamu via HP
> (scan QR / buka URL), dengan gerbang Agreement (S&K) sebelum isi data. Menambah jalur
> baru — **tidak** mengganti input manual staf yang sudah ada.

## Keputusan kunci (sudah final)

| Topik | Keputusan |
|---|---|
| Pemicu | **Form publik terbuka** (QR di counter / link), tanpa token |
| Cakupan data tamu | Identitas teks + preferensi booking (CC, surfrack, tanggal) |
| Jalur tulis tamu | **RPC `SECURITY DEFINER`** — anon hanya `EXECUTE`, tak sentuh tabel |
| Agreement | Gerbang di awal: scroll-to-bottom → centang setuju → form terbuka |
| "Mengikat" | Segel saat **Submit** (identitas + versi S&K + timestamp tersimpan bersama) |
| Reservasi motor | **Tidak dikunci** saat konfirmasi — motor baru terpakai saat check-in fisik |
| Harga | **Tabel harga per-CC tetap** (`pricing.js`) |
| Jejak S&K jalur manual | Ditunda (jalur manual staf tidak diubah) |

### Harga & S&K (sumber dari pemilik)
- `110 - 125` → **Rp 70.000/hari**
- `150` → **Rp 150.000/hari**
- Kelas `155` & `160` (ada di sistem) **tanpa harga publik** → tidak ditawarkan di form tamu; tetap bisa via jalur manual staf.
- Biaya tetap yang disebut di S&K: kunci hilang Rp 150.000, helm hilang Rp 150.000, aturan jam 11 (tanggal tidak dihitung bila kunci dikembalikan sebelum jam 11), pembayaran hanya di akhir, tanpa asuransi (kerusakan/kehilangan tanggung jawab penyewa).
- **Bahasa:** agreement (`TERMS`) & `TIPS` **bahasa Inggris saja**; chrome UI tetap ID/EN.
- **Atas nama:** agreement diatasnamakan properti **`PIPES HOSTEL`**, bukan platform.

---

## Flow final

```
TAMU (HP)                          STAF (app utama)              SISTEM
─────────                          ─────────────────             ──────
① scan QR / URL
② Agreement (scroll → setuju)  ──→ rekam versi+waktu
③ isi: nama, WA*, email,
   paspor(opsional), CC,
   surfrack, tgl mulai/selesai
   └ lihat harga/hari (tabel CC)
④ Submit ───────────────────────────────────────────────────→ status: PENDING
                                   ⑤ Action Queue "⏳ Booking Baru" (realtime)
                                   ⑥ review →
                                      ├ Konfirmasi → status: CONFIRMED
                                      │   (motor TIDAK dikunci — cuma niat)
                                      │   → WA konfirmasi ke tamu
                                      └ Tolak → status: REJECTED + alasan
                                   ─────────────────────────────────────
                                   (tamu datang fisik, nanti)
                                   ⑦ buka booking CONFIRMED → "Check-in"
                                      → form check-in ter-prefill
                                      → staf pilih motor available + harga final
                                      → RentalManager.checkIn() ──────────→ rental ACTIVE
                                                                            motor RENTED
                                                                  booking → CHECKED_IN (+rentalId)
```

Poin kunci: **Konfirmasi ≠ kunci motor**. Konfirmasi hanya "booking diterima" + kirim WA.
Motor benar-benar terpakai di langkah ⑦ saat tamu datang. Risiko dobel-booking dikelola
manual oleh staf (dapat ditambah peringatan lunak nanti). Tidak ada subsistem reservasi/tanggal.

---

## Entitas `bookings`

```js
{
  id: 'bkg_xxx',
  code: 'A7K3',
  status: 'pending' | 'confirmed' | 'rejected' | 'cancelled' | 'checked_in' | 'expired',

  // agreement
  agreedTermsVersion: 'v1', agreedAt,

  // identitas
  guestName, wa, email, passportNo,

  // preferensi booking
  ccClass: '110 - 125' | '150',
  surfrack: true | false,
  startDate, finishDate,          // estimasi
  quotedPricePerDay,              // harga ditampilkan saat submit (dari tabel CC)

  // hasil review staf
  assignedMotorId: null,          // diisi saat check-in (⑦), bukan saat konfirmasi
  rejectionReason: null,          // alasan ditolak (saat pending)
  cancellationReason: null,       // alasan dibatalkan (setelah confirmed)

  // lifecycle
  rentalId: null,                 // backlink setelah checked_in
  submittedAt, confirmedAt, cancelledAt, checkedInAt, updatedAt,
}
```

Deteksi duplikat: kunci = **No WhatsApp**. Saat review, tampilkan peringatan bila WA cocok
dengan booking/rental lain (returning guest / dobel-submit).

---

## Fase 0 — Konstanta & keputusan

- **0.1** `modules/pricing.js`:
  ```js
  export const PRICE_BY_CC = { '110 - 125': 70000, '150': 150000 };
  export const BOOKING_CC_OPTIONS = ['110 - 125', '150'];
  ```
- **0.2** `modules/terms.js` — **S&K (mengikat) dan TIPS (info) dipisah. Bahasa Inggris saja.
  Agreement atas nama properti `PIPES HOSTEL`** (bukan platform):
  ```js
  export const PROPERTY_NAME = 'PIPES HOSTEL';
  export const TERMS = {
    version: 'v1', updatedAt: '2026-06-04',
    title: 'PIPES HOSTEL — Motorbike Rental Terms & Conditions',
    body: `...aturan/kewajiban SAJA (English)...`, // judul & isi mengatasnamakan PIPES HOSTEL
  };
  export const TIPS = [
    'When visiting the beaches, always park in the designated parking area and pay the parking fee (usually 5,000 or 10,000).',
    'Do not leave the motorcycle at the beach or party overnight.',
    'When driving late at night, put any bags you have under the seat.',
  ]; // info only — NOT part of the agreement; reused on guest page + WA confirmation
  ```
- **0.3** Konstanta biaya tetap dari S&K (kunci/helm 150rb, aturan jam 11) — ditampilkan, bukan dihitung otomatis di MVP.

## Fase 1 — Backend Supabase (`supabase/schema.sql`)

- **1.1** Tabel `bookings (id text pk, data jsonb, updated_at timestamptz, deleted_at timestamptz)` + index `updated_at`.
- **1.2** RLS: `anon` tanpa grant tabel; `authenticated` full CRUD.
- **1.3** RPC `submit_booking(p jsonb) returns text` **SECURITY DEFINER**:
  - validasi `guestName/wa/email` wajib + trim; `ccClass` ∈ daftar; `agreedTermsVersion` ada
  - generate `code` 4-char unik (hindari O/0/I/1)
  - insert `status='pending'`, `submittedAt`, `updated_at=now()`
  - **return hanya `code`**
  - `grant execute on function submit_booking(jsonb) to anon;`
- **1.4** (Opsional, ditunda) anti-spam: tolak >3 pending dari WA sama dalam 10 menit.

## Fase 2 — Wiring sync staf

- **2.1** Tambah `bookings` ke `SYNCED_KEYS` (`modules/state.js`) & `TABLE_BY_KEY` (`modules/supabase.js`).
- **2.2** Default `bookings: []` + `migrate()`.
- **2.3** Verifikasi update status oleh staf lewat outbox/push (authenticated) seperti tabel lain.

## Fase 3 — Halaman tamu publik (`booking.html` + `modules/booking-guest.js`)

- **3.1** Boot ringan: supabase-js (anon), `pricing.js`, `terms.js`. Mobile-first, terpisah dari app staf.
- **3.2** Gerbang Agreement: render **`TERMS.body`** dalam kotak scroll (mengikat); tombol lanjut disabled sampai scroll-bottom + centang setuju; rekam `agreedAt` + versi. Di **bawah** halaman, tampilkan **`TIPS`** sebagai kartu "💡 Tips Berkendara" — **di luar** cakupan centang (info, tidak mengikat).
- **3.3** Form: Nama*/WA*/Email*/Paspor; CC (dropdown `BOOKING_CC_OPTIONS`) → tampil harga/hari; Surfrack; tgl mulai/selesai; validasi klien.
- **3.4** Submit → `rpc('submit_booking', {p})` → layar sukses "Kode booking: A7K3".
- **3.5** Error jaringan → pesan ramah + coba lagi.

## Fase 4 — Sisi staf: Action Queue (`modules/booking.js` + `pages/booking.js` + nav)

- **4.1** Badge realtime "⏳ Booking Baru (N)" (N = pending).
- **4.2** Daftar booking + filter per status; kartu: kode, nama, WA, CC, surfrack, tanggal, harga quote.
- **4.3** Deteksi duplikat by WA.
- **4.4** Konfirmasi → `confirmed` + tombol "Kirim WA Konfirmasi" (pola `buildGuestCheckin`) — pesan WA menyertakan **`TIPS`** di bagian bawah; Tolak → modal alasan → `rejected`.
- **4.4b** Booking `confirmed` bisa **dibatalkan** (tombol Batalkan + alasan) → status `cancelled` (beda dari `rejected` pra-konfirmasi).
- **4.5** Audit `booking-confirm` / `booking-reject` / `booking-cancel`.

## Fase 5 — Konversi booking → check-in nyata

- **5.1** Tombol "Check-in Sekarang" di booking `confirmed`.
- **5.2** Buka form check-in lama (`modules/ui/forms.js`) ter-prefill dari booking.
- **5.3** Staf pilih motor available → `RentalManager.checkIn()`. **Harga tetap dari model lama** (auto-fill `motor.pricePerDay`) — `PRICE_BY_CC` hanya info ke tamu, tidak dipakai sebagai harga rental.
- **5.4** Sukses → booking `checked_in` + `rentalId` + `checkedInAt`.

## Fase 6 — i18n, audit, polish

- **6.1** Label ID/EN (`modules/i18n.js`): chrome halaman tamu, error, status, badge, tombol. **Catatan:** isi **agreement (`TERMS`) & `TIPS` ditulis bahasa Inggris saja** (tidak ikut i18n), dan agreement **mengatasnamakan `PIPES HOSTEL`**, bukan platform.
- **6.2** `AuditActions.BOOKING_*` + warna badge (`pages/audit.js`).
- **6.3** (Opsional) auto-`expired` booking pending lama saat queue dibuka.

## Fase 7 — Uji & rilis

- **7.1** Jalankan `supabase/schema.sql` (tabel + RLS + RPC + grant).
- **7.2** Uji RPC anon: insert OK; select langsung GAGAL (RLS); return hanya `code`.
- **7.3** E2E: HP tamu submit → muncul di queue (realtime) → konfirmasi → WA → check-in → rental ACTIVE.
- **7.4** Jalur manual lama tetap normal.
- **7.5** Deploy: `booking.html` ter-host; QR → URL-nya.

---

## Fase 8 — Konsistensi branding WA + Property Name di Settings — ✅ SELESAI 2026-06-04

Diminta 2026-06-04: semua pesan WA ke tamu harus konsisten mengatasnamakan properti
(PIPES HOSTEL), dan nama properti punya input di halaman Settings.

Implementasi: `modules/property.js` (`getPropertyName`/`setPropertyName`, baca dari
`settings.propertyName`, fallback `terms.PROPERTY_NAME`). Field "Property name" di
Settings (`pages/extras.js`) + handler `save-property-name` (`app.js`). Semua header
builder WA (`buildGuestCheckin/Invoice/BookingConfirm` + owner `Returned/Settlement`)
kini pakai `getPropertyName()`. i18n ID/EN ditambahkan.
Catatan: nomor ref `invoiceNo` tetap prefix `CHILL-` (kode internal, bukan header brand).

- **8.1** Tambah `propertyName` ke `settings` (state) + field input di Settings (`pages/extras.js` `renderSettings`). Default `'PIPES HOSTEL'`.
- **8.2** Helper `getPropertyName()` → settings → fallback `terms.PROPERTY_NAME` → `'PIPES HOSTEL'`.
- **8.3** Ganti header semua builder WA tamu agar pakai nama properti:
  - `buildGuestCheckin`: `CHILL RENTAL · CHECK-IN` → `<NAME> · CHECK-IN`
  - `buildGuestInvoice`: `CHILL RENTAL · INVOICE` → `<NAME> · INVOICE`
  - `buildBookingConfirm`: sudah pakai `PROPERTY_NAME` → arahkan ke `getPropertyName()`
  - (Pesan owner boleh ikut pakai nama properti agar seragam.)
- **8.4** Catatan: `settings` per-device (tak sync) → halaman tamu `booking.html` (standalone) tetap pakai konstanta `terms.PROPERTY_NAME`. Pertimbangkan men-sync `propertyName` nanti bila perlu konsisten lintas device.

## Ditunda (di luar MVP)
- Reservasi/kunci motor & ketersediaan per-tanggal.
- Jejak S&K di jalur manual staf.
- Upload foto paspor, e-signature, harga kelas 155/160.
- Editor harga/CC & editor S&K lewat UI.

## Urutan eksekusi
Fase 0 → 1 → 2 (fondasi & backend) → 3 (halaman tamu, bisa dites mandiri) → 4 → 5 (staf) → 6 → 7.

---

## Teks S&K v1 (sumber)

```
* The cost of renting a motorcycle is 70,000 Rp (110-125cc) per day 150,000 Rp (150cc)
* We only accept payment at the end of the rental period and not before.
* The motorcycle is the guest responsibility from the start of rental until the keys are
  given back at the end of the rental period. Please be aware our motorcycles have no
  insurance therefore damage and lost (stolen) bikes are the guest responsibility to replace.
* IT IS NOT 24 hours rental. Days are counted per date, but if the bike is handed back before
  11am then that date is not counted.
* If you hand your motorcycle key back after 11am you will be charged for this date also.
* Damage (due to falling, crashing etc.), flat tires and missing (stolen) motorcycles are the
  responsibility of the person renting the bike.
* However much the cost to repair or replace the motorcycle is the responsibility of the person
  renting. The person renting can choose a mechanic to carry out any repairs or can pay the cost
  of the damage to the motorcycle owner.
* Lost keys are charged at 150,000 Rp
* We can provide FREE HELMETS but if lost the charge is 150,000 Rp
* If the motorcycle breaks down or you lose a key, PLEASE DON'T JUST LEAVE THE BIKE, call us and
  we will organize help.

TIPS
* When visiting the beaches always park in the designated parking area and pay the parking fee
  (usually 5,000 or 10,000).
* Do not leave the motorcycle at the beach or party overnight.
* When driving late at night put any bags you have under the seat.
```
