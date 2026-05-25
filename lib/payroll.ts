import { supabase } from './supabase'
import { differenceInMonths, format, addMonths } from 'date-fns'

// ─── 法定付与テーブル ─────────────────────────────────
// インデックス: 0=6ヶ月, 1=1.5年, 2=2.5年, 3=3.5年, 4=4.5年, 5=5.5年, 6=6.5年以上
const ACCRUAL_TABLE: Record<string, number[]> = {
  'full': [10, 11, 12, 14, 16, 18, 20], // 週5日以上
  'pt4':  [7,  8,  9, 10, 12, 13, 15],  // 週4日
  'pt3':  [5,  6,  6,  8,  9, 10, 11],  // 週3日
  'pt2':  [3,  4,  4,  5,  6,  6,  7],  // 週2日
  'pt1':  [1,  2,  2,  2,  3,  3,  3],  // 週1日
}

// 付与タイミング（勤続月数）
const ACCRUAL_MONTHS = [6, 18, 30, 42, 54, 66, 78]

/**
 * 勤続月数と週所定日数から法定付与日数を返す
 */
export function calcGrantDays(monthsOfService: number, weeklyDays: number): number {
  const idx = ACCRUAL_MONTHS.findIndex(m => monthsOfService < m)
  if (idx === -1 && monthsOfService >= 78) {
    // 6.5年以上 → 最大20日（週5以上）固定
    const tableIdx = 6
    return getDaysByWeekly(weeklyDays, tableIdx)
  }
  if (idx === 0) return 0 // 6ヶ月未満は付与なし
  const tableIdx = idx === -1 ? 6 : idx - 1
  return getDaysByWeekly(weeklyDays, tableIdx)
}

function getDaysByWeekly(weeklyDays: number, idx: number): number {
  const key = weeklyDays >= 5 ? 'full'
    : weeklyDays >= 4 ? 'pt4'
    : weeklyDays >= 3 ? 'pt3'
    : weeklyDays >= 2 ? 'pt2'
    : 'pt1'
  return ACCRUAL_TABLE[key][idx] ?? 0
}

/**
 * 次回付与日を計算
 */
export function calcNextAccrualDate(hireDate: Date, today: Date = new Date()): Date {
  const months = differenceInMonths(today, hireDate)
  const nextMonths = ACCRUAL_MONTHS.find(m => m > months) ?? 78
  return addMonths(hireDate, nextMonths)
}

/**
 * 有給付与を実行（繰越・時効消滅を含む）
 * @returns 付与結果
 */
export async function executeLeaveAccrual(userId: string): Promise<{
  success: boolean
  granted: number
  carriedOver: number
  expired: number
  newBalance: number
  message: string
} | null> {
  // プロフィール取得
  const { data: profile } = await supabase
    .from('profiles')
    .select('hire_date, weekly_scheduled_days, annual_leave_days, used_leave_days')
    .eq('id', userId)
    .single()

  if (!profile?.hire_date) return null

  const hireDate = new Date(profile.hire_date)
  const today = new Date()
  const monthsOfService = differenceInMonths(today, hireDate)

  // 付与日数を計算
  const grantDays = calcGrantDays(monthsOfService, profile.weekly_scheduled_days ?? 5)
  if (grantDays === 0) return null

  // 現在の残日数
  const currentBalance = profile.annual_leave_days - profile.used_leave_days

  // 2年前の付与分を時効消滅（簡易実装：前々回付与分を削除）
  const { data: oldHistory } = await supabase
    .from('leave_accrual_history')
    .select('days_granted, accrual_date')
    .eq('user_id', userId)
    .lt('accrual_date', format(addMonths(today, -24), 'yyyy-MM-dd'))
    .order('accrual_date', { ascending: false })
    .limit(1)

  const expiredDays = oldHistory?.[0]?.days_granted ?? 0

  // 繰越上限40日を超えないよう調整
  const balanceAfterExpiry = Math.max(currentBalance - expiredDays, 0)
  const newBalance = Math.min(balanceAfterExpiry + grantDays, 40)
  const actualGrant = newBalance - balanceAfterExpiry

  // 付与履歴を記録
  await supabase.from('leave_accrual_history').insert({
    user_id: userId,
    accrual_date: format(today, 'yyyy-MM-dd'),
    days_granted: actualGrant,
    days_carried_over: balanceAfterExpiry,
    days_expired: expiredDays,
    balance_before: currentBalance,
    balance_after: newBalance,
    accrual_type: 'auto',
  })

  // プロフィールの有給日数を更新
  await supabase.from('profiles').update({
    annual_leave_days: newBalance + profile.used_leave_days,
  }).eq('id', userId)

  return {
    success: true,
    granted: actualGrant,
    carriedOver: balanceAfterExpiry,
    expired: expiredDays,
    newBalance,
    message: `${actualGrant}日付与（繰越${balanceAfterExpiry}日、時効消滅${expiredDays}日）→ 残${newBalance}日`,
  }
}

/**
 * 交通費計算
 */
export function calcTransportFee(params: {
  commuteType: 'train' | 'car' | 'bicycle' | 'none'
  monthlyFee?: number        // 電車定期代
  distanceKm?: number        // マイカー距離
  carRateType?: 'legal' | 'custom'
  customRate?: number        // 独自単価（円/km）
  workDays?: number          // パート出勤日数
  dailyRate?: number         // パート日額単価
}): number {
  const { commuteType, monthlyFee, distanceKm, carRateType, customRate, workDays, dailyRate } = params

  switch (commuteType) {
    case 'train':
      return monthlyFee ?? 0

    case 'car': {
      if (!distanceKm) return 0
      if (carRateType === 'custom' && customRate) {
        // 独自単価: 距離×単価×往復×実出勤日数
        const days = workDays ?? 20
        return Math.round(distanceKm * customRate * 2 * days)
      } else {
        // 法定上限（月額固定）
        return calcLegalCarCommute(distanceKm)
      }
    }

    case 'bicycle':
      return 0 // 自転車は非課税なし（会社独自ルール次第）

    case 'none':
    default:
      return 0
  }
}

function calcLegalCarCommute(km: number): number {
  if (km < 2)  return 0
  if (km < 10) return 2000
  if (km < 15) return 4200
  if (km < 25) return 7100
  if (km < 35) return 12900
  if (km < 45) return 18700
  if (km < 55) return 24400
  return 31600
}

/**
 * ボーナス試算
 */
export function calcBonus(params: {
  baseAmount: number       // 賞与ベース額
  evaluationScore: number  // 評価点数（0〜10）
  lateCount: number        // 遅刻回数
  absentDays: number       // 欠勤日数
  lateDeductionRate?: number   // 遅刻1回あたり控除率（デフォルト1%）
  absentDeductionRate?: number // 欠勤1日あたり控除率（デフォルト2%）
}): {
  baseAmount: number
  evalMultiplier: number
  lateDeduction: number
  absentDeduction: number
  totalDeduction: number
  finalAmount: number
} {
  const {
    baseAmount, evaluationScore, lateCount, absentDays,
    lateDeductionRate = 0.01,
    absentDeductionRate = 0.02,
  } = params

  // 評価倍率: 点数/10 × 2（0点=0倍、5点=1倍、10点=2倍）
  const evalMultiplier = (evaluationScore / 10) * 2

  // 評価後の基準額
  const evalBase = Math.round(baseAmount * evalMultiplier)

  // 遅刻・欠勤控除
  const lateDeduction = Math.round(evalBase * lateDeductionRate * lateCount)
  const absentDeduction = Math.round(evalBase * absentDeductionRate * absentDays)
  const totalDeduction = lateDeduction + absentDeduction

  const finalAmount = Math.max(evalBase - totalDeduction, 0)

  return {
    baseAmount: evalBase,
    evalMultiplier,
    lateDeduction,
    absentDeduction,
    totalDeduction,
    finalAmount,
  }
}
