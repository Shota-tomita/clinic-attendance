import { addDays, subDays, format, parseISO, getDay, eachDayOfInterval } from 'date-fns'

// 日本の祝日API（内閣府）
const HOLIDAY_API = 'https://holidays-jp.github.io/api/v1/date.json'

let cachedHolidays: Record<string, string> | null = null

export async function fetchJapaneseHolidays(): Promise<Record<string, string>> {
  if (cachedHolidays) return cachedHolidays
  try {
    const res = await fetch(HOLIDAY_API)
    cachedHolidays = await res.json()
    return cachedHolidays!
  } catch {
    return {}
  }
}

export type HolidaySettings = {
  min_consecutive_days: number  // 連休と見なす最小日数（デフォルト3）
  buffer_days: number           // 前後何日を特別期間とするか（デフォルト2）
  closed_weekdays: number[]     // 定休曜日 0=日,1=月...6=土 (デフォルト [0,4]=日・木)
  include_holidays: boolean     // 祝日を定休に含める
}

/**
 * 指定した年月の日付が「定休日」かどうか判定
 */
export function isClosedDay(
  date: Date,
  holidays: Record<string, string>,
  settings: HolidaySettings
): boolean {
  const dow = getDay(date)
  const dateStr = format(date, 'yyyy-MM-dd')

  if (settings.closed_weekdays.includes(dow)) return true
  if (settings.include_holidays && holidays[dateStr]) return true
  return false
}

/**
 * 年全体の連休ブロックを自動検出して返す
 * 戻り値: [{start, end, days}] の配列
 */
export async function detectConsecutiveHolidays(
  year: number,
  settings: HolidaySettings
): Promise<Array<{ start: string; end: string; days: number; label: string }>> {
  const holidays = await fetchJapaneseHolidays()
  const results: Array<{ start: string; end: string; days: number; label: string }> = []

  const yearStart = new Date(year, 0, 1)
  const yearEnd = new Date(year, 11, 31)
  const allDays = eachDayOfInterval({ start: yearStart, end: yearEnd })

  let blockStart: Date | null = null
  let blockDays = 0

  for (let i = 0; i <= allDays.length; i++) {
    const day = allDays[i]
    const closed = day ? isClosedDay(day, holidays, settings) : false

    if (closed) {
      if (!blockStart) blockStart = day
      blockDays++
    } else {
      if (blockStart && blockDays >= settings.min_consecutive_days) {
        const blockEnd = allDays[i - 1]
        const startStr = format(blockStart, 'yyyy-MM-dd')
        const endStr = format(blockEnd, 'yyyy-MM-dd')

        // ラベル付け
        let label = `連休(${blockDays}日間)`
        if (startStr >= `${year}-04-29` && endStr <= `${year}-05-06`) label = 'GW'
        else if (startStr >= `${year}-08-10` && endStr <= `${year}-08-16`) label = 'お盆'
        else if (startStr >= `${year}-12-28` || endStr <= `${year}-01-04`) label = '年末年始'

        results.push({ start: startStr, end: endStr, days: blockDays, label })
      }
      blockStart = null
      blockDays = 0
    }
  }

  return results
}

/**
 * 特別申請期間（連休前後 buffer_days 日）の日付セットを返す
 */
export async function getSpecialLeavePeriods(
  year: number,
  settings: HolidaySettings
): Promise<Set<string>> {
  const blocks = await detectConsecutiveHolidays(year, settings)
  const specialDates = new Set<string>()

  for (const block of blocks) {
    const start = parseISO(block.start)
    const end = parseISO(block.end)

    // 前 buffer_days 日
    for (let i = 1; i <= settings.buffer_days; i++) {
      specialDates.add(format(subDays(start, i), 'yyyy-MM-dd'))
    }
    // 後 buffer_days 日
    for (let i = 1; i <= settings.buffer_days; i++) {
      specialDates.add(format(addDays(end, i), 'yyyy-MM-dd'))
    }
  }

  return specialDates
}

/**
 * 指定日が特別申請期間かどうか確認
 */
export async function isSpecialLeavePeriod(
  dateStr: string,
  settings: HolidaySettings
): Promise<{ isSpecial: boolean; nearestHoliday?: string }> {
  const year = parseInt(dateStr.slice(0, 4))
  // 年またぎ対応
  const years = [year - 1, year, year + 1]
  for (const y of years) {
    const periods = await getSpecialLeavePeriods(y, settings)
    if (periods.has(dateStr)) {
      return { isSpecial: true }
    }
  }
  return { isSpecial: false }
}

/**
 * 申請日付範囲内に特別期間が含まれるか確認
 */
export async function hasSpecialPeriodInRange(
  startDate: string,
  endDate: string,
  settings: HolidaySettings
): Promise<boolean> {
  const start = parseISO(startDate)
  const end = parseISO(endDate)
  const days = eachDayOfInterval({ start, end })
  for (const day of days) {
    const { isSpecial } = await isSpecialLeavePeriod(format(day, 'yyyy-MM-dd'), settings)
    if (isSpecial) return true
  }
  return false
}
