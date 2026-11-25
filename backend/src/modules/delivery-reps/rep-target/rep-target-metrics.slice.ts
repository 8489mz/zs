import { type MoneyDigits, roundMoney as roundBookMoney } from '../../accounting/engines/money-minor-units.engine';

export interface RepTargetCalculationInput {
  targetAmount: number;
  actualSalesMTD: number;
  collectionTarget?: number | null;
  actualCollectionsMTD?: number;
  visitsTarget?: number | null;
  actualVisitsMTD?: number;
  currentDate?: Date | string;
  weekendDays?: number[]; // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat (Default [5] for Friday)
  officialHolidays?: string[]; // Array of 'YYYY-MM-DD' strings
  // REQUIRED (INV-REP-TARGET-METRICS-DIGITS): normalizes the money
  // inputs at the tenant's book digits. The remaining/required-daily
  // outputs deliberately stay whole units and do not take digits.
  moneyDigits: MoneyDigits;
}

export interface RepTargetCalculationResult {
  periodMonth: string; // 'YYYY-MM'
  targetAmount: number;
  actualSalesMTD: number;
  achievementRate: number; // percentage (e.g. 62.5)
  remainingTarget: number;
  isTargetAchieved: boolean;
  totalDaysInMonth: number;
  currentDayOfMonth: number;
  remainingDaysTotal: number;
  remainingWorkingDays: number;
  requiredDailyTarget: number;
  excludedFridaysCount: number;
  excludedHolidaysCount: number;
  // Multi-dimensional targets
  collectionTarget?: number | null;
  actualCollectionsMTD?: number;
  collectionAchievementRate?: number | null;
  remainingCollection?: number;
  requiredDailyCollection?: number;
  isCollectionAchieved?: boolean;
  visitsTarget?: number | null;
  actualVisitsMTD?: number;
  visitsAchievementRate?: number | null;
  remainingVisits?: number;
  requiredDailyVisits?: number;
  isVisitsAchieved?: boolean;
}

export function calculateRepTargetMetrics(input: RepTargetCalculationInput): RepTargetCalculationResult {
  const target = Math.max(0, roundBookMoney(Number(input.targetAmount || 0), input.moneyDigits));
  const actual = Math.max(0, roundBookMoney(Number(input.actualSalesMTD || 0), input.moneyDigits));

  // Date parsing in local/UTC context
  let dateObj: Date;
  if (!input.currentDate) {
    dateObj = new Date();
  } else if (input.currentDate instanceof Date) {
    dateObj = new Date(input.currentDate.getTime());
  } else {
    // If string like '2026-09-26'
    const parts = String(input.currentDate).split('T')[0].split('-');
    if (parts.length === 3) {
      dateObj = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    } else {
      dateObj = new Date(input.currentDate);
    }
  }

  const year = dateObj.getFullYear();
  const month = dateObj.getMonth(); // 0-indexed (0=Jan, 8=Sep)
  const currentDay = dateObj.getDate();

  const periodMonth = `${year}-${String(month + 1).padStart(2, '0')}`;

  // Total calendar days in this month
  const lastDayOfMonthObj = new Date(year, month + 1, 0);
  const totalDaysInMonth = lastDayOfMonthObj.getDate();

  const weekendDays = input.weekendDays && input.weekendDays.length ? input.weekendDays : [5]; // Default Friday (5)
  const holidaySet = new Set<string>((input.officialHolidays || []).map((h) => String(h).trim().slice(0, 10)));

  // Remaining days counting from today inclusive through end of month
  let remainingDaysTotal = 0;
  let remainingWorkingDays = 0;
  let excludedFridaysCount = 0;
  let excludedHolidaysCount = 0;

  for (let d = currentDay; d <= totalDaysInMonth; d++) {
    remainingDaysTotal++;
    const testDate = new Date(year, month, d);
    const dayOfWeek = testDate.getDay(); // 0=Sun, 5=Fri, 6=Sat
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

    const isWeekend = weekendDays.includes(dayOfWeek);
    const isHoliday = holidaySet.has(dateStr);

    if (isWeekend) {
      excludedFridaysCount++;
    } else if (isHoliday) {
      excludedHolidaysCount++;
    } else {
      remainingWorkingDays++;
    }
  }

  const achievementRate = target > 0 ? Number(((actual / target) * 100).toFixed(1)) : 0;
  const remainingTarget = Math.max(0, Math.round(target - actual));
  const isTargetAchieved = actual >= target && target > 0;

  let requiredDailyTarget = 0;
  if (!isTargetAchieved && remainingTarget > 0) {
    if (remainingWorkingDays > 0) {
      requiredDailyTarget = Math.ceil(remainingTarget / remainingWorkingDays);
    } else {
      // If no working days left in the month, remaining must be done today
      requiredDailyTarget = remainingTarget;
    }
  }

  // Multi-dimensional: Collection Target Calculations
  const colTarget =
    input.collectionTarget !== undefined && input.collectionTarget !== null && !isNaN(Number(input.collectionTarget))
      ? Math.max(0, Math.round(Number(input.collectionTarget)))
      : null;
  const colActual =
    input.actualCollectionsMTD !== undefined && input.actualCollectionsMTD !== null
      ? Math.max(0, roundBookMoney(Number(input.actualCollectionsMTD), input.moneyDigits))
      : 0;

  const collectionAchievementRate =
    colTarget && colTarget > 0 ? Number(((colActual / colTarget) * 100).toFixed(1)) : null;
  const remainingCollection = colTarget && colTarget > 0 ? Math.max(0, Math.round(colTarget - colActual)) : 0;
  const isCollectionAchieved = colTarget && colTarget > 0 ? colActual >= colTarget : false;
  let requiredDailyCollection = 0;
  if (colTarget && colTarget > 0 && !isCollectionAchieved && remainingCollection > 0) {
    requiredDailyCollection =
      remainingWorkingDays > 0 ? Math.ceil(remainingCollection / remainingWorkingDays) : remainingCollection;
  }

  // Multi-dimensional: Visits Target Calculations
  const visTarget =
    input.visitsTarget !== undefined && input.visitsTarget !== null && !isNaN(Number(input.visitsTarget))
      ? Math.max(0, Math.round(Number(input.visitsTarget)))
      : null;
  const visActual =
    input.actualVisitsMTD !== undefined && input.actualVisitsMTD !== null
      ? Math.max(0, Math.round(Number(input.actualVisitsMTD)))
      : 0;

  const visitsAchievementRate = visTarget && visTarget > 0 ? Number(((visActual / visTarget) * 100).toFixed(1)) : null;
  const remainingVisits = visTarget && visTarget > 0 ? Math.max(0, visTarget - visActual) : 0;
  const isVisitsAchieved = visTarget && visTarget > 0 ? visActual >= visTarget : false;
  let requiredDailyVisits = 0;
  if (visTarget && visTarget > 0 && !isVisitsAchieved && remainingVisits > 0) {
    requiredDailyVisits =
      remainingWorkingDays > 0 ? Math.ceil(remainingVisits / remainingWorkingDays) : remainingVisits;
  }

  return {
    periodMonth,
    targetAmount: target,
    actualSalesMTD: actual,
    achievementRate,
    remainingTarget,
    isTargetAchieved,
    totalDaysInMonth,
    currentDayOfMonth: currentDay,
    remainingDaysTotal,
    remainingWorkingDays,
    requiredDailyTarget,
    excludedFridaysCount,
    excludedHolidaysCount,
    collectionTarget: colTarget,
    actualCollectionsMTD: colActual,
    collectionAchievementRate,
    remainingCollection,
    requiredDailyCollection,
    isCollectionAchieved,
    visitsTarget: visTarget,
    actualVisitsMTD: visActual,
    visitsAchievementRate,
    remainingVisits,
    requiredDailyVisits,
    isVisitsAchieved,
  };
}
