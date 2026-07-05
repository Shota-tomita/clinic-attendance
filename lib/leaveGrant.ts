// lib/leaveGrant.ts
// 有給付与の自動計算・更新ロジック

import { createClient } from '@supabase/supabase-js'

// 正社員付与テーブル（勤続月数: 付与日数）
const FULL_TIME_TABLE: Record<number, number> = {
  6: 10, 18: 11, 30: 12, 42: 14, 54: 16, 66: 18, 78: 20
}

// パート比例付与テーブル（週所定日数: {勤続月数: 付与日数}）
const PART_TIME_TABLE: Record<number, Record<number, number>> = {
  4: { 6:7, 18:8, 30:9, 42:10, 54:12, 66:13, 78:15 },
  3: { 6:5, 18:6, 30:6, 42:8,  54:9,  66:10, 78:11 },
  2: { 6:3, 18:4, 30:4, 42:5,  54:6,  66:6,  78:7  },
  1: { 6:1, 18:2, 30:2, 42:2,  54:3,  66:3,  78:3  },
}

// 勤続月数から付与日数を取得
export function calcGrantDays(
  employmentType: string,
  weeklyWorkDays: number,
  tenureMonths: number
): number {
  const table = employmentType === 'full_time'
    ? FULL_TIME_TABLE
    : PART_TIME_TABLE[Math.min(weeklyWorkDays, 4)] ?? PART_TIME_TABLE[1]

  // 付与対象の勤続月数の閾値（昇順）
  const thresholds = Object.keys(table).map(Number).sort((a, b) => a - b)

  // 現在の勤続月数に対応する付与日数（最大の閾値以下）
  let days = 0
  for (const threshold of thresholds) {
    if (tenureMonths >= threshold) {
      days = table[threshold]
    }
  }
  return days
}

// 次回付与日を計算（入職日から6ヶ月後、以降12ヶ月ごと）
export function calcNextGrantDate(hireDate: string, today: Date = new Date()): Date {
  const hire = new Date(hireDate)
  const next = new Date(hire)
  next.setMonth(next.getMonth() + 6)

  // 既に初回付与日を過ぎている場合、次の付与日を求める
  while (next <= today) {
    next.setFullYear(next.getFullYear() + 1)
  }
  return next
}

// 入職日から現在までの勤続月数を計算
export function calcTenureMonths(hireDate: string, today: Date = new Date()): number {
  const hire = new Date(hireDate)
  return (today.getFullYear() - hire.getFullYear()) * 12
    + (today.getMonth() - hire.getMonth())
}

// 付与が必要なスタッフを特定して更新
export async function processLeaveGrants(supabase: ReturnType<typeof createClient>) {
  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]

  // 本日が次回付与日のスタッフを取得
  const { data: staffList, error } = await supabase
    .from('profiles')
    .select('id, name, employment_type, hire_date, weekly_work_days, annual_leave_days, used_leave_days, next_leave_grant_date')
    .not('hire_date', 'is', null)

  if (error || !staffList) return { error, updated: [] }

  const updated: string[] = []

  for (const staff of staffList) {
    if (!staff.hire_date) continue
    // 週所定0日（月数回スタッフ）は付与対象外
    if ((staff.weekly_work_days ?? 0) === 0) continue

    const nextGrant = staff.next_leave_grant_date
      ? new Date(staff.next_leave_grant_date)
      : calcNextGrantDate(staff.hire_date, new Date('1900-01-01')) // 初回計算

    // 次回付与日が今日以前の場合は付与実行
    if (nextGrant <= today) {
      const tenureMonths = calcTenureMonths(staff.hire_date, today)
      const weeklyDays = staff.weekly_work_days ?? (staff.employment_type === 'full_time' ? 5 : 4)
      const grantDays = calcGrantDays(staff.employment_type, weeklyDays, tenureMonths)

      if (grantDays > 0) {
        // 次回付与日を計算
        const newNextGrant = calcNextGrantDate(staff.hire_date, today)

        await supabase
          .from('profiles')
          .update({
            annual_leave_days: grantDays,  // 付与日数をリセット（繰越なし）
            used_leave_days: 0,            // 使用日数リセット
            next_leave_grant_date: newNextGrant.toISOString().split('T')[0],
          })
          .eq('id', staff.id)

        updated.push(`${staff.name}: ${grantDays}日付与（勤続${tenureMonths}ヶ月）`)
      }
    }
  }

  return { error: null, updated }
}
