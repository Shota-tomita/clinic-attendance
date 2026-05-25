import { format, parseISO, differenceInMinutes } from 'date-fns'
import { ja } from 'date-fns/locale'
import { ShiftPatternBlock, ClockOutReason, EarlyFinishStatus } from './supabase'

// ─── 日付・時刻フォーマット ───────────────────────────

export const formatDate = (date: string | Date) => {
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, 'yyyy年M月d日(EEE)', { locale: ja })
}

export const formatDateShort = (date: string | Date) => {
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, 'M/d(EEE)', { locale: ja })
}

export const formatTime = (datetime: string | null | undefined) => {
  if (!datetime) return '--:--'
  return format(parseISO(datetime), 'HH:mm')
}

export const formatMinutes = (minutes: number): string => {
  if (minutes <= 0) return '0h00m'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}h${String(m).padStart(2, '0')}m`
}

export const todayString = () => format(new Date(), 'yyyy-MM-dd')

export const getCurrentMonth = () => format(new Date(), 'yyyy-MM')

export const getMonthRange = (yearMonth: string) => {
  const [year, month] = yearMonth.split('-').map(Number)
  const start = new Date(year, month - 1, 1)
  const end = new Date(year, month, 0)
  return {
    start: format(start, 'yyyy-MM-dd'),
    end: format(end, 'yyyy-MM-dd'),
  }
}

// ─── 変形労働時間制 計算ロジック ─────────────────────

/**
 * シフトブロック一覧からその日の所定労働時間（分）を計算
 * ブロック間の空き時間は含めない
 */
export const calcScheduledMinutes = (blocks: ShiftPatternBlock[]): number => {
  return blocks.reduce((sum, b) => {
    const [sh, sm] = b.start_time.split(':').map(Number)
    const [eh, em] = b.end_time.split(':').map(Number)
    return sum + (eh * 60 + em) - (sh * 60 + sm)
  }, 0)
}

/**
 * 実労働時間（分）を計算
 * 打刻の clock_in〜clock_out をそのまま使用（ブロック間の空き時間も含む）
 * ただし所定時間外の部分は残業判定で吸収される
 */
export const calcActualMinutes = (
  clockIn: string | null,
  clockOut: string | null
): number => {
  if (!clockIn || !clockOut) return 0
  return Math.max(differenceInMinutes(parseISO(clockOut), parseISO(clockIn)), 0)
}

/**
 * 遅刻分数を計算
 * 最初のブロック start_time と clock_in を比較
 */
export const calcLateMinutes = (
  blocks: ShiftPatternBlock[],
  clockIn: string | null,
  date: string
): number => {
  if (!clockIn || blocks.length === 0) return 0
  const sorted = [...blocks].sort((a, b) => a.sort_order - b.sort_order)
  const firstBlock = sorted[0]
  const [sh, sm] = firstBlock.start_time.split(':').map(Number)
  const scheduledStart = new Date(`${date}T${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}:00`)
  const diff = differenceInMinutes(parseISO(clockIn), scheduledStart)
  return Math.max(diff, 0)
}

/**
 * 早上がり/早退の分数を計算
 * 最後のブロック end_time と clock_out を比較
 */
export const calcEarlyMinutes = (
  blocks: ShiftPatternBlock[],
  clockOut: string | null,
  date: string
): number => {
  if (!clockOut || blocks.length === 0) return 0
  const sorted = [...blocks].sort((a, b) => b.sort_order - a.sort_order)
  const lastBlock = sorted[0]
  const [eh, em] = lastBlock.end_time.split(':').map(Number)
  const scheduledEnd = new Date(`${date}T${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}:00`)
  const diff = differenceInMinutes(scheduledEnd, parseISO(clockOut))
  return Math.max(diff, 0)
}

/**
 * 変形労働時間制の残業・控除を一括計算
 *
 * ルール:
 * - 残業 = MAX(実働 - 所定, 0)
 * - 遅刻控除 = 遅刻分（残業で相殺可: MAX(遅刻 - 残業, 0)）
 * - 早退控除:
 *   - early_leave → 控除あり
 *   - early_finish + 30分未満 → 控除なし
 *   - early_finish + 30分以上 + pending/rejected → 控除あり（早退扱い）
 *   - early_finish + 30分以上 + approved → 控除なし
 */
export type CalcResult = {
  scheduledMinutes: number
  actualMinutes: number
  overtimeMinutes: number
  lateMinutes: number
  earlyLeaveMinutes: number  // 控除対象の早上がり/早退分
  deductionMinutes: number   // 合計控除（遅刻相殺後）
  earlyFinishStatus: EarlyFinishStatus
}

export const calcAttendance = (params: {
  blocks: ShiftPatternBlock[]
  clockIn: string | null
  clockOut: string | null
  date: string
  clockOutReason: ClockOutReason
  currentEarlyFinishStatus: EarlyFinishStatus
  isAbsent: boolean
}): CalcResult => {
  const { blocks, clockIn, clockOut, date, clockOutReason, currentEarlyFinishStatus, isAbsent } = params

  if (isAbsent || !clockIn) {
    return {
      scheduledMinutes: calcScheduledMinutes(blocks),
      actualMinutes: 0,
      overtimeMinutes: 0,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      deductionMinutes: 0,
      earlyFinishStatus: 'not_required',
    }
  }

  const scheduledMinutes = calcScheduledMinutes(blocks)
  const actualMinutes = calcActualMinutes(clockIn, clockOut)
  const lateMinutes = calcLateMinutes(blocks, clockIn, date)
  const rawEarlyMinutes = calcEarlyMinutes(blocks, clockOut, date)

  // 早上がりステータスを決定
  let earlyFinishStatus: EarlyFinishStatus = currentEarlyFinishStatus
  let earlyLeaveMinutes = 0

  if (!clockOut || rawEarlyMinutes <= 0) {
    // 所定時間以降に退勤 → 早上がりなし
    earlyFinishStatus = 'not_required'
    earlyLeaveMinutes = 0
  } else if (clockOutReason === 'early_leave') {
    // 早退（体調不良）→ 控除あり、承認フロー不要
    earlyFinishStatus = 'not_required'
    earlyLeaveMinutes = rawEarlyMinutes
  } else if (clockOutReason === 'early_finish') {
    if (rawEarlyMinutes < 30) {
      // 30分未満の早上がり → 承認不要、控除なし
      earlyFinishStatus = 'not_required'
      earlyLeaveMinutes = 0
    } else {
      // 30分以上の早上がり → 承認フロー
      if (currentEarlyFinishStatus === 'not_required') {
        earlyFinishStatus = 'pending'
      }
      if (earlyFinishStatus === 'approved') {
        earlyLeaveMinutes = 0  // 承認済 → 控除なし
      } else {
        earlyLeaveMinutes = rawEarlyMinutes  // 未承認/否認 → 控除あり
      }
    }
  } else {
    // normal退勤で所定より早い → 控除なし（業務完了扱い）
    earlyFinishStatus = 'not_required'
    earlyLeaveMinutes = 0
  }

  // 残業 = 実働 - 所定（マイナスは0）
  const overtimeMinutes = Math.max(actualMinutes - scheduledMinutes, 0)

  // 遅刻控除: 残業で相殺
  const netLateDeduction = Math.max(lateMinutes - overtimeMinutes, 0)

  // 合計控除
  const deductionMinutes = netLateDeduction + earlyLeaveMinutes

  return {
    scheduledMinutes,
    actualMinutes,
    overtimeMinutes,
    lateMinutes,
    earlyLeaveMinutes,
    deductionMinutes,
    earlyFinishStatus,
  }
}

// ─── ラベル・カラーユーティリティ ─────────────────────

export const calcWorkHours = (clockIn: string | null, clockOut: string | null) => {
  const min = calcActualMinutes(clockIn, clockOut)
  return min > 0 ? formatMinutes(min) : null
}

export const statusLabel = (status: string) => ({
  present: '出勤',
  absent: '欠勤',
  late: '遅刻',
  early_leave: '早退',
  holiday: '休日',
  paid_leave: '有給',
  sick_leave: '病欠',
} as Record<string, string>)[status] ?? status

export const statusColor = (status: string) => ({
  present: 'bg-emerald-100 text-emerald-700',
  absent: 'bg-red-100 text-red-700',
  late: 'bg-amber-100 text-amber-700',
  early_leave: 'bg-orange-100 text-orange-700',
  holiday: 'bg-slate-100 text-slate-500',
  paid_leave: 'bg-blue-100 text-blue-700',
  sick_leave: 'bg-purple-100 text-purple-700',
} as Record<string, string>)[status] ?? 'bg-gray-100 text-gray-600'

export const clockOutReasonLabel = (r: ClockOutReason) => ({
  normal: '通常退勤',
  early_finish: '業務完了（早上がり）',
  early_leave: '早退（体調不良・私用）',
} as Record<string, string>)[r] ?? r

export const earlyFinishStatusLabel = (s: EarlyFinishStatus) => ({
  not_required: '—',
  pending: '承認待ち',
  approved: '承認済',
  rejected: '否認（早退扱い）',
} as Record<string, string>)[s] ?? s

export const earlyFinishStatusColor = (s: EarlyFinishStatus) => ({
  not_required: '',
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
} as Record<string, string>)[s] ?? ''

export const leaveTypeLabel = (type: string) => ({
  paid_leave: '有給休暇',
  sick_leave: '病気休暇',
  special_leave: '特別休暇',
} as Record<string, string>)[type] ?? type

export const leaveStatusLabel = (status: string) => ({
  pending: '申請中',
  approved: '承認済',
  rejected: '却下',
} as Record<string, string>)[status] ?? status

export const leaveStatusColor = (status: string) => ({
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
} as Record<string, string>)[status] ?? 'bg-gray-100 text-gray-600'

// ─── シフトブロック表示 ────────────────────────────────

export const blocksToTimeRange = (blocks: ShiftPatternBlock[]): string => {
  if (!blocks || blocks.length === 0) return '—'
  const sorted = [...blocks].sort((a, b) => a.sort_order - b.sort_order)
  return sorted.map(b => `${b.start_time.slice(0,5)}〜${b.end_time.slice(0,5)}`).join(' / ')
}

export const blocksToLabel = (blocks: ShiftPatternBlock[]): string => {
  if (!blocks || blocks.length === 0) return ''
  const sorted = [...blocks].sort((a, b) => a.sort_order - b.sort_order)
  return sorted.map(b => b.label ?? b.start_time.slice(0,5)).join('/')
}
