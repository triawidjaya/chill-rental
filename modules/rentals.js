// =============================================================
// modules/rentals.js
// RentalManager — core transaction logic
// States: active -> completed | cancelled
// =============================================================

import { state } from './state.js';
import { uid, daysBetween, calcRentalDays } from './utils.js';
import { MotorManager, MotorStatus } from './motors.js';
import { t } from './i18n.js';
// OwnerManager tidak lagi di-import setelah R3 (PTO pindah ke motor)
import { AuditManager, AuditEntities, AuditActions } from './audit.js';

const rentalLabel = (r) => r ? `${r.guestName} · ${r.motorPlate || ''}` : '(unknown)';

/**
 * Total yang harus dibayar tamu = biaya sewa + ganti rugi damage (jika ada).
 * Pisahkan dari totalCost agar laporan keuangan tetap bisa bedain sewa vs damage recovery.
 */
export const getRentalGrandTotal = (r) => {
  if (!r) return 0;
  return (r.totalCost || 0) + (r.newDamage ? (r.damageCharge || 0) : 0);
};

export const RentalStatus = {
  ACTIVE: 'active',
  RETURNED: 'returned',     // R6/R7: motor kembali fisik, biaya final dihitung
  COMPLETED: 'completed',   // legacy — auto-migrated ke returned, jangan dipakai di code baru
  CANCELLED: 'cancelled',
};

/**
 * Compute multi-flag badge dari rental.
 * Mengembalikan { primary, secondary?, fullyDone }
 *   - primary: badge utama berdasarkan lifecycle (Aktif / Menunggu Bayar / Menunggu Settle / Selesai / Batal)
 *   - secondary: badge tambahan (mis. 'Damage Pending') — opsional
 *   - fullyDone: true jika semua flag complete (untuk hide 3 tombol aksi di R8)
 */
export function getRentalBadge(r) {
  if (!r) return { primary: { label: '—', cls: '' }, fullyDone: false };
  const isReturned = r.status === RentalStatus.RETURNED || r.status === RentalStatus.COMPLETED;

  // Cancelled
  if (r.status === RentalStatus.CANCELLED) {
    return { primary: { label: '⚪ Dibatalkan', cls: 'badge--danger' }, fullyDone: true };
  }

  // Active
  if (r.status === RentalStatus.ACTIVE) {
    if (r.suspectedDamage) {
      return {
        primary: { label: '🟢 Aktif', cls: 'badge--success' },
        secondary: { label: '⚠ Cek Damage', cls: 'badge--warning' },
        fullyDone: false,
      };
    }
    return { primary: { label: `🟢 ${t('badge_active')}`, cls: 'badge--success' }, fullyDone: false };
  }

  // Returned — cek 3 flag
  if (isReturned) {
    const secondary = (r.newDamage && !r.damageResolved)
      ? { label: `🟠 ${t('badge_damage_pending')}`, cls: 'badge--warning' }
      : null;

    if (!r.paid) {
      return { primary: { label: `🟡 ${t('badge_awaiting_payment')}`, cls: 'badge--warning' }, secondary, fullyDone: false };
    }
    if (!r.ownerSettled) {
      return { primary: { label: `🔵 ${t('badge_settle_owner') || 'Menunggu Settle Owner'}`, cls: 'badge--brand' }, secondary, fullyDone: false };
    }
    if (secondary) {
      return { primary: { label: `🟠 ${t('badge_damage_pending')}`, cls: 'badge--warning' }, fullyDone: false };
    }
    return { primary: { label: `✅ ${t('badge_completed')}`, cls: '' }, fullyDone: true };
  }

  // Fallback
  return { primary: { label: r.status || '—', cls: '' }, fullyDone: false };
}

// HTML-ready helper
export function renderRentalBadge(r) {
  const b = getRentalBadge(r);
  let html = `<span class="badge ${b.primary.cls}">${b.primary.label}</span>`;
  if (b.secondary) html += ` <span class="badge ${b.secondary.cls}">${b.secondary.label}</span>`;
  return html;
}

export const PaymentMethod = {
  CASH_BOX: 'Cash Box',
  CREDIT_CARD: 'Credit Card',
  TRANSFER: 'Transfer',
  QRIS: 'QRIS',
};

export const RentalManager = {
  list() {
    return state.get('rentals') || [];
  },

  get(id) {
    return state.find('rentals', id);
  },

  active() {
    return this.list().filter(r => r.status === RentalStatus.ACTIVE);
  },

  // R6/R7: "completed" semantik = sudah returned (legacy 'completed' juga termasuk).
  // Untuk filter UI yang specific (mis. menunggu bayar), gunakan helper baru di R7.
  completed() {
    return this.list().filter(r =>
      r.status === RentalStatus.RETURNED || r.status === RentalStatus.COMPLETED
    );
  },

  returned() {
    return this.list().filter(r =>
      r.status === RentalStatus.RETURNED || r.status === RentalStatus.COMPLETED
    );
  },

  /**
   * Check-in / new rental.
   * Motor langsung set status=rented.
   * finishDate OPSIONAL (perkiraan saja).
   * Biaya TIDAK dihitung di sini — hanya saat check-out aktual.
   */
  checkIn({
    guestName,
    wa = '',
    email = '',
    passportNo = '',
    startDate, finishDate = null, // ISO datetime — finish opsional/perkiraan
    motorId,
    pricePerDay,
    payToOwner,
    staffGivesKey,
    paymentMethod = '',           // R5: metode bayar dipilih saat check-out, bukan check-in
    notes = '',
  }) {
    const motor = MotorManager.get(motorId);
    if (!motor) throw new Error('Motor tidak ditemukan');
    if (motor.status === MotorStatus.RENTED) throw new Error('Motor sedang disewa');

    const ppd = Number(pricePerDay) || motor.pricePerDay || 70000;
    // PTO per hari (rate). Sumber prioritas (R3):
    //   1. argumen payToOwner (jika di-pass eksplisit)
    //   2. motor.payToOwnerPerDay (sumber utama setelah R1 — PTO sudah pindah ke motor)
    //   3. fallback: pricePerDay × 0.71 (rasio 50k/70k)
    const ptoPerDay = (payToOwner != null && payToOwner !== '' && !isNaN(Number(payToOwner)))
      ? Number(payToOwner)
      : (motor.payToOwnerPerDay != null && !isNaN(Number(motor.payToOwnerPerDay)))
        ? Number(motor.payToOwnerPerDay)
        : Math.round(ppd * 0.71);

    // Estimasi hari hanya untuk display (jika finishDate diisi)
    const estimateDays = finishDate ? calcRentalDays(startDate, finishDate) : 0;

    const rental = {
      id: uid('rnt'),
      guestName: (guestName || '').trim(),
      wa: (wa || '').trim(),
      email: (email || '').trim(),
      passportNo: (passportNo || '').trim(),
      // Passport workflow (R1 — passport dipegang saat tamu check-out dari properti + extend)
      propertyCheckedOut: false,
      passportHeld: false,
      passportHeldAt: null,
      startDate,
      finishDate,            // PERKIRAAN — hanya pengingat
      actualFinishDate: null, // FINAL — diisi saat check-out, dipakai untuk hitung biaya
      motorId,
      motorPlate: motor.plate,
      motorDescription: motor.description,
      ownerId: motor.ownerId,
      ownerName: motor.ownerName,
      pricePerDay: ppd,
      payToOwnerPerDay: ptoPerDay,  // rate per hari
      totalDays: estimateDays,       // estimasi, di-update saat checkout
      totalCost: 0,                  // 0 sampai check-out
      payToOwner: 0,                 // 0 sampai check-out
      commission: 0,                 // 0 sampai check-out
      paymentMethod,
      staffGivesKey: (staffGivesKey || '').trim().toUpperCase(),
      staffReceivesKey: '',
      newDamage: false,
      damageDescription: '',
      damageCharge: 0,
      damageResolved: true,   // R7: no damage at check-in → resolved=true secara default
      // Multi-flag status (R7)
      status: RentalStatus.ACTIVE,
      paid: false,
      paidAt: null,
      ownerSettled: false,
      ownerSettledAt: null,
      ownerPaid: false,       // backward-compat (akan dihapus setelah semua UI pakai ownerSettled)
      notes,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    state.add('rentals', rental);
    MotorManager.setStatus(motorId, MotorStatus.RENTED, rental.id);
    AuditManager.log({
      entity: AuditEntities.RENTAL, entityId: rental.id,
      entityLabel: rentalLabel(rental), action: AuditActions.CHECK_IN,
      note: `start=${rental.startDate}${rental.finishDate ? ` · estimasi=${rental.finishDate}` : ''}`,
    });
    return rental;
  },

  /**
   * Check-out — motor kembali fisik dari tamu. Hitung biaya final dengan aturan 11 AM.
   * R6: status set ke 'returned' (BUKAN 'completed').
   * Aksi 'tandai sudah bayar' & 'tandai settle owner' = aksi terpisah di R8.
   */
  checkOut(rentalId, {
    actualFinishDate, staffReceivesKey,
    paymentMethod = '',
    newDamage = false, damageDescription = '', damageCharge = 0,
    checkoutReason = '',
    cutoffHour = 11,
  }) {
    const rental = this.get(rentalId);
    if (!rental) throw new Error('Rental tidak ditemukan');
    if (rental.status !== RentalStatus.ACTIVE) throw new Error('Rental tidak aktif (sudah returned atau cancelled)');

    // Validasi range actualFinishDate
    const finish = actualFinishDate || new Date().toISOString();
    const finishMs = new Date(finish).getTime();
    const startMs  = new Date(rental.startDate).getTime();
    const nowMs    = Date.now();
    const twoHours = 2 * 60 * 60 * 1000;
    if (finishMs < startMs) throw new Error('Tanggal check-out tidak boleh sebelum tanggal check-in');
    if (finishMs > nowMs + twoHours) throw new Error('Tanggal check-out tidak boleh lebih dari 2 jam ke depan');

    // Pakai aturan cut-off 11:00 AM
    const days = calcRentalDays(rental.startDate, finish, cutoffHour);
    const totalCost = rental.pricePerDay * days;
    // payToOwnerPerDay dari rate yang disimpan saat check-in
    const ptoPerDay = rental.payToOwnerPerDay != null
      ? rental.payToOwnerPerDay
      : (rental.totalDays > 0 ? Math.round(rental.payToOwner / rental.totalDays) : 50000);
    const payToOwner = ptoPerDay * days;
    const commission = totalCost - payToOwner;

    state.update('rentals', rentalId, {
      actualFinishDate: finish,
      totalDays: days,
      totalCost,
      payToOwner,
      commission,
      staffReceivesKey: (staffReceivesKey || '').trim().toUpperCase(),
      paymentMethod: paymentMethod || rental.paymentMethod || '',
      checkoutReason: (checkoutReason || '').trim(),
      newDamage,
      damageDescription,
      damageCharge: Number(damageCharge) || 0,
      damageResolved: !newDamage,  // R7: auto-true jika no damage; jika ada damage, perlu aksi terpisah
      status: RentalStatus.RETURNED,
      // paid, ownerSettled — TETAP false, akan di-set via aksi terpisah (R8)
    });

    MotorManager.setStatus(rental.motorId, MotorStatus.AVAILABLE, null);

    AuditManager.log({
      entity: AuditEntities.RENTAL, entityId: rentalId,
      entityLabel: rentalLabel(rental), action: AuditActions.CHECK_OUT,
      note: `${days} hari · total ${totalCost.toLocaleString('id-ID')}${newDamage ? ' · ada kerusakan' : ''}${checkoutReason ? ` · alasan: ${checkoutReason}` : ''} · status: returned`,
    });

    // Catat damage jika ada
    if (newDamage && damageDescription) {
      import('./damages.js').then(({ DamageManager }) => {
        DamageManager.create({
          rentalId,
          motorId: rental.motorId,
          motorPlate: rental.motorPlate,
          description: damageDescription,
          charge: Number(damageCharge) || 0,
          date: new Date().toISOString(),
        });
      });
    }
    return this.get(rentalId);
  },

  /**
   * R10 — Edit detail rental aktif (koreksi kesalahan input).
   * Hanya bisa untuk status='active'. Setelah returned/cancelled, immutable.
   * Jika motorId berubah: motor lama → available, motor baru → rented (harus available dulu).
   */
  editRental(rentalId, patch) {
    const rental = this.get(rentalId);
    if (!rental) throw new Error('Rental tidak ditemukan');
    if (rental.status !== RentalStatus.ACTIVE) {
      throw new Error('Hanya rental aktif yang bisa diedit. Rental sudah returned/cancelled — immutable.');
    }

    // Whitelist field yang BOLEH di-edit (sisanya di-ignore untuk safety)
    const allowed = ['guestName', 'wa', 'email', 'startDate', 'finishDate', 'staffGivesKey', 'notes'];
    const safePatch = {};
    allowed.forEach(k => {
      if (k in patch) safePatch[k] = patch[k];
    });

    // Trim string fields
    ['guestName', 'wa', 'email', 'staffGivesKey', 'notes'].forEach(k => {
      if (typeof safePatch[k] === 'string') safePatch[k] = safePatch[k].trim();
    });
    if (safePatch.staffGivesKey) safePatch.staffGivesKey = safePatch.staffGivesKey.toUpperCase();

    // Handle motor swap
    if (patch.motorId && patch.motorId !== rental.motorId) {
      const newMotor = MotorManager.get(patch.motorId);
      if (!newMotor) throw new Error('Motor pengganti tidak ditemukan');
      if (newMotor.status === MotorStatus.RENTED) {
        throw new Error(`Motor ${newMotor.plate} sedang disewa — pilih motor available`);
      }

      // Lepas motor lama
      MotorManager.setStatus(rental.motorId, MotorStatus.AVAILABLE, null);
      // Pasang motor baru
      MotorManager.setStatus(newMotor.id, MotorStatus.RENTED, rentalId);

      // Update snapshot motor info di rental
      safePatch.motorId = newMotor.id;
      safePatch.motorPlate = newMotor.plate;
      safePatch.motorDescription = newMotor.description;
      safePatch.ownerId = newMotor.ownerId;
      safePatch.ownerName = newMotor.ownerName;
      safePatch.pricePerDay = newMotor.pricePerDay;
      safePatch.payToOwnerPerDay = newMotor.payToOwnerPerDay
        || Math.round((newMotor.pricePerDay || 70000) * 0.71);
    }

    state.update('rentals', rentalId, safePatch);
    AuditManager.logUpdate({
      entity: AuditEntities.RENTAL, entityId: rentalId,
      entityLabel: rentalLabel(rental),
      before: rental, patch: safePatch,
      note: 'edit detail rental (active)',
    });
    return this.get(rentalId);
  },

  cancel(rentalId) {
    const rental = this.get(rentalId);
    if (!rental) return;

    // Guard: blok jika motor sudah digunakan >0 hari
    const daysSoFar = calcRentalDays(rental.startDate, new Date().toISOString()) - 1;
    if (daysSoFar > 0) {
      throw new Error(
        `Motor sudah digunakan ${daysSoFar} hari sejak ${new Date(rental.startDate).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })} — gunakan Check-Out untuk mengakhiri sewa`
      );
    }

    state.update('rentals', rentalId, { status: RentalStatus.CANCELLED });
    MotorManager.setStatus(rental.motorId, MotorStatus.AVAILABLE, null);
    AuditManager.log({
      entity: AuditEntities.RENTAL, entityId: rentalId,
      entityLabel: rentalLabel(rental), action: AuditActions.CANCEL,
      note: 'dibatalkan sebelum motor digunakan',
    });
  },

  // =====================================================
  // R7 — Multi-flag actions (untuk 3 tombol di R8)
  // =====================================================

  /**
   * Tandai rental sudah dibayar. Hanya boleh untuk status='returned' dan paid=false.
   */
  markPaid(rentalId, { paymentMethod = '', amountReceived, adjustmentReason = '' } = {}) {
    const rental = this.get(rentalId);
    if (!rental) throw new Error('Rental tidak ditemukan');
    const isReturned = rental.status === RentalStatus.RETURNED || rental.status === RentalStatus.COMPLETED;
    if (!isReturned) throw new Error('Rental belum returned — harus check-out dulu');
    if (rental.paid) throw new Error('Rental sudah dibayar');
    if (rental.passportHeld) throw new Error('Passport tamu masih di-hold — kembalikan passport dulu sebelum proses pembayaran');
    if (rental.newDamage && !rental.damageResolved) throw new Error('Ada kerusakan yang belum diselesaikan — tandai Damage Selesai dulu sebelum tandai bayar');

    const grandTotal = getRentalGrandTotal(rental);
    const received   = amountReceived != null ? Number(amountReceived) : grandTotal;
    const difference = received - grandTotal;

    // Jika nominal berbeda, alasan wajib diisi
    if (difference !== 0 && !(adjustmentReason || '').trim()) {
      throw new Error('Jumlah diterima berbeda dari tagihan — wajib isi alasan penyesuaian');
    }

    const now = new Date().toISOString();
    state.update('rentals', rentalId, {
      paid: true,
      paidAt: now,
      paymentMethod: paymentMethod || rental.paymentMethod || '',
      amountReceived: received,
      amountDifference: difference,
      adjustmentReason: (adjustmentReason || '').trim(),
    });

    const diffLabel = difference !== 0
      ? ` · selisih: ${difference > 0 ? '+' : ''}${difference.toLocaleString('id-ID')} · alasan: ${adjustmentReason}`
      : '';
    AuditManager.log({
      entity: AuditEntities.RENTAL, entityId: rentalId,
      entityLabel: rentalLabel(rental), action: 'mark-paid',
      note: `metode: ${paymentMethod || '-'} · tagihan: ${grandTotal.toLocaleString('id-ID')} · diterima: ${received.toLocaleString('id-ID')}${diffLabel}`,
    });
    return this.get(rentalId);
  },

  /**
   * Tandai kunci & uang sudah diserahkan ke owner. Syarat: returned + paid.
   */
  markOwnerSettled(rentalId) {
    const rental = this.get(rentalId);
    if (!rental) throw new Error('Rental tidak ditemukan');
    if (!rental.paid) throw new Error('Belum bisa settle owner — tamu belum bayar');
    if (rental.ownerSettled) throw new Error('Sudah ditandai diserahkan ke owner');

    const now = new Date().toISOString();
    state.update('rentals', rentalId, {
      ownerSettled: true,
      ownerSettledAt: now,
      ownerPaid: true,  // backward-compat
    });
    AuditManager.log({
      entity: AuditEntities.RENTAL, entityId: rentalId,
      entityLabel: rentalLabel(rental), action: 'mark-owner-settled',
      note: `owner: ${rental.ownerName || '-'} · pto: ${(rental.payToOwner || 0).toLocaleString('id-ID')}`,
    });
    return this.get(rentalId);
  },

  /**
   * R9 — Passport Hold workflow.
   * Tamu sudah check-out dari properti tapi extend sewa motor → properti pegang passport fisik.
   * Set: propertyCheckedOut=true, passportHeld=true, passportHeldAt=now, passportNo.
   * Hanya untuk rental aktif.
   */
  holdPassport(rentalId, { passportNo }) {
    const rental = this.get(rentalId);
    if (!rental) throw new Error('Rental tidak ditemukan');
    if (rental.status !== RentalStatus.ACTIVE) throw new Error('Hanya rental aktif yang bisa di-hold passport');

    const cleanPassport = (passportNo || '').trim();
    if (!cleanPassport) throw new Error('No. passport wajib diisi');
    if (cleanPassport.length < 4) throw new Error('No. passport terlalu pendek');

    const now = new Date().toISOString();
    state.update('rentals', rentalId, {
      propertyCheckedOut: true,
      passportHeld: true,
      passportHeldAt: now,
      passportNo: cleanPassport,
    });
    AuditManager.log({
      entity: AuditEntities.RENTAL, entityId: rentalId,
      entityLabel: rentalLabel(rental), action: 'passport-hold',
      note: `passport: ${cleanPassport.slice(0, 4)}*** · tamu: ${rental.guestName}`,
    });
    return this.get(rentalId);
  },

  /**
   * Release passport — kalau tamu sudah balik/selesai dan ambil passport.
   * Tidak menghilangkan record passportNo, hanya flag.
   */
  releasePassport(rentalId) {
    const rental = this.get(rentalId);
    if (!rental) throw new Error('Rental tidak ditemukan');
    if (!rental.passportHeld) throw new Error('Passport belum di-hold');

    state.update('rentals', rentalId, {
      passportHeld: false,
      passportReleasedAt: new Date().toISOString(),
    });
    AuditManager.log({
      entity: AuditEntities.RENTAL, entityId: rentalId,
      entityLabel: rentalLabel(rental), action: 'passport-release',
      note: `tamu: ${rental.guestName}`,
    });
    return this.get(rentalId);
  },

  /**
   * Undo Check-Out — balik rental dari 'returned' ke 'active'.
   * Guard: hanya bisa jika belum paid (keuangan belum bergerak).
   * Motor dikembalikan ke status rented.
   * Damage record yang dibuat saat checkout ikut dihapus.
   */
  undoCheckOut(rentalId) {
    const rental = this.get(rentalId);
    if (!rental) throw new Error('Rental tidak ditemukan');
    const isReturned = rental.status === RentalStatus.RETURNED || rental.status === RentalStatus.COMPLETED;
    if (!isReturned) throw new Error('Rental belum di-checkout — tidak perlu undo');
    if (rental.paid) throw new Error('Tidak bisa undo check-out — rental sudah dibayar. Batalkan pembayaran dulu');

    // Hapus damage record yang dibuat saat checkout ini (jika ada)
    if (rental.newDamage) {
      import('./damages.js').then(({ DamageManager }) => {
        const linked = DamageManager.list().filter(d => d.rentalId === rentalId);
        linked.forEach(d => DamageManager.remove(d.id));
      });
    }

    // Reset semua field hasil checkout, kembali ke state pre-checkout
    const estimateDays = rental.finishDate
      ? (this.get(rentalId)?.totalDays || 0)  // simpan estimasi awal jika ada
      : 0;

    state.update('rentals', rentalId, {
      status: RentalStatus.ACTIVE,
      actualFinishDate: null,
      totalDays: estimateDays,
      totalCost: 0,
      payToOwner: 0,
      commission: 0,
      staffReceivesKey: '',
      paymentMethod: '',
      newDamage: false,
      damageDescription: '',
      damageCharge: 0,
      damageResolved: true,
      paid: false,
      paidAt: null,
      ownerSettled: false,
      ownerSettledAt: null,
      ownerPaid: false,
    });

    // Kembalikan motor ke status rented
    MotorManager.setStatus(rental.motorId, MotorStatus.RENTED, rentalId);

    AuditManager.log({
      entity: AuditEntities.RENTAL, entityId: rentalId,
      entityLabel: rentalLabel(rental), action: 'undo-checkout',
      note: `status dikembalikan ke active · motor ${rental.motorPlate} kembali rented`,
    });
    return this.get(rentalId);
  },

  /**
   * Batal Tandai Bayar — reset paid=false.
   * Guard: ownerSettled masih false DAN di hari yang sama dengan paidAt.
   */
  unmarkPaid(rentalId) {
    const rental = this.get(rentalId);
    if (!rental) throw new Error('Rental tidak ditemukan');
    if (!rental.paid) throw new Error('Rental belum ditandai dibayar');
    if (rental.ownerSettled) throw new Error('Tidak bisa batal bayar — owner sudah di-settle');
    const paidDate = (rental.paidAt || '').slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    if (paidDate !== today) throw new Error(`Tidak bisa dibatalkan — hanya bisa di hari yang sama (${paidDate})`);

    state.update('rentals', rentalId, {
      paid: false,
      paidAt: null,
      paymentMethod: '',
    });
    AuditManager.log({
      entity: AuditEntities.RENTAL, entityId: rentalId,
      entityLabel: rentalLabel(rental), action: 'unmark-paid',
      note: `pembayaran dibatalkan · total: ${(rental.totalCost || 0).toLocaleString('id-ID')}`,
    });
    return this.get(rentalId);
  },

  /**
   * Flag suspected damage saat rental masih AKTIF.
   * Staff/owner bisa catat dugaan kerusakan sebelum motor dikembalikan.
   * Saat checkout, field damage akan pre-filled dari flag ini.
   */
  flagDamage(rentalId, { note = '' }) {
    const rental = this.get(rentalId);
    if (!rental) throw new Error('Rental tidak ditemukan');
    if (rental.status !== RentalStatus.ACTIVE) throw new Error('Hanya bisa flag damage saat rental masih aktif');
    if (!note.trim()) throw new Error('Catatan dugaan kerusakan wajib diisi');

    state.update('rentals', rentalId, {
      suspectedDamage: true,
      suspectedDamageNote: note.trim(),
      suspectedDamageAt: new Date().toISOString(),
    });
    AuditManager.log({
      entity: AuditEntities.RENTAL, entityId: rentalId,
      entityLabel: rentalLabel(rental), action: 'flag-damage',
      note: note.trim(),
    });
    return this.get(rentalId);
  },

  /**
   * Hapus flag suspected damage (jika ternyata salah info).
   */
  clearDamageFlag(rentalId) {
    const rental = this.get(rentalId);
    if (!rental) throw new Error('Rental tidak ditemukan');
    if (!rental.suspectedDamage) throw new Error('Tidak ada flag damage');

    state.update('rentals', rentalId, {
      suspectedDamage: false,
      suspectedDamageNote: '',
      suspectedDamageAt: null,
    });
    AuditManager.log({
      entity: AuditEntities.RENTAL, entityId: rentalId,
      entityLabel: rentalLabel(rental), action: 'clear-damage-flag',
      note: 'flag dugaan kerusakan dibatalkan',
    });
    return this.get(rentalId);
  },

  /**
   * Undo Tandai Damage Selesai — buka kembali damage ke status pending.
   * Guard: blocked jika sudah paid (keuangan sudah bergerak).
   */
  unmarkDamageResolved(rentalId) {
    const rental = this.get(rentalId);
    if (!rental) throw new Error('Rental tidak ditemukan');
    if (!rental.newDamage) throw new Error('Rental ini tidak ada kerusakan');
    if (!rental.damageResolved) throw new Error('Damage belum ditandai selesai');
    if (rental.paid) throw new Error('Tidak bisa buka kembali damage — rental sudah dibayar');

    state.update('rentals', rentalId, { damageResolved: false });
    AuditManager.log({
      entity: AuditEntities.RENTAL, entityId: rentalId,
      entityLabel: rentalLabel(rental), action: 'unmark-damage-resolved',
      note: `damage dibuka kembali ke pending · charge: ${(rental.damageCharge || 0).toLocaleString('id-ID')}`,
    });
    return this.get(rentalId);
  },

  /**
   * Undo Tandai Settle Owner — batalkan settlement ke owner.
   * Guard: hanya bisa di-undo di hari yang sama dengan ownerSettledAt.
   */
  unmarkOwnerSettled(rentalId) {
    const rental = this.get(rentalId);
    if (!rental) throw new Error('Rental tidak ditemukan');
    if (!rental.ownerSettled) throw new Error('Owner belum ditandai settled');
    const settledDate = (rental.ownerSettledAt || '').slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    if (settledDate !== today) throw new Error(`Tidak bisa dibatalkan — hanya bisa di hari yang sama (${settledDate})`);

    state.update('rentals', rentalId, {
      ownerSettled: false,
      ownerSettledAt: null,
      ownerPaid: false,
    });
    AuditManager.log({
      entity: AuditEntities.RENTAL, entityId: rentalId,
      entityLabel: rentalLabel(rental), action: 'unmark-owner-settled',
      note: `settle owner dibatalkan · pto: ${(rental.payToOwner || 0).toLocaleString('id-ID')}`,
    });
    return this.get(rentalId);
  },

  /**
   * Edit detail damage (deskripsi & charge).
   * Bisa diedit kapan saja selama owner belum di-settle.
   * Jika sudah paid → tercatat sebagai "koreksi post-paid" di audit trail.
   */
  editDamage(rentalId, { damageDescription, damageCharge }) {
    const rental = this.get(rentalId);
    if (!rental) throw new Error('Rental tidak ditemukan');
    if (!rental.newDamage) throw new Error('Rental ini tidak ada kerusakan');
    if (rental.ownerSettled) throw new Error('Tidak bisa ubah damage — owner sudah di-settle');

    const oldCharge = rental.damageCharge || 0;
    const newCharge = Number(damageCharge) || 0;
    state.update('rentals', rentalId, {
      damageDescription: (damageDescription || rental.damageDescription || '').trim(),
      damageCharge: newCharge,
    });

    // Sync ke damage record di DamageManager jika ada
    import('./damages.js').then(({ DamageManager }) => {
      const linked = DamageManager.list().find(d => d.rentalId === rentalId);
      if (linked) DamageManager.update(linked.id, {
        description: (damageDescription || rental.damageDescription || '').trim(),
        charge: newCharge,
      });
    });

    const isPostPaid = rental.paid;
    AuditManager.log({
      entity: AuditEntities.RENTAL, entityId: rentalId,
      entityLabel: rentalLabel(rental), action: 'edit-damage',
      note: `charge: ${oldCharge.toLocaleString('id-ID')} → ${newCharge.toLocaleString('id-ID')}${isPostPaid ? ' (koreksi post-paid)' : ''}`,
    });
    return this.get(rentalId);
  },

  /**
   * Tandai damage sudah selesai (dibayar / diperbaiki).
   */
  markDamageResolved(rentalId, { note = '' } = {}) {
    const rental = this.get(rentalId);
    if (!rental) throw new Error('Rental tidak ditemukan');
    if (!rental.newDamage) throw new Error('Rental ini tidak ada kerusakan');
    if (rental.damageResolved) throw new Error('Damage sudah ditandai selesai');

    state.update('rentals', rentalId, { damageResolved: true });
    AuditManager.log({
      entity: AuditEntities.RENTAL, entityId: rentalId,
      entityLabel: rentalLabel(rental), action: 'mark-damage-resolved',
      note: note || `charge: ${(rental.damageCharge || 0).toLocaleString('id-ID')}`,
    });
    return this.get(rentalId);
  },

  /**
   * Koreksi Admin — edit field terbatas pada rental yang sudah fullyDone.
   * Hanya untuk koreksi administratif (salah catat nominal, metode bayar, catatan).
   *
   * Field yang BOLEH diedit:
   *   - damageCharge  : koreksi nominal ganti rugi
   *   - paymentMethod : koreksi metode pembayaran yang salah dicatat
   *   - notes         : tambah/ubah catatan
   *
   * Field yang TIDAK BOLEH diedit (immutable):
   *   - startDate, actualFinishDate, totalDays, totalCost
   *   - semua status flags (paid, ownerSettled, damageResolved, status)
   */
  adminCorrect(rentalId, { damageCharge, paymentMethod, notes } = {}) {
    const rental = this.get(rentalId);
    if (!rental) throw new Error('Rental tidak ditemukan');

    const isFullyDone = (
      (rental.status === RentalStatus.RETURNED || rental.status === RentalStatus.COMPLETED) &&
      rental.paid && rental.ownerSettled && rental.damageResolved
    );
    if (!isFullyDone) throw new Error('Koreksi admin hanya untuk rental yang sudah selesai sepenuhnya');

    // Guard: hanya bisa koreksi di hari yang sama dengan ownerSettledAt
    const settledDate = (rental.ownerSettledAt || '').slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    if (settledDate !== today) throw new Error(
      `Koreksi hanya bisa dilakukan di hari yang sama (${settledDate}) — data historis tidak bisa diubah`
    );

    const patch = {};
    const changes = [];

    if (damageCharge !== undefined) {
      const oldCharge = rental.damageCharge || 0;
      const newCharge = Number(damageCharge) || 0;
      patch.damageCharge = newCharge;
      if (oldCharge !== newCharge) {
        changes.push(`damage: ${oldCharge.toLocaleString('id-ID')} → ${newCharge.toLocaleString('id-ID')}`);

        // Sync ke damage record jika ada
        import('./damages.js').then(({ DamageManager }) => {
          const linked = DamageManager.list().find(d => d.rentalId === rentalId);
          if (linked) DamageManager.update(linked.id, { charge: newCharge });
        });
      }
    }

    if (paymentMethod !== undefined) {
      const oldMethod = rental.paymentMethod || '-';
      patch.paymentMethod = (paymentMethod || '').trim();
      if (oldMethod !== patch.paymentMethod) {
        changes.push(`metode: ${oldMethod} → ${patch.paymentMethod || '-'}`);
      }
    }

    if (notes !== undefined) {
      patch.notes = (notes || '').trim();
      changes.push('catatan diperbarui');
    }

    if (Object.keys(patch).length === 0) throw new Error('Tidak ada perubahan yang dideteksi');

    state.update('rentals', rentalId, patch);
    AuditManager.log({
      entity: AuditEntities.RENTAL, entityId: rentalId,
      entityLabel: rentalLabel(rental), action: 'koreksi-admin',
      note: changes.join(' · '),
    });
    return this.get(rentalId);
  },

  // ----- Helper queries untuk dashboard / filter -----
  awaitingPayment() {
    return this.list().filter(r =>
      (r.status === RentalStatus.RETURNED || r.status === RentalStatus.COMPLETED) && !r.paid
    );
  },

  awaitingOwnerSettle() {
    return this.list().filter(r =>
      (r.status === RentalStatus.RETURNED || r.status === RentalStatus.COMPLETED)
      && r.paid && !r.ownerSettled
    );
  },

  damagePending() {
    return this.list().filter(r => r.newDamage && !r.damageResolved && r.status !== RentalStatus.CANCELLED);
  },

  fullyDone() {
    return this.list().filter(r => {
      const isReturned = r.status === RentalStatus.RETURNED || r.status === RentalStatus.COMPLETED;
      return isReturned && r.paid && r.ownerSettled && r.damageResolved;
    });
  },

  // Queries
  countActive() { return this.active().length; },
  // Hanya hitung passport yang sedang di-hold (R9). Field lama keepPassport sudah tidak dipakai.
  countPassportsKept() { return this.active().filter(r => r.passportHeld).length; },

  todayStats() {
    const today = new Date().toISOString().slice(0, 10);
    const todayRentals = this.list().filter(r => (r.createdAt || '').slice(0, 10) === today);
    return {
      newToday: todayRentals.length,
      revenueToday: todayRentals.reduce((s, r) => s + (r.totalCost || 0), 0),
    };
  },

  monthStats(yearMonth) {
    // yearMonth = "2026-05"
    const list = this.list().filter(r =>
      (r.createdAt || '').slice(0, 7) === yearMonth && r.status !== RentalStatus.CANCELLED
    );
    return {
      total: list.length,
      revenue: list.reduce((s, r) => s + (r.totalCost || 0), 0),
      commission: list.reduce((s, r) => s + (r.commission || 0), 0),
      payToOwner: list.reduce((s, r) => s + (r.payToOwner || 0), 0),
      damageRecovery: list.reduce((s, r) => s + (r.damageCharge || 0), 0),
    };
  },
};
