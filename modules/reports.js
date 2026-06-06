// =============================================================
// modules/reports.js
// ReportEngine — aggregations for dashboard & reports page
// =============================================================

import { MotorManager } from './motors.js';
import { RentalManager } from './rentals.js';
import { OwnerManager } from './owners.js';
import { DamageManager } from './damages.js';
import { groupBy, sumBy } from './utils.js';

export const ReportEngine = {
  // Dashboard KPIs
  overview() {
    const motors = MotorManager.list();
    const rented = MotorManager.rented();
    const available = MotorManager.available();
    const activeRentals = RentalManager.active();
    const passportsKept = RentalManager.countPassportsKept();
    const today = RentalManager.todayStats();
    const ym = new Date().toISOString().slice(0, 7);
    const month = RentalManager.monthStats(ym);

    return {
      totalMotors: motors.length,
      motorsRented: rented.length,
      motorsAvailable: available.length,
      utilizationPct: motors.length ? Math.round((rented.length / motors.length) * 100) : 0,
      activeRentals: activeRentals.length,
      passportsKept,
      newToday: today.newToday,
      revenueToday: today.revenueToday,
      revenueMonth: month.revenue,
      commissionMonth: month.commission,
      payToOwnerMonth: month.payToOwner,
      damageRecoveryMonth: month.damageRecovery,
    };
  },

  // Rental volume per day (last N days)
  rentalsByDay(days = 14) {
    const out = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const count = RentalManager.list().filter(r =>
        (r.createdAt || '').slice(0, 10) === key && r.status !== 'cancelled'
      ).length;
      out.push({ date: key, label: d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }), count });
    }
    return out;
  },

  // Online vs walk-in rental counts for one month (default: current month).
  // Cancelled excluded. walkin = remainder, so it's robust to a missing source.
  channelCounts(ym = new Date().toISOString().slice(0, 7)) {
    const list = RentalManager.list().filter(r =>
      (r.createdAt || '').slice(0, 7) === ym && r.status !== 'cancelled');
    const online = list.filter(r => r.source === 'online').length;
    return { online, walkin: list.length - online, total: list.length };
  },

  // Earnings per owner (current month, completed)
  earningsByOwner(yearMonth) {
    const ym = yearMonth || new Date().toISOString().slice(0, 7);
    const rentals = RentalManager.completed().filter(r => (r.createdAt || '').slice(0, 7) === ym);
    const groups = groupBy(rentals, 'ownerId');
    return Object.entries(groups).map(([ownerId, list]) => {
      const owner = OwnerManager.get(ownerId);
      // The owner receives rental PTO + damage recovery (damage compensates
      // their asset), so the earning total includes both.
      const ptoSum = sumBy(list, 'payToOwner');
      const damageSum = sumBy(list, r => (r.newDamage ? (r.damageCharge || 0) : 0));
      return {
        ownerId,
        ownerName: owner?.name || list[0]?.ownerName || 'Unknown',
        rentalCount: list.length,
        totalDays: sumBy(list, 'totalDays'),
        payToOwner: ptoSum,
        damageRecovery: damageSum,
        totalEarning: ptoSum + damageSum,
        commission: sumBy(list, 'commission'),
      };
    }).sort((a, b) => b.totalEarning - a.totalEarning);
  },

  // Category distribution
  motorsByCategory() {
    const motors = MotorManager.list();
    const groups = groupBy(motors, 'category');
    return ['A', 'B', 'C'].map(cat => ({
      category: cat,
      label: cat === 'A' ? 'Properti' : cat === 'B' ? 'Staf' : 'Non Staf',
      count: (groups[cat] || []).length,
      rented: (groups[cat] || []).filter(m => m.status === 'rented').length,
    }));
  },

  // Top earning motors
  topMotors(limit = 5, yearMonth) {
    const ym = yearMonth || new Date().toISOString().slice(0, 7);
    const rentals = RentalManager.completed().filter(r => (r.createdAt || '').slice(0, 7) === ym);
    const groups = groupBy(rentals, 'motorId');
    return Object.entries(groups).map(([motorId, list]) => {
      const motor = MotorManager.get(motorId);
      return {
        motorId,
        plate: motor?.plate || list[0]?.motorPlate || '',
        description: motor?.description || list[0]?.motorDescription || '',
        rentalCount: list.length,
        revenue: sumBy(list, 'totalCost'),
      };
    }).sort((a, b) => b.revenue - a.revenue).slice(0, limit);
  },
};
