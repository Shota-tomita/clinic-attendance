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
import { format, addMonths, subMonths, parseISO, differenceInMinutes } from 'date-fns'
import { ja } from 'date-fns/locale'

// 実働時間計算（シフト開始より早い分を除外・早出申請対応・中抜き対応）
function calcActualMin(r: any, shiftBlocks: any[], earlyStartTime?: string): number {
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
      if (earlyStartTime) {
        // 早出申請あり → 申請時刻から計算
        const approvedStart = new Date(`${r.date}T${earlyStartTime}+09:00`)
        effectiveAmIn = rawAmIn < approvedStart ? approvedStart : rawAmIn
      } else {
        // 早出申請なし → シフト開始から計算
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
    // 通常の午後ブロック：シフト開始より早い場合はシフト開始から
    const [sh, sm] = pmBlock.start_time.split(':').map(Number)
    const shiftPmStart = new Date(`${r.date}T${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}:00+09:00`)
    if (rawPmIn < shiftPmStart) effectivePmIn = shiftPmStart
  } else if (rawPmIn && !pmBlock && amBlock) {
    // ブロックが1つのみ（opeシフト等）: そのブロックの開始時間で判定
    const [sh, sm] = amBlock.start_time.split(':').map(Number)
    const shiftStart = new Date(`${r.date}T${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}:00+09:00`)
    if (rawPmIn < shiftStart) effectivePmIn = shiftStart
  }

  if (effectivePmIn && pmOut) {
    total += Math.max(differenceInMinutes(pmOut, effectivePmIn), 0)
  }

  // am_inからpm_outまでのフォールバック（pm_clock_inがない旧形式）
  if (!rawPmIn && effectiveAmIn && pmOut && total === 0) {
    total = Math.max(differenceInMinutes(pmOut, effectiveAmIn), 0)
  }

  // 旧形式フォールバック
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

export default function AttendanceHistoryPage() {
  const { user, profile, loading, isAdmin, isLeader } = useAuth()
  const router = useRouter()
  const [month, setMonth] = useState(getCurrentMonth())
  const [records, setRecords] = useState<any[]>([])
  const [shiftMap, setShiftMap] = useState<Record<string, any[]>>({})
  const [earlyStartMap, setEarlyStartMap] = useState<Record<string, string>>({}) // date -> approved start_time
  const [staffList, setStaffList] = useState<Profile[]>([])
  const [selectedStaffId, setSelectedStaffId] = useState('')
  const [fetching, setFetching] = useState(false)
  const [approving, setApproving] = useState<string | null>(null)

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
    let q = supabase.from('profiles').select('*').order('name')
    if (isLeader && !isAdmin && profile?.department_id) {
      q = q.eq('department_id', profile.department_id)
    }
    const { data } = await q
    setStaffList(data ?? [])
    if (data && !selectedStaffId) {
      setSelectedStaffId(user?.id ?? data[0]?.id ?? '')
    }
  }

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
      .order('date', { ascending: false })
    setRecords(data ?? [])
    setFetching(false)
  }

  const fetchEarlyStarts = async () => {
    if (!selectedStaffId) return
    const { start, end } = getMonthRange(month)
    const { data } = await supabase
      .from('early_start_requests')
      .select('date, start_time')
      .eq('user_id', selectedStaffId)
      .eq('status', 'approved')
      .gte('date', start)
      .lte('date', end)
    const map: Record<string, string> = {}
    for (const d of data ?? []) map[d.date] = d.start_time
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

  const prevMonth = () => setMonth(format(subMonths(parseISO(month + '-01'), 1), 'yyyy-MM'))
  const nextMonth = () => setMonth(format(addMonths(parseISO(month + '-01'), 1), 'yyyy-MM'))

  // フロントエンドで計算
  const computedRecords = records.map(r => {
    const blocks = shiftMap[r.date] ?? []
    const earlyStart = earlyStartMap[r.date]
    const scheduledMin = calcScheduledMinWithHalfLeave(r, blocks)
    const actualMin = calcActualMin(r, blocks, earlyStart)
    const lateMin = calcLateMin(r, blocks)
    const { amLate, pmLate } = calcLateMinDetail(r, blocks)
    // 残業 = シフト終了後の実働時間
    const overtimeMin = calcOvertimeMin(r, blocks)
    // 控除計算：
    // - 早上がり承認済み・承認待ち → 控除0
    // - 退勤時刻がシフト終了より早い（早上がり検出）→ 控除0
    // - 早退（clock_out_reason=early_leave）→ 所定-実働
    // - 早上がり否認 → 所定-実働
    // - それ以外 → 所定-実働（マイナスは0）
    const isEarlyLeave = r.clock_out_reason === 'early_leave' || r.status === 'early_leave'
    const isEarlyFinishRejected = r.early_finish_status === 'rejected'
    const isEarlyFinishExempt = r.early_finish_status === 'approved' || r.early_finish_status === 'pending'
    const earlyFinishDetected = !isEarlyLeave && !isEarlyFinishRejected && isEarlyFinish(r, blocks)
    const deductionMin = (isEarlyFinishExempt || earlyFinishDetected)
      ? 0
      : Math.max(scheduledMin - actualMin, 0)
    return { ...r, _scheduledMin: scheduledMin, _actualMin: actualMin, _lateMin: lateMin, _amLate: amLate, _pmLate: pmLate, _overtimeMin: overtimeMin, _deductionMin: deductionMin }
  })

  // 月次集計
  const summary = {
    workDays: computedRecords.filter(r => ['present', 'late', 'early_leave'].includes(r.status)).length,
    overtimeMin: computedRecords.reduce((s, r) => s + r._overtimeMin, 0),
    deductionMin: computedRecords.reduce((s, r) => s + r._deductionMin, 0),
    lateCount: computedRecords.filter(r => r._lateMin > 0).length,
    absentDays: computedRecords.filter(r => r.status === 'absent').length,
    paidLeave: computedRecords.filter(r => r.status === 'paid_leave').length,
    actualMin: computedRecords.reduce((s, r) => s + r._actualMin, 0),
    pendingApprovals: computedRecords.filter(r => r.early_finish_status === 'pending').length,
  }

  const canReview = isAdmin || isLeader

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
              {staffList.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
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
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {fetching ? (
                  <tr><td colSpan={12} className="text-center py-8 text-gray-400">読込中...</td></tr>
                ) : computedRecords.length === 0 ? (
                  <tr><td colSpan={12} className="text-center py-8 text-gray-400">この月の記録はありません</td></tr>
                ) : computedRecords.map(r => {
                  const isShort = r._scheduledMin > 0 && r._actualMin < r._scheduledMin && ['present','late','early_leave'].includes(r.status)
                  return (
                  <tr key={r.id} className={`hover:bg-gray-50 ${r.early_finish_status === 'pending' ? 'bg-amber-50/40' : isShort ? 'bg-red-50/40' : ''}`}>
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
                      {canReview && r.early_finish_status === 'pending' ? (
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
                  </tr>
                )})
                }
              </tbody>
            </table>
          </div>
        </div>

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
