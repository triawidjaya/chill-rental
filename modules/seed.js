// =============================================================
// modules/seed.js
// Demo data — taken from Chill Rental operational data
// Users can "Load Demo Data" to start with realistic data
// =============================================================

import { state } from './state.js';
import { uid } from './utils.js';

const ownersSeed = [
  { id: 'own_pipes',   name: 'PIPES',    type: 'property', payToOwner: 50000, phone: '' },
  { id: 'own_iwan',    name: 'IWAN',     type: 'staff',    payToOwner: 50000, phone: '' },
  { id: 'own_aqbinul', name: 'AQ BINUL', type: 'staff',    payToOwner: 50000, phone: '' },
  { id: 'own_arif',    name: 'Arif',     type: 'staff',    payToOwner: 50000, phone: '' },
  { id: 'own_puri',    name: 'PURI',     type: 'staff',    payToOwner: 50000, phone: '' },
  { id: 'own_yung',    name: 'YUNG',     type: 'staff',    payToOwner: 50000, phone: '' },
  { id: 'own_ferda',   name: 'FERDA',    type: 'staff',    payToOwner: 50000, phone: '' },
  { id: 'own_mbsu',    name: 'MB SU',    type: 'staff',    payToOwner: 50000, phone: '' },
  { id: 'own_pait',    name: 'PAIT',     type: 'partner',  payToOwner: 50000, phone: '' },
  { id: 'own_iqida',   name: 'IQ IDA',   type: 'partner',  payToOwner: 50000, phone: '' },
  { id: 'own_masnun',  name: 'MASNUN',   type: 'partner',  payToOwner: 50000, phone: '' },
  { id: 'own_eno',     name: 'ENO',      type: 'staff',    payToOwner: 50000, phone: '' },
  { id: 'own_tria',    name: 'TRIA',     type: 'staff',    payToOwner: 50000, phone: '' },
  { id: 'own_aqderun', name: 'AQ DERUN', type: 'staff',    payToOwner: 50000, phone: '' },
];

// Subset of motors from the DataBase CSV (a representative sample of each category)
// surfrack=true is spread out (Pipes is a surfing area — ~35% of the fleet has a surfrack)
const motorsSeed = [
  // A — Properti
  { plate: 'DR 2730 UP', desc: 'Beat Merah Hitam (RC)', ownerId: 'own_pipes', category: 'A', price: 70000, cc: '110 - 125', status: 'rented',    surfrack: true },
  { plate: 'DR 2731 UP', desc: 'Beat Biru (RC)',         ownerId: 'own_pipes', category: 'A', price: 70000, cc: '110 - 125', status: 'available', surfrack: false },
  { plate: 'DR 4687 UP', desc: 'Beat Merah Hitam (RC)',  ownerId: 'own_pipes', category: 'A', price: 70000, cc: '110 - 125', status: 'rented',    surfrack: true },
  { plate: 'DR 3233 UY', desc: 'Beat Silver',            ownerId: 'own_pipes', category: 'A', price: 70000, cc: '110 - 125', status: 'available', surfrack: false },
  { plate: 'DR 5451 UQ', desc: 'Beat Hitam',             ownerId: 'own_pipes', category: 'A', price: 70000, cc: '110 - 125', status: 'rented',    surfrack: false },
  { plate: 'DR 5246 VE', desc: 'Beat Hitam Putih',       ownerId: 'own_pipes', category: 'A', price: 70000, cc: '110 - 125', status: 'rented',    surfrack: true },

  // B — Staff
  { plate: 'DR 5814 TS', desc: 'Vario Putih',            ownerId: 'own_aqbinul', category: 'B', price: 70000, cc: '110 - 125', status: 'rented',    surfrack: true },
  { plate: 'DR 3839 UQ', desc: 'Beat Hitam Merah',       ownerId: 'own_aqbinul', category: 'B', price: 70000, cc: '110 - 125', status: 'available', surfrack: false },
  { plate: 'DR 3934 US', desc: 'Beat Merah (RC)',        ownerId: 'own_aqbinul', category: 'B', price: 70000, cc: '110 - 125', status: 'rented',    surfrack: false },
  { plate: 'DR 5250 UC', desc: 'Vario Merah (RC)',       ownerId: 'own_aqbinul', category: 'B', price: 70000, cc: '110 - 125', status: 'available', surfrack: true },
  { plate: 'DR 5081 UT', desc: 'Yamaha Gear',            ownerId: 'own_aqbinul', category: 'B', price: 70000, cc: '110 - 125', status: 'available', surfrack: false },
  { plate: 'DR 4699 VJ', desc: 'N-MAX Merah',            ownerId: 'own_aqbinul', category: 'B', price: 150000, cc: '150',     status: 'available', surfrack: true },
  { plate: 'DR 4700 VJ', desc: 'N-MAX Putih',            ownerId: 'own_aqbinul', category: 'B', price: 150000, cc: '150',     status: 'available', surfrack: true },
  { plate: 'Dr 3950 LR', desc: 'Mio GT Merah',           ownerId: 'own_arif',    category: 'B', price: 70000, cc: '110 - 125', status: 'available', surfrack: false },
  { plate: 'DR 3083 UG', desc: 'Beat Hitam (RC)',        ownerId: 'own_iwan',    category: 'B', price: 70000, cc: '110 - 125', status: 'available', surfrack: true },
  { plate: 'DR 6426 UV', desc: 'Beat Hitam (RC)',        ownerId: 'own_iwan',    category: 'B', price: 70000, cc: '110 - 125', status: 'available', surfrack: false },
  { plate: 'DR 5245 EJ', desc: 'Beat Hitam',             ownerId: 'own_iwan',    category: 'B', price: 70000, cc: '110 - 125', status: 'available', surfrack: false },
  { plate: 'DR 3651 UV', desc: 'Beat Hitam',             ownerId: 'own_iwan',    category: 'B', price: 70000, cc: '110 - 125', status: 'rented',    surfrack: false },
  { plate: 'DR 5460 VH', desc: 'Beat Merah',             ownerId: 'own_puri',    category: 'B', price: 70000, cc: '110 - 125', status: 'rented',    surfrack: true },
  { plate: 'DR 2709 MO', desc: 'Beat Hitam',             ownerId: 'own_yung',    category: 'B', price: 70000, cc: '110 - 125', status: 'available', surfrack: false },
  { plate: 'DR 5843 VF', desc: 'AEROX Hitam Merah',      ownerId: 'own_aqbinul', category: 'B', price: 150000, cc: '150',     status: 'available', surfrack: true },

  // C — Non Staff
  { plate: 'DR 3639 UM', desc: 'Beat Street (RC)',       ownerId: 'own_pait',  category: 'C', price: 70000, cc: '110 - 125', status: 'rented',    surfrack: true },
  { plate: 'DR 6586 TS', desc: 'Vario Hitam',            ownerId: 'own_pait',  category: 'C', price: 70000, cc: '110 - 125', status: 'available', surfrack: false },
  { plate: 'DR 3478 U',  desc: 'Vario Hitam Putih (RC)', ownerId: 'own_pait',  category: 'C', price: 70000, cc: '110 - 125', status: 'available', surfrack: true },
  { plate: 'DR 3409 VI', desc: 'Beat Abu',               ownerId: 'own_iqida', category: 'C', price: 70000, cc: '110 - 125', status: 'rented',    surfrack: false },
  { plate: 'DR 3017 UJ', desc: 'Beat Pink',              ownerId: 'own_iqida', category: 'C', price: 70000, cc: '110 - 125', status: 'available', surfrack: false },
  { plate: 'DR 2370 US', desc: 'Beat Hitam',             ownerId: 'own_masnun', category: 'C', price: 70000, cc: '110 - 125', status: 'available', surfrack: false },
];

// Sample rentals from the DataEntry CSV
const rentalsSeed = [
  {
    guest: 'Gavin Kone', start: '2025-12-20T08:18', finish: '2026-01-29T10:00',
    plate: 'DR 3083 UG', days: 40, ppd: 70000, payToOwner: 2000000, commission: 800000,
    staffGive: 'HAM', staffRcv: 'ARIF', method: 'Cash Box', damage: true, dmgDesc: 'Kunci hilang', dmgCharge: 150000,
    status: 'completed'
  },
  {
    guest: 'Rhys Singleton', start: '2026-03-23T14:29', finish: '2026-04-02T13:52',
    plate: 'Dr 3950 LR', days: 11, ppd: 70000, payToOwner: 550000, commission: 220000,
    staffGive: 'SAWAL', staffRcv: 'ARIF', method: 'Credit Card', damage: true, dmgDesc: 'Lecet', dmgCharge: 75000,
    status: 'completed'
  },
  {
    guest: 'Marisa Emadi', start: '2026-03-16T11:12', finish: '2026-04-03T15:19',
    plate: 'DR 3639 UM', days: 19, ppd: 70000, payToOwner: 950000, commission: 380000,
    staffGive: 'HANI', staffRcv: 'SAWAL', method: 'Credit Card', damage: true, dmgDesc: 'Cover knalpot patah', dmgCharge: 50000,
    status: 'completed'
  },
  {
    guest: 'Calum Gray', start: '2026-04-18T14:07', finish: '2026-04-18T16:12',
    plate: 'DR 3651 UV', days: 1, ppd: 70000, payToOwner: 50000, commission: 20000,
    staffGive: 'AMY', staffRcv: 'RIZKY', method: 'Credit Card', damage: false,
    status: 'completed'
  },
  {
    guest: 'Femke Knaven', start: '2026-04-19T12:42', finish: '2026-04-25T10:11',
    plate: 'DR 2709 MO', days: 6, ppd: 70000, payToOwner: 300000, commission: 120000,
    staffGive: 'AMY', staffRcv: 'SAWAL', method: 'Credit Card', damage: true, dmgDesc: 'Baret body samping', dmgCharge: 50000,
    status: 'completed'
  },
  {
    guest: 'Sean Twamley', start: '2026-05-06T10:02', finish: '2026-05-12T08:57',
    plate: 'Dr 3950 LR', days: 6, ppd: 70000, payToOwner: 300000, commission: 120000,
    staffGive: 'ARIF', staffRcv: 'AMY', method: 'Credit Card', damage: true, dmgDesc: 'Phone holder hilang', dmgCharge: 50000,
    status: 'completed'
  },
  {
    guest: 'Lilly Laserich', start: '2026-05-08T13:54', finish: '2026-05-14T09:07',
    plate: 'DR 5245 EJ', days: 6, ppd: 70000, payToOwner: 300000, commission: 120000,
    staffGive: 'SAWAL', staffRcv: 'SAWAL', method: 'Credit Card', damage: true, dmgDesc: 'Phone holder hilang', dmgCharge: 50000,
    status: 'completed'
  },
  // Active rentals (sedang berlangsung)
  {
    guest: 'Zoe Lekan', start: '2026-05-05T08:01', finish: '2026-05-30T18:00',
    plate: 'DR 3409 VI', days: 25, ppd: 70000, payToOwner: 1250000, commission: 500000,
    staffGive: 'ARIF', staffRcv: '', method: 'Credit Card', damage: false,
    status: 'active'
  },
  {
    guest: 'Violette Palanche', start: '2026-05-22T12:54', finish: '2026-05-29T11:00',
    plate: 'DR 2730 UP', days: 7, ppd: 70000, payToOwner: 350000, commission: 140000,
    staffGive: 'SAWAL', staffRcv: '', method: 'Cash Box', damage: false,
    status: 'active'
  },
  {
    guest: 'Kendall Raymond', start: '2026-05-25T07:23', finish: '2026-05-31T14:44',
    plate: 'DR 5451 UQ', days: 6, ppd: 70000, payToOwner: 300000, commission: 120000,
    staffGive: 'AMY', staffRcv: '', method: 'Credit Card', damage: false,
    status: 'active'
  },
];

// Seed staff from the names that appear in the DataEntry Pipes CSV
const staffSeed = [
  { name: 'AMY',   role: 'staff' },
  { name: 'SAWAL', role: 'staff' },
  { name: 'RIZKY', role: 'staff' },
  { name: 'ARIF',  role: 'staff' },
  { name: 'HANI',  role: 'staff' },
  { name: 'HAM',   role: 'staff' },
  { name: 'HAN',   role: 'staff' },
];

export function loadSeedData() {
  // 1. Owners
  const ownersWithMeta = ownersSeed.map(o => ({
    ...o,
    commissionPercent: 0,
    notes: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
  state.set('owners', ownersWithMeta);

  // 1b. Staff
  const staffWithMeta = staffSeed.map(s => ({
    id: uid('stf'),
    name: s.name,
    role: s.role,
    active: true,
    notes: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
  state.set('staff', staffWithMeta);

  // 2. Motors — status & currentRentalId are recomputed below based on active rentals
  const motorsWithMeta = motorsSeed.map(m => {
    const owner = ownersSeed.find(o => o.id === m.ownerId);
    // PTO per motor — fall back to 71% of the price if not set
    const pto = m.pto != null ? m.pto : Math.round(m.price * 0.71);
    return {
      id: uid('mot'),
      plate: m.plate,
      description: m.desc,
      cc: m.cc,
      pricePerDay: m.price,
      payToOwnerPerDay: pto,
      ownerId: m.ownerId,
      ownerName: owner?.name || '',
      category: m.category,
      hasSurfrack: !!m.surfrack,
      phoneHolder: !!m.phoneHolder,
      gps: !!m.gps,
      status: 'available',           // default → becomes 'rented' if an active rental references this motor
      currentRentalId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });
  state.set('motors', motorsWithMeta);

  // 3. Rentals
  const damages = [];
  const rentalsWithMeta = rentalsSeed.map(r => {
    const motor = motorsWithMeta.find(m => m.plate.toLowerCase() === r.plate.toLowerCase());
    const rentalId = uid('rnt');
    const totalCost = r.payToOwner + r.commission;
    // Multi-flag mapping from the old status
    const isCompletedOld = r.status === 'completed';
    const newStatus = isCompletedOld ? 'returned' : r.status;
    const ptoPerDay = r.days > 0 ? Math.round(r.payToOwner / r.days) : 50000;

    const rental = {
      id: rentalId,
      guestName: r.guest,
      passportNo: '',
      // ---- Passport workflow (multi-phase) ----
      propertyCheckedOut: false,
      passportHeld: r.status === 'active',     // demo: assume active rentals have the passport held (TBC actual seeding R9)
      passportHeldAt: r.status === 'active' ? r.start : null,
      keepPassport: r.status === 'active',     // backward compat, to be removed in R9
      // ---- Dates ----
      startDate: r.start,
      finishDate: r.finish,
      actualFinishDate: isCompletedOld ? r.finish : null,
      // ---- Motor & owner ----
      motorId: motor?.id,
      motorPlate: r.plate,
      motorDescription: motor?.description || '',
      ownerId: motor?.ownerId,
      ownerName: motor?.ownerName || '',
      // ---- Money ----
      pricePerDay: r.ppd,
      payToOwnerPerDay: ptoPerDay,
      totalDays: r.days,
      totalCost,
      payToOwner: r.payToOwner,
      commission: r.commission,
      paymentMethod: r.method,
      // ---- Staff ----
      staffGivesKey: r.staffGive,
      staffReceivesKey: r.staffRcv || '',
      // ---- Damage ----
      newDamage: !!r.damage,
      damageDescription: r.dmgDesc || '',
      damageCharge: r.dmgCharge || 0,
      damageResolved: isCompletedOld ? !r.damage : false,
      // ---- Status multi-flag ----
      status: newStatus,                       // 'active' | 'returned' | 'cancelled'
      paid: isCompletedOld,
      paidAt: isCompletedOld ? r.finish : null,
      ownerSettled: isCompletedOld,
      ownerSettledAt: isCompletedOld ? r.finish : null,
      ownerPaid: isCompletedOld,               // backward compat
      // ---- Meta ----
      notes: '',
      createdAt: r.start,
      updatedAt: new Date().toISOString(),
    };
    if (r.damage) {
      damages.push({
        id: uid('dmg'),
        rentalId,
        motorId: motor?.id,
        motorPlate: r.plate,
        description: r.dmgDesc,
        charge: r.dmgCharge,
        date: r.finish,
        resolved: r.status === 'completed',
        createdAt: r.finish,
      });
    }
    return rental;
  });
  state.set('rentals', rentalsWithMeta);
  state.set('damages', damages);

  // Reconcile motor.status berdasarkan rentals aktif (sync source of truth)
  const activeRentalsByMotor = new Map();
  rentalsWithMeta.forEach(r => {
    if (r.status === 'active' && r.motorId) activeRentalsByMotor.set(r.motorId, r.id);
  });
  const reconciledMotors = motorsWithMeta.map(m => {
    const rentalId = activeRentalsByMotor.get(m.id);
    return rentalId
      ? { ...m, status: 'rented', currentRentalId: rentalId }
      : m;
  });
  state.set('motors', reconciledMotors);

  return {
    owners: ownersWithMeta.length,
    staff: staffWithMeta.length,
    motors: reconciledMotors.length,
    rentals: rentalsWithMeta.length,
    damages: damages.length,
  };
}
