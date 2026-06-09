import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/lib/auth'
import { supabase, Profile } from '@/lib/supabase'
import {
  formatTime, formatMinutes, statusLabel, statusColor,
  earlyFinishStatusLabel, earlyFinishStatusColor,
  getCurrentMonth, getMonthRange
} from '@/lib/utils'
import { format, addMonths, subMonths, parseISO, differenceInMinutes, eachDayOfInterval, startOfMonth, endOfMonth } from 'date-fns'
import { ja } from 'date-fns/locale'

// 実働時間計算（シフト開始より早い分を除外・早出申請対応・中抜き対応）
function calcActualMin(r: any, shiftBlocks: any[], amEarlyStartTime?: string, pmEarlyStartTime?: string): number {
  const sorted = [...shiftBlocks].sort((a: any, b: any) => a.sort_order - b.sort_order)
  const amBlock = sorted.find((b: any) => b.sort_order === 0)
  const pmBlock = sorted.find((b: any) => b.sort_order === 1)

  let total = 0

  // 午前ブロック
  const rawAmIn = r.am_clock_in ? parseISO(r.am_clock_in) : null
  const amOut = r.am_clock_out ? parseISO(r.am_clock_out) : null

  let effectiveAmIn = rawAmIn
  if (rawAmIn && amBlock) {
    const [sh, sm] = amBlock.start_time.split(':').map(Number)
    const shiftAmStart = new Date(`${r.date}T${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}:00+09:00`)
    if (rawAmIn < shiftAmStart) {
      if (amEarlyStartTime) {
        const approvedStart = new Date(`${r.date}T${amEarlyStartTime}+09:00`)
        effectiveAmIn = rawAmIn < approvedStart ? approvedStart : rawAmIn
      } else {
        effectiveAmIn = shiftAmStart
      }
    }
  }

  if (effectiveAmIn && amOut) {
    total += Math.max(differenceInMinutes(amOut, effectiveAmIn), 0)
  }

  // 午後ブロック
  const rawPmIn = r.pm_clock_in ? parseISO(r.pm_clock_in) : null
  const pmOut = r.pm_clock_out ? parseISO(r.pm_clock_out) : null

  let effectivePmIn = rawPmIn
  if (rawPmIn && pmBlock) {
    const [sh, sm] = pmBlock.start_time.split(':').map(Number)
    const shiftPmStart = new Date(`${r.date}T${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}:00+09:00`)
    if (rawPmIn < shiftPmStart) {
      if (pmEarlyStartTime) {
        // 午後早出申請あり → 申請時刻から計算
        const approvedPmStart = new Date(`${r.date}T${pmEarlyStartTime}+09:00`)
        effectivePmIn = rawPmIn < approvedPmStart ? approvedPmStart : rawPmIn
      } else {
        effectivePmIn = shiftPmStart
      }
    }
  } else if (rawPmIn && !pmBlock && amBlock) {
    const [sh, sm] = amBlock.start_time.split(':').map(Number)
    const shiftStart = new Date(`${r.date}T${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}:00+09:00`)
    if (rawPmIn < shiftStart) effectivePmIn = shiftStart
  }

  if (effectivePmIn && pmOut) {
    total += Math.max(differenceInMinutes(pmOut, effectivePmIn), 0)
  }

  if (!rawPmIn && effectiveAmIn && pmOut && total === 0) {
    total = Math.max(differenceInMinutes(pmOut, effectiveAmIn), 0)
  }

  if (total === 0 && r.clock_in && r.clock_out) {
    total = Math.max(differenceInMinutes(parseISO(r.clock_out), parseISO(r.clock_in)), 0)
  }

  return total
}

// 半日有給の所定時間計算
function calcScheduledMinWithHalfLeave(r: any, shiftBlocks: any[]): number {
  const base = calcScheduledMin(shiftBlocks)
  // 半日有給の場合はその半分を所定時間として計算
  if (r.am_leave && shiftBlocks.some((b: any) => b.sort_order === 0)) {
    const amBlock = shiftBlocks.find((b: any) => b.sort_order === 0)
    if (amBlock) {
      const [sh, sm] = amBlock.start_time.split(':').map(Number)
      const [eh, em] = amBlock.end_time.split(':').map(Number)
      const amMin = (eh * 60 + em) - (sh * 60 + sm)
      return base - amMin
    }
  }
  if (r.pm_leave && shiftBlocks.some((b: any) => b.sort_order === 1)) {
    const pmBlock = shiftBlocks.find((b: any) => b.sort_order === 1)
    if (pmBlock) {
      const [sh, sm] = pmBlock.start_time.split(':').map(Number)
      const [eh, em] = pmBlock.end_time.split(':').map(Number)
      const pmMin = (eh * 60 + em) - (sh * 60 + sm)
      return base - pmMin
    }
  }
  return base
}

// シフト終了時刻より早く退勤したか判定
function isEarlyFinish(r: any, shiftBlocks: any[]): boolean {
  if (!shiftBlocks || shiftBlocks.length === 0) return false
  const sorted = [...shiftBlocks].sort((a: any, b: any) => a.sort_order - b.sort_order)
  const lastBlock = sorted[sorted.length - 1]
  const [eh, em] = lastBlock.end_time.split(':').map(Number)
  const scheduledEnd = new Date(`${r.date}T${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}:00+09:00`)
  const clockOut = r.pm_clock_out ? parseISO(r.pm_clock_out) : r.am_clock_out ? parseISO(r.am_clock_out) : r.clock_out ? parseISO(r.clock_out) : null
  if (!clockOut) return false
  return clockOut < scheduledEnd
}

// 遅刻分数計算（午前・午後それぞれ）
// - シフト開始より早い場合は遅刻0
// - 午後はローカルルール：午前退勤+60分 と シフト午後開始 の遅い方を基準にする
function calcLateMin(r: any, shiftBlocks: any[]): number {
  if (!shiftBlocks || shiftBlocks.length === 0) return 0
  const sorted = [...shiftBlocks].sort((a: any, b: any) => a.sort_order - b.sort_order)
  let totalLate = 0

  // 午前遅刻
  const amBlock = sorted.find((b: any) => b.sort_order === 0)
  const clockIn = r.am_clock_in || r.clock_in
  if (amBlock && clockIn) {
    const [sh, sm] = amBlock.start_time.split(':').map(Number)
    const scheduledStart = new Date(`${r.date}T${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}:00+09:00`)
    const late = differenceInMinutes(parseISO(clockIn), scheduledStart)
    if (late > 0) totalLate += late
  }

  // 午後遅刻（ローカルルール：午前退勤+60分 vs シフト午後開始 の遅い方を基準）
  const pmBlock = sorted.find((b: any) => b.sort_order === 1)
  if (pmBlock && r.pm_clock_in) {
    const [sh, sm] = pmBlock.start_time.split(':').map(Number)
    const shiftPmStart = new Date(`${r.date}T${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}:00+09:00`)

    // 午前退勤+60分を計算
    const amOutTime = r.am_clock_out ? parseISO(r.am_clock_out) : null
    const minPmStart = amOutTime
      ? new Date(amOutTime.getTime() + 60 * 60 * 1000)
      : shiftPmStart

    // 基準時刻 = MAX(シフト午後開始, 午前退勤+60分)
    const effectivePmStart = minPmStart > shiftPmStart ? minPmStart : shiftPmStart

    const late = differenceInMinutes(parseISO(r.pm_clock_in), effectivePmStart)
    if (late > 0) totalLate += late
  }

  return totalLate
}

// 午前・午後それぞれの遅刻分数を返す（表示用）
function calcLateMinDetail(r: any, shiftBlocks: any[]): { amLate: number, pmLate: number } {
  if (!shiftBlocks || shiftBlocks.length === 0) return { amLate: 0, pmLate: 0 }
  const sorted = [...shiftBlocks].sort((a: any, b: any) => a.sort_order - b.sort_order)

  let amLate = 0, pmLate = 0

  const amBlock = sorted.find((b: any) => b.sort_order === 0)
  const clockIn = r.am_clock_in || r.clock_in
  if (amBlock && clockIn) {
    const [sh, sm] = amBlock.start_time.split(':').map(Number)
    const scheduledStart = new Date(`${r.date}T${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}:00+09:00`)
    const late = differenceInMinutes(parseISO(clockIn), scheduledStart)
    if (late > 0) amLate = late
  }

  const pmBlock = sorted.find((b: any) => b.sort_order === 1)
  if (pmBlock && r.pm_clock_in) {
    const [sh, sm] = pmBlock.start_time.split(':').map(Number)
    const shiftPmStart = new Date(`${r.date}T${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}:00+09:00`)
    const amOutTime = r.am_clock_out ? parseISO(r.am_clock_out) : null
    const minPmStart = amOutTime ? new Date(amOutTime.getTime() + 60 * 60 * 1000) : shiftPmStart
    const effectivePmStart = minPmStart > shiftPmStart ? minPmStart : shiftPmStart
    const late = differenceInMinutes(parseISO(r.pm_clock_in), effectivePmStart)
    if (late > 0) pmLate = late
  }

  return { amLate, pmLate }
}

// 残業計算（シフト終了後の実働時間）
function calcOvertimeMin(r: any, shiftBlocks: any[]): number {
  if (!shiftBlocks || shiftBlocks.length === 0) return 0
  const sorted = [...shiftBlocks].sort((a: any, b: any) => a.sort_order - b.sort_order)
  const lastBlock = sorted[sorted.length - 1]
  const [eh, em] = lastBlock.end_time.split(':').map(Number)
  const shiftEnd = new Date(`${r.date}T${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}:00+09:00`)

  // 退勤時刻
  const clockOut = r.pm_clock_out ? parseISO(r.pm_clock_out)
    : r.am_clock_out ? parseISO(r.am_clock_out)
    : r.clock_out ? parseISO(r.clock_out)
    : null

  if (!clockOut) return 0
  return Math.max(differenceInMinutes(clockOut, shiftEnd), 0)
}

// 所定時間計算
function calcScheduledMin(shiftBlocks: any[]): number {
  if (!shiftBlocks || shiftBlocks.length === 0) return 0
  return shiftBlocks.reduce((sum: number, b: any) => {
    const [sh, sm] = b.start_time.split(':').map(Number)
    const [eh, em] = b.end_time.split(':').map(Number)
    return sum + (eh * 60 + em) - (sh * 60 + sm)
  }, 0)
}

// ─── 院長直接編集モーダル用の型 ───────────────────────
type AdminEditForm = {
  am_clock_in: string
  am_clock_out: string
  pm_clock_in: string
  pm_clock_out: string
  status: string
  leave_type: 'full' | 'am' | 'pm'  // paid_leave選択時の区分
  clock_out_reason: string
  overtime_minutes: number
  note: string
}

// ─── 部署固定順ソート ─────────────────────────────────────────
const DEPT_ORDER = ['看護師', 'ORT', '受付', '助手']

function getDeptOrder(deptName: string | undefined | null): number {
  const idx = DEPT_ORDER.indexOf(deptName ?? '')
  return idx === -1 ? DEPT_ORDER.length : idx  // 未定義部署は末尾
}

function sortByDeptThenEmployment<T extends { employment_type?: string; name?: string; departments?: any }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const deptA = getDeptOrder((a.departments as any)?.name)
    const deptB = getDeptOrder((b.departments as any)?.name)
    if (deptA !== deptB) return deptA - deptB
    // 部署内：常勤 → パート
    const empA = a.employment_type === 'full_time' ? 0 : 1
    const empB = b.employment_type === 'full_time' ? 0 : 1
    if (empA !== empB) return empA - empB
    // 同雇用形態：五十音順
    return (a.name ?? '').localeCompare(b.name ?? '', 'ja')
  })
}

export default function AttendanceHistoryPage() {
  const { user, profile, loading, isAdmin, isLeader } = useAuth()
  const router = useRouter()
  const [month, setMonth] = useState(getCurrentMonth())
  const [records, setRecords] = useState<any[]>([])
  const [shiftMap, setShiftMap] = useState<Record<string, any[]>>({})
  const [earlyStartMap, setEarlyStartMap] = useState<Record<string, { am?: string, pm?: string }>>({}) // date -> {am, pm}
  const [staffList, setStaffList] = useState<Profile[]>([])
  const [selectedStaffId, setSelectedStaffId] = useState('')
  const [fetching, setFetching] = useState(false)
  const [approving, setApproving] = useState<string | null>(null)

  // 院長直接編集モーダル
  const [adminEditRecord, setAdminEditRecord] = useState<any | null>(null)
  const [adminEditForm, setAdminEditForm] = useState<AdminEditForm>({
    am_clock_in: '', am_clock_out: '', pm_clock_in: '', pm_clock_out: '',
    status: 'present', leave_type: 'full', clock_out_reason: 'normal', overtime_minutes: 0, note: '',
  })
  const [adminEditSaving, setAdminEditSaving] = useState(false)
  const [adminEditError, setAdminEditError] = useState('')

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [user, loading])

  useEffect(() => {
    if (!user || !profile) return
    // URLパラメータからmonthを取得
    const { month: urlMonth } = router.query
    if (urlMonth && typeof urlMonth === 'string') setMonth(urlMonth)
    if (isAdmin || isLeader) {
      fetchStaff()
    } else {
      setSelectedStaffId(user.id)
    }
  }, [user, profile])

  // URLパラメータのstaffIdを反映（fetchStaff完了後）
  useEffect(() => {
    const { staffId } = router.query
    if (staffId && typeof staffId === 'string' && staffList.length > 0) {
      setSelectedStaffId(staffId)
    }
  }, [router.query, staffList])

  useEffect(() => {
    if (selectedStaffId) {
      fetchRecords()
      fetchShifts()
      fetchEarlyStarts()
    }
  }, [selectedStaffId, month])

  const fetchStaff = async () => {
    let q = supabase.from('profiles').select('*, departments(name)').order('name')
    if (isLeader && !isAdmin && profile?.department_id) {
      q = q.eq('department_id', profile.department_id)
    }
    const { data } = await q
    const sorted = sortByDeptThenEmployment(data ?? [])
    setStaffList(sorted)
    if (sorted.length > 0 && !selectedStaffId) {
      setSelectedStaffId(user?.id ?? sorted[0]?.id ?? '')
    }
  }

  // 時給計算用state
  const [staffPayInfo, setStaffPayInfo] = useState<{ pay_type: string; hourly_rate: number } | null>(null)
  const [staffRates, setStaffRates] = useState<any[]>([])

  const fetchRecords = async () => {
    if (!selectedStaffId) return
    setFetching(true)
    const { start, end } = getMonthRange(month)
    const { data } = await supabase
      .from('attendance_records')
      .select('*')
      .eq('user_id', selectedStaffId)
      .gte('date', start)
      .lte('date', end)
      .order('date', { ascending: true })
    setRecords(data ?? [])

    // 時給パートの場合のみ時給情報を取得
    const { data: pData } = await supabase
      .from('profiles')
      .select('pay_type, hourly_rate')
      .eq('id', selectedStaffId)
      .single()
    setStaffPayInfo(pData ?? null)

    if (pData?.pay_type === 'hourly') {
      const { data: rates } = await supabase
        .from('part_time_rates')
        .select('*')
        .eq('user_id', selectedStaffId)
      setStaffRates(rates ?? [])
    } else {
      setStaffRates([])
    }

    setFetching(false)
  }

  const fetchEarlyStarts = async () => {
    if (!selectedStaffId) return
    const { start, end } = getMonthRange(month)
    const { data } = await supabase
      .from('early_start_requests')
      .select('date, start_time, time_slot')
      .eq('user_id', selectedStaffId)
      .eq('status', 'approved')
      .gte('date', start)
      .lte('date', end)
    const map: Record<string, { am?: string, pm?: string }> = {}
    for (const d of data ?? []) {
      if (!map[d.date]) map[d.date] = {}
      const slot = d.time_slot ?? 'am'
      map[d.date][slot] = d.start_time
    }
    setEarlyStartMap(map)
  }

  const fetchShifts = async () => {
    if (!selectedStaffId) return
    const { start, end } = getMonthRange(month)
    const { data } = await supabase
      .from('shift_assignments')
      .select('date, shift_patterns(shift_pattern_blocks(*))')
      .eq('user_id', selectedStaffId)
      .gte('date', start)
      .lte('date', end)
    const map: Record<string, any[]> = {}
    for (const d of data ?? []) {
      const blocks = (d.shift_patterns as any)?.shift_pattern_blocks ?? []
      map[d.date] = blocks.sort((a: any, b: any) => a.sort_order - b.sort_order)
    }
    setShiftMap(map)
  }

  const handleEarlyFinishReview = async (recordId: string, approved: boolean) => {
    if (!user) return
    setApproving(recordId)
    const rec = records.find(r => r.id === recordId)
    if (!rec) { setApproving(null); return }

    await supabase.from('attendance_records').update({
      early_finish_status: approved ? 'approved' : 'rejected',
      early_finish_reviewed_by: user.id,
      early_finish_reviewed_at: new Date().toISOString(),
      status: approved ? 'present' : 'early_leave',
    }).eq('id', recordId)

    setApproving(null)
    fetchRecords()
  }

  // ─── 院長直接編集 ──────────────────────────────────────
  const openAdminEdit = (record: any) => {
    if (!isAdmin) return
    // ISO文字列 → HH:mm 変換
    const toTime = (iso: string | null) => {
      if (!iso) return ''
      return format(parseISO(iso), 'HH:mm')
    }
    setAdminEditForm({
      am_clock_in:  toTime(record.am_clock_in ?? record.clock_in),
      am_clock_out: toTime(record.am_clock_out),
      pm_clock_in:  toTime(record.pm_clock_in),
      pm_clock_out: toTime(record.pm_clock_out ?? record.clock_out),
      status: record.status ?? 'present',
      leave_type: record.am_leave ? 'am' : record.pm_leave ? 'pm' : 'full',
      clock_out_reason: record.clock_out_reason ?? 'normal',
      overtime_minutes: record.overtime_minutes ?? 0,
      note: record.note ?? '',
    })
    setAdminEditError('')
    setAdminEditRecord(record)
  }

  const handleAdminEditSave = async () => {
    if (!adminEditRecord || !user) return
    setAdminEditSaving(true)
    setAdminEditError('')

    const date = adminEditRecord.date
    // HH:mm → ISO（JST）変換
    const toISO = (time: string): string | null => {
      if (!time) return null
      return `${date}T${time}:00+09:00`
    }

    const amIn  = toISO(adminEditForm.am_clock_in)
    const amOut = toISO(adminEditForm.am_clock_out)
    const pmIn  = toISO(adminEditForm.pm_clock_in)
    const pmOut = toISO(adminEditForm.pm_clock_out)

    // 簡易バリデーション
    if (amIn && amOut && amIn >= amOut) {
      setAdminEditError('午前：出勤時刻が退勤時刻より後になっています')
      setAdminEditSaving(false)
      return
    }
    if (pmIn && pmOut && pmIn >= pmOut) {
      setAdminEditError('午後：出勤時刻が退勤時刻より後になっています')
      setAdminEditSaving(false)
      return
    }

    // paid_leave の場合は leave_type から am_leave/pm_leave を決定
    const isPaidLeaveStatus = adminEditForm.status === 'paid_leave'
    const amLeave = isPaidLeaveStatus && adminEditForm.leave_type === 'am'
    const pmLeave = isPaidLeaveStatus && adminEditForm.leave_type === 'pm'
    // 半日有給の場合は打刻をクリア
    const leaveAmIn   = amLeave ? null : amIn
    const leaveAmOut  = amLeave ? null : amOut
    const leavePmIn   = pmLeave ? null : pmIn
    const leavePmOut  = pmLeave ? null : pmOut

    const payload: any = {
      am_clock_in:  isPaidLeaveStatus && adminEditForm.leave_type === 'full' ? null : leaveAmIn,
      am_clock_out: isPaidLeaveStatus && adminEditForm.leave_type === 'full' ? null : leaveAmOut,
      pm_clock_in:  isPaidLeaveStatus && adminEditForm.leave_type === 'full' ? null : leavePmIn,
      pm_clock_out: isPaidLeaveStatus && adminEditForm.leave_type === 'full' ? null : leavePmOut,
      clock_in:  isPaidLeaveStatus && adminEditForm.leave_type === 'full' ? null : (leaveAmIn ?? leavePmIn),
      clock_out: isPaidLeaveStatus && adminEditForm.leave_type === 'full' ? null : (leavePmOut ?? leaveAmOut),
      am_leave: amLeave,
      pm_leave: pmLeave,
      status: adminEditForm.status,
      clock_out_reason: adminEditForm.clock_out_reason,
      overtime_minutes: adminEditForm.overtime_minutes,
      note: adminEditForm.note || null,
      early_finish_status: adminEditRecord.early_finish_status ?? 'not_required',
      updated_at: new Date().toISOString(),
    }

    const prevStatus   = adminEditRecord.status ?? ''
    const prevAmLeave  = adminEditRecord.am_leave === true
    const prevPmLeave  = adminEditRecord.pm_leave === true
    const prevDays     = prevStatus === 'paid_leave' ? (prevAmLeave || prevPmLeave ? 0.5 : 1) : 0
    const newStatus    = adminEditForm.status
    const newDays      = newStatus === 'paid_leave' ? (amLeave || pmLeave ? 0.5 : 1) : 0

    if (adminEditRecord.id) {
      // 既存レコードの更新
      const { error } = await supabase
        .from('attendance_records')
        .update(payload)
        .eq('id', adminEditRecord.id)
      if (error) { setAdminEditError(error.message); setAdminEditSaving(false); return }
    } else {
      // レコードが存在しない日の新規作成（直接入力）
      const { error } = await supabase
        .from('attendance_records')
        .insert({
          user_id: selectedStaffId,
          date,
          break_minutes: 0,
          scheduled_minutes: 0,
          actual_minutes: 0,
          overtime_minutes: 0,
          deduction_minutes: 0,
          late_minutes: 0,
          early_leave_minutes: 0,
          early_finish_status: 'not_required',
          ...payload,
        })
      if (error) { setAdminEditError(error.message); setAdminEditSaving(false); return }
    }

    // paid_leave の日数差分で used_leave_days を加減算（終日=1、半日=0.5）
    const daysDiff = newDays - prevDays
    if (daysDiff !== 0) {
      const { data: p } = await supabase.from('profiles').select('used_leave_days').eq('id', selectedStaffId).single()
      await supabase.from('profiles').update({
        used_leave_days: Math.max((p?.used_leave_days ?? 0) + daysDiff, 0),
      }).eq('id', selectedStaffId)
    }

    setAdminEditSaving(false)
    setAdminEditRecord(null)
    fetchRecords()
  }

  const handleAdminDelete = async () => {
    if (!adminEditRecord?.id) return
    if (!confirm('この勤怠記録を削除しますか？')) return
    await supabase.from('attendance_records').delete().eq('id', adminEditRecord.id)
    setAdminEditRecord(null)
    fetchRecords()
  }

  const prevMonth = () => setMonth(format(subMonths(parseISO(month + '-01'), 1), 'yyyy-MM'))
  const nextMonth = () => setMonth(format(addMonths(parseISO(month + '-01'), 1), 'yyyy-MM'))

  // フロントエンドで計算
  const computedRecords = records.map(r => {
    const blocks = shiftMap[r.date] ?? []
    const earlyStartAm = earlyStartMap[r.date]?.am
    const earlyStartPm = earlyStartMap[r.date]?.pm
    const scheduledMin = calcScheduledMinWithHalfLeave(r, blocks)
    const actualMin = calcActualMin(r, blocks, earlyStartAm, earlyStartPm)
    const lateMin = calcLateMin(r, blocks)
    const { amLate, pmLate } = calcLateMinDetail(r, blocks)
    // 残業 = 実働 - 所定（マイナスは0）
    const overtimeMin = scheduledMin > 0 ? Math.max(actualMin - scheduledMin, 0) : 0
    // 控除計算：
    // 1. 早退（early_leave）→ 所定-実働
    // 2. 遅刻 かつ 所定>実働 → 所定-実働
    // 3. 早上がり否認（rejected）→ 所定-実働
    // 4. それ以外 → 控除0
    const isEarlyLeave = r.clock_out_reason === 'early_leave' || r.status === 'early_leave'
    const isEarlyFinishRejected = r.early_finish_status === 'rejected'
    const hasLate = lateMin > 0
    const isShort = scheduledMin > 0 && actualMin < scheduledMin
    const deductionMin = (isEarlyLeave || isEarlyFinishRejected || (hasLate && isShort))
      ? Math.max(scheduledMin - actualMin, 0)
      : 0
    return { ...r, _scheduledMin: scheduledMin, _actualMin: actualMin, _lateMin: lateMin, _amLate: amLate, _pmLate: pmLate, _overtimeMin: overtimeMin, _deductionMin: deductionMin }
  })

  // 院長用：月の全日付を生成（レコードなし日にも直接入力ボタンを表示するため）
  const allDaysInMonth = isAdmin
    ? eachDayOfInterval({
        start: startOfMonth(parseISO(month + '-01')),
        end: endOfMonth(parseISO(month + '-01')),
      }).map(d => format(d, 'yyyy-MM-dd'))
    : []
  const recordDates = new Set(computedRecords.map(r => r.date))
  const noRecordDates = allDaysInMonth.filter(d => !recordDates.has(d) && new Date(d) <= new Date())

  // 月次集計
  const getRateType = (dow: number, slot: 'am' | 'pm', rates: any[]): number | null => {
    const custom = rates.find(r => r.rate_type === 'custom' && r.day_of_week === dow && r.time_slot === slot)
    if (custom) return custom.hourly_rate
    if (dow === 6) { const sat = rates.find(r => r.rate_type === 'saturday'); if (sat) return sat.hourly_rate }
    else if (dow !== 0) { const w = rates.find(r => r.rate_type === (slot === 'am' ? 'weekday_am' : 'weekday_pm')); if (w) return w.hourly_rate }
    return null
  }

  const calcPaidLeaveAmount = (r: any, blocks: any[]): number => {
    if (!staffPayInfo || staffPayInfo.pay_type !== 'hourly' || blocks.length === 0) return 0
    const sorted = [...blocks].sort((a: any, b: any) => a.sort_order - b.sort_order)
    const amBlock = sorted.find((b: any) => b.sort_order === 0)
    const pmBlock = sorted.find((b: any) => b.sort_order === 1)
    const dow = parseISO(r.date).getDay()
    const isSat = dow === 6
    const isHalfAm = r.am_leave === true
    const isHalfPm = r.pm_leave === true
    let total = 0
    if (amBlock && !isHalfPm) {
      const [sh, sm] = amBlock.start_time.split(':').map(Number)
      const [eh, em] = amBlock.end_time.split(':').map(Number)
      const min = (eh * 60 + em) - (sh * 60 + sm)
      const rate = getRateType(dow, 'am', staffRates) ?? staffPayInfo.hourly_rate
      total += Math.round(min / 60 * rate)
    }
    if (pmBlock && !isHalfAm) {
      const [sh, sm] = pmBlock.start_time.split(':').map(Number)
      const [eh, em] = pmBlock.end_time.split(':').map(Number)
      const min = (eh * 60 + em) - (sh * 60 + sm)
      const rate = getRateType(dow, 'pm', staffRates) ?? staffPayInfo.hourly_rate
      total += Math.round(min / 60 * rate)
    }
    return total
  }

  const summary = {
    workDays: computedRecords.filter(r => ['present', 'late', 'early_leave'].includes(r.status)).length,
    overtimeMin: computedRecords.reduce((s, r) => s + r._overtimeMin, 0),
    deductionMin: computedRecords.reduce((s, r) => s + r._deductionMin, 0),
    lateCount: computedRecords.filter(r => r._lateMin > 0).length,
    absentDays: computedRecords.filter(r => r.status === 'absent').length,
    paidLeave: computedRecords.filter(r => r.status === 'paid_leave').length,
    actualMin: computedRecords.reduce((s, r) => s + r._actualMin, 0),
    pendingApprovals: computedRecords.filter(r => r.early_finish_status === 'pending').length,
    paidLeaveAmount: computedRecords
      .filter(r => r.status === 'paid_leave')
      .reduce((s, r) => s + calcPaidLeaveAmount(r, shiftMap[r.date] ?? []), 0),
  }

  const canReview = isAdmin || (isLeader && !!(profile as any)?.leader_can_approve_early_finish)

  if (loading || !profile) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-4xl animate-pulse">🏥</div>
    </div>
  )

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-5">
        <h1 className="text-xl font-semibold text-gray-900">📋 勤怠履歴</h1>

        {/* Controls */}
        <div className="card flex flex-wrap gap-3 items-center py-3">
          {(isAdmin || isLeader) && (
            <select className="select w-auto" value={selectedStaffId}
              onChange={e => setSelectedStaffId(e.target.value)}>
              {staffList.map(s => {
                const deptName = (s as any).departments?.name
                return (
                  <option key={s.id} value={s.id}>
                    {deptName ? `[${deptName}] ` : ''}{s.name}
                  </option>
                )
              })}
            </select>
          )}
          <div className="flex items-center gap-2 ml-auto">
            <button onClick={prevMonth} className="btn-secondary px-3 py-1.5 text-sm">‹</button>
            <span className="text-sm font-medium text-gray-700 w-24 text-center">
              {format(parseISO(month + '-01'), 'yyyy年M月', { locale: ja })}
            </span>
            <button onClick={nextMonth} className="btn-secondary px-3 py-1.5 text-sm">›</button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="card text-center">
            <div className="text-xl font-bold text-gray-800">{summary.workDays}日</div>
            <div className="text-xs text-gray-500">出勤日数</div>
          </div>
          <div className="card text-center">
            <div className={`text-xl font-bold ${summary.overtimeMin > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
              {summary.overtimeMin > 0 ? formatMinutes(summary.overtimeMin) : '—'}
            </div>
            <div className="text-xs text-gray-500">残業合計</div>
          </div>
          <div className="card text-center">
            <div className={`text-xl font-bold ${summary.lateCount > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
              {summary.lateCount}回
            </div>
            <div className="text-xs text-gray-500">遅刻回数</div>
          </div>
          <div className="card text-center">
            <div className={`text-xl font-bold ${summary.deductionMin > 0 ? 'text-red-500' : 'text-gray-400'}`}>
              {summary.deductionMin > 0 ? formatMinutes(summary.deductionMin) : '—'}
            </div>
            <div className="text-xs text-gray-500">控除合計</div>
          </div>
        </div>

        {/* Pending approvals */}
        {canReview && summary.pendingApprovals > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <span className="text-amber-600 font-medium text-sm">
              ⚠️ 早上がり承認待ちが {summary.pendingApprovals} 件あります
            </span>
          </div>
        )}

        {/* Table */}
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-max">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="table-th">日付</th>
                  <th className="table-th">シフト</th>
                  <th className="table-th">午前出勤</th>
                  <th className="table-th">午前退勤</th>
                  <th className="table-th">午後出勤</th>
                  <th className="table-th">午後退勤</th>
                  <th className="table-th">所定</th>
                  <th className="table-th">実働</th>
                  <th className="table-th">残業</th>
                  <th className="table-th">控除</th>
                  <th className="table-th">ステータス</th>
                  <th className="table-th">備考</th>
                  {isAdmin && <th className="table-th">直接編集</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {fetching ? (
                  <tr><td colSpan={12} className="text-center py-8 text-gray-400">読込中...</td></tr>
                ) : computedRecords.length === 0 ? (
                  <tr><td colSpan={13} className="text-center py-8 text-gray-400">この月の記録はありません</td></tr>
                ) : computedRecords.map(r => {
                  const isShort = r._scheduledMin > 0 && r._actualMin < r._scheduledMin && ['present','late','early_leave'].includes(r.status)
                  return (
                  <tr key={r.id ?? r.date} className={`hover:bg-gray-50 ${r.early_finish_status === 'pending' ? 'bg-amber-50/40' : isShort ? 'bg-red-50/40' : ''}`}>
                    <td className="table-td font-medium whitespace-nowrap">
                      {format(parseISO(r.date), 'M/d(EEE)', { locale: ja })}
                    </td>
                    <td className="table-td whitespace-nowrap">
                      {(() => {
                        const blocks = shiftMap[r.date] ?? []
                        if (blocks.length === 0) return <span className="text-gray-300 text-xs">未設定</span>
                        return (
                          <div className="text-xs text-gray-500 space-y-0.5">
                            {blocks.map((b: any) => (
                              <div key={b.sort_order}>
                                {b.start_time.slice(0,5)}〜{b.end_time.slice(0,5)}
                              </div>
                            ))}
                          </div>
                        )
                      })()}
                    </td>
                    <td className="table-td whitespace-nowrap">
                      <span className={r._amLate > 0 ? 'text-amber-600' : ''}>
                        {r.am_clock_in ? format(parseISO(r.am_clock_in), 'HH:mm') : r.clock_in ? format(parseISO(r.clock_in), 'HH:mm') : '--:--'}
                      </span>
                      {r._amLate > 0 && (
                        <div className="text-[10px] text-amber-600">+{formatMinutes(r._amLate)}</div>
                      )}
                    </td>
                    <td className="table-td whitespace-nowrap text-gray-500">
                      {r.am_clock_out ? format(parseISO(r.am_clock_out), 'HH:mm') : '--:--'}
                    </td>
                    <td className="table-td whitespace-nowrap">
                      <span className={r._pmLate > 0 ? 'text-amber-600' : 'text-gray-500'}>
                        {r.pm_clock_in ? format(parseISO(r.pm_clock_in), 'HH:mm') : '--:--'}
                      </span>
                      {r._pmLate > 0 && (
                        <div className="text-[10px] text-amber-600">+{formatMinutes(r._pmLate)}</div>
                      )}
                    </td>
                    <td className="table-td whitespace-nowrap">
                      {r.pm_clock_out ? format(parseISO(r.pm_clock_out), 'HH:mm') : r.clock_out ? format(parseISO(r.clock_out), 'HH:mm') : '--:--'}
                      {r.clock_out_reason && r.clock_out_reason !== 'normal' && (
                        <div className="text-[10px] text-gray-400">
                          {r.clock_out_reason === 'early_finish' ? '早上がり' : '早退'}
                        </div>
                      )}
                    </td>
                    <td className="table-td text-gray-500">
                      {r._scheduledMin > 0 ? formatMinutes(r._scheduledMin) : '—'}
                    </td>
                    <td className="table-td font-medium">
                      {r._actualMin > 0 ? formatMinutes(r._actualMin) : '—'}
                    </td>
                    <td className="table-td">
                      {r._overtimeMin > 0
                        ? <span className="text-amber-600 font-medium">+{formatMinutes(r._overtimeMin)}</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="table-td">
                      {r._deductionMin > 0
                        ? <span className="text-red-500 font-medium">-{formatMinutes(r._deductionMin)}</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="table-td">
                      <div className="flex flex-col gap-1">
                        <span className={`badge ${statusColor(r.status)}`}>{statusLabel(r.status)}</span>
                        {r.early_finish_status !== 'not_required' && (
                          <span className={`badge text-[10px] ${earlyFinishStatusColor(r.early_finish_status)}`}>
                            {earlyFinishStatusLabel(r.early_finish_status)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="table-td">
                      {canReview && r.early_finish_status === 'pending' && (isAdmin || r.user_id !== user?.id) ? (
                        <div className="flex gap-1">
                          <button onClick={() => handleEarlyFinishReview(r.id, true)} disabled={approving === r.id}
                            className="text-xs bg-emerald-100 text-emerald-700 hover:bg-emerald-200 px-2 py-1 rounded font-medium">
                            承認
                          </button>
                          <button onClick={() => handleEarlyFinishReview(r.id, false)} disabled={approving === r.id}
                            className="text-xs bg-red-100 text-red-600 hover:bg-red-200 px-2 py-1 rounded font-medium">
                            否認
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">{r.note ?? ''}</span>
                      )}
                    </td>
                    {isAdmin && (
                      <td className="table-td">
                        <button
                          onClick={() => openAdminEdit(r)}
                          className="text-xs bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 px-2 py-1 rounded font-medium whitespace-nowrap"
                        >
                          ✏️ 修正
                        </button>
                      </td>
                    )}
                  </tr>
                )})
                }
              </tbody>
            </table>
          </div>
        </div>

        {/* 院長直接編集モーダル */}
        {isAdmin && adminEditRecord && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-gray-800 text-base">
                  🔧 院長直接編集
                </h2>
                <span className="text-sm text-gray-500">
                  {staffList.find(s => s.id === selectedStaffId)?.name} / {format(parseISO(adminEditRecord.date), 'M/d(EEE)', { locale: ja })}
                </span>
              </div>

              {adminEditError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-600">
                  ⚠️ {adminEditError}
                </div>
              )}

              {/* 打刻時刻入力グリッド */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">午前 出勤</label>
                  <input
                    type="time"
                    className="input"
                    value={adminEditForm.am_clock_in}
                    onChange={e => setAdminEditForm(f => ({ ...f, am_clock_in: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">午前 退勤</label>
                  <input
                    type="time"
                    className="input"
                    value={adminEditForm.am_clock_out}
                    onChange={e => setAdminEditForm(f => ({ ...f, am_clock_out: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">午後 出勤</label>
                  <input
                    type="time"
                    className="input"
                    value={adminEditForm.pm_clock_in}
                    onChange={e => setAdminEditForm(f => ({ ...f, pm_clock_in: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">午後 退勤</label>
                  <input
                    type="time"
                    className="input"
                    value={adminEditForm.pm_clock_out}
                    onChange={e => setAdminEditForm(f => ({ ...f, pm_clock_out: e.target.value }))}
                  />
                </div>
              </div>

              {/* ステータス */}
              <div>
                <label className="label">ステータス</label>
                <select
                  className="select"
                  value={
                    adminEditForm.status === 'paid_leave'
                      ? `paid_leave_${adminEditForm.leave_type}`
                      : adminEditForm.status
                  }
                  onChange={e => {
                    const v = e.target.value
                    if (v === 'paid_leave_full') {
                      setAdminEditForm(f => ({ ...f, status: 'paid_leave', leave_type: 'full' }))
                    } else if (v === 'paid_leave_am') {
                      setAdminEditForm(f => ({ ...f, status: 'paid_leave', leave_type: 'am' }))
                    } else if (v === 'paid_leave_pm') {
                      setAdminEditForm(f => ({ ...f, status: 'paid_leave', leave_type: 'pm' }))
                    } else {
                      setAdminEditForm(f => ({ ...f, status: v, leave_type: 'full' }))
                    }
                  }}
                >
                  <option value="present">出勤</option>
                  <option value="absent">欠勤</option>
                  <option value="late">遅刻</option>
                  <option value="early_leave">早退</option>
                  <option value="holiday">休日</option>
                  <option value="paid_leave_full">有給（終日）</option>
                  <option value="paid_leave_am">有給（午前）</option>
                  <option value="paid_leave_pm">有給（午後）</option>
                  <option value="sick_leave">病欠</option>
                </select>
              </div>

              {/* 退勤区分 */}
              <div>
                <label className="label">退勤区分</label>
                <select
                  className="select"
                  value={adminEditForm.clock_out_reason}
                  onChange={e => setAdminEditForm(f => ({ ...f, clock_out_reason: e.target.value }))}
                >
                  <option value="normal">通常退勤</option>
                  <option value="early_finish">業務完了（早上がり）</option>
                  <option value="early_leave">早退（体調不良・私用）</option>
                </select>
              </div>

              {/* メモ */}
              <div>
                {staffPayInfo?.pay_type === 'hourly' && (
                  <div>
                    <label className="label">時間外（分）</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        className="input w-28"
                        min={0}
                        max={480}
                        value={adminEditForm.overtime_minutes}
                        onChange={e => setAdminEditForm(f => ({ ...f, overtime_minutes: Number(e.target.value) }))}
                        placeholder="0"
                      />
                      <span className="text-xs text-gray-400">
                        {adminEditForm.overtime_minutes > 0
                          ? `（${Math.floor(adminEditForm.overtime_minutes/60)}時間${adminEditForm.overtime_minutes%60}分 × 1.25）`
                          : 'なし'}
                      </span>
                    </div>
                  </div>
                )}
                <div>
                <label className="label">メモ（任意）</label>
                <input
                  className="input"
                  value={adminEditForm.note}
                  onChange={e => setAdminEditForm(f => ({ ...f, note: e.target.value }))}
                  placeholder="例: 院長による修正"
                />
                </div>
              </div>

              {/* ボタン */}
              <div className="flex gap-2 pt-1">
                {adminEditRecord.id && (
                  <button
                    onClick={handleAdminDelete}
                    className="btn-danger text-sm px-3"
                  >
                    削除
                  </button>
                )}
                <button
                  onClick={() => setAdminEditRecord(null)}
                  className="btn-secondary flex-1 text-sm"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleAdminEditSave}
                  disabled={adminEditSaving}
                  className="btn-primary flex-1 text-sm"
                >
                  {adminEditSaving ? '保存中...' : adminEditRecord.id ? '更新' : '新規作成'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 院長用：記録のない日に直接入力 */}
        {isAdmin && noRecordDates.length > 0 && (
          <div className="card">
            <h3 className="text-xs font-semibold text-gray-500 mb-3">🔧 記録のない日に直接入力（院長）</h3>
            <div className="flex flex-wrap gap-2">
              {noRecordDates.map(d => {
                const dow = parseISO(d).getDay()
                const WEEKDAYS = ['日','月','火','水','木','金','土']
                const isWeekend = dow === 0 || dow === 6
                return (
                  <button
                    key={d}
                    onClick={() => openAdminEdit({ date: d, id: null })}
                    className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-all
                      ${isWeekend ? 'border-gray-200 text-gray-400 bg-gray-50 hover:bg-gray-100' : 'border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100'}`}
                  >
                    {format(parseISO(d), 'M/d')}({WEEKDAYS[dow]})
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* 月次サマリー */}
        {computedRecords.length > 0 && (
          <div className="card bg-gray-50">
            <h3 className="text-xs font-semibold text-gray-500 mb-3">月次サマリー</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-2 text-sm">
              <SummaryRow label="出勤日数" value={`${summary.workDays}日`} />
              <SummaryRow label="欠勤日数" value={`${summary.absentDays}日`} highlight={summary.absentDays > 0 ? 'text-red-500' : undefined} />
              <SummaryRow label="有給取得" value={`${summary.paidLeave}日`} />
              <SummaryRow label="遅刻回数" value={`${summary.lateCount}回`} highlight={summary.lateCount > 0 ? 'text-amber-600' : undefined} />
              <SummaryRow label="実働合計" value={summary.actualMin > 0 ? formatMinutes(summary.actualMin) : '—'} />
              <SummaryRow label="残業合計" value={summary.overtimeMin > 0 ? formatMinutes(summary.overtimeMin) : '—'} highlight={summary.overtimeMin > 0 ? 'text-amber-600' : undefined} />
              <SummaryRow label="控除合計" value={summary.deductionMin > 0 ? formatMinutes(summary.deductionMin) : '—'} highlight={summary.deductionMin > 0 ? 'text-red-500' : undefined} />
              {staffPayInfo?.pay_type === 'hourly' && summary.paidLeaveAmount > 0 && (
                <SummaryRow label="有給時給" value={`¥${summary.paidLeaveAmount.toLocaleString()}`} highlight="text-emerald-600" />
              )}
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}

const SummaryRow = ({ label, value, highlight }: { label: string; value: string; highlight?: string }) => (
  <div className="flex justify-between">
    <span className="text-gray-500">{label}</span>
    <span className={`font-medium ${highlight ?? 'text-gray-700'}`}>{value}</span>
  </div>
)
