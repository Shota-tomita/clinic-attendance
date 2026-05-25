import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/lib/auth'
import { supabase, AttendanceRecord, Profile } from '@/lib/supabase'
import {
  formatTime, formatMinutes, statusLabel, statusColor,
  clockOutReasonLabel, earlyFinishStatusLabel, earlyFinishStatusColor,
  getCurrentMonth, getMonthRange
} from '@/lib/utils'
import { format, addMonths, subMonths, parseISO } from 'date-fns'
import { ja } from 'date-fns/locale'

export default function AttendanceHistoryPage() {
  const { user, profile, loading, isAdmin, isLeader } = useAuth()
  const router = useRouter()
  const [month, setMonth] = useState(getCurrentMonth())
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [staffList, setStaffList] = useState<Profile[]>([])
  const [selectedStaffId, setSelectedStaffId] = useState('')
  const [fetching, setFetching] = useState(false)
  const [approving, setApproving] = useState<string | null>(null)

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [user, loading])

  useEffect(() => {
    if (!user || !profile) return
    if (isAdmin || isLeader) fetchStaff()
    else setSelectedStaffId(user.id)
  }, [user, profile])

  useEffect(() => {
    if (selectedStaffId) fetchRecords()
    else if (!isAdmin && !isLeader && user) setSelectedStaffId(user.id)
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

  const handleEarlyFinishReview = async (recordId: string, approved: boolean) => {
    if (!user) return
    setApproving(recordId)
    const status = approved ? 'approved' : 'rejected'

    // 承認/否認後に控除を再計算
    const rec = records.find(r => r.id === recordId)
    if (!rec) { setApproving(null); return }

    let newEarlyLeaveMinutes = rec.early_leave_minutes
    let newDeductionMinutes = rec.deduction_minutes

    if (approved) {
      // 承認 → 早退控除をゼロに
      newEarlyLeaveMinutes = 0
      newDeductionMinutes = Math.max(rec.deduction_minutes - rec.early_leave_minutes, 0)
    } else {
      // 否認 → 控除は据え置き（既に計算済）
    }

    await supabase.from('attendance_records').update({
      early_finish_status: status,
      early_finish_reviewed_by: user.id,
      early_finish_reviewed_at: new Date().toISOString(),
      early_leave_minutes: newEarlyLeaveMinutes,
      deduction_minutes: newDeductionMinutes,
      status: approved ? 'present' : 'early_leave',
    }).eq('id', recordId)

    setApproving(null)
    fetchRecords()
  }

  const prevMonth = () => setMonth(format(subMonths(parseISO(month + '-01'), 1), 'yyyy-MM'))
  const nextMonth = () => setMonth(format(addMonths(parseISO(month + '-01'), 1), 'yyyy-MM'))

  // 月次集計
  const summary = {
    workDays: records.filter(r => ['present', 'late', 'early_leave'].includes(r.status)).length,
    overtimeMin: records.reduce((s, r) => s + (r.overtime_minutes ?? 0), 0),
    deductionMin: records.reduce((s, r) => s + (r.deduction_minutes ?? 0), 0),
    lateCount: records.filter(r => (r.late_minutes ?? 0) > 0).length,
    absentDays: records.filter(r => r.status === 'absent').length,
    paidLeave: records.filter(r => r.status === 'paid_leave').length,
    pendingApprovals: records.filter(r => r.early_finish_status === 'pending').length,
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

        {/* Summary */}
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

        {/* Pending approvals banner */}
        {canReview && summary.pendingApprovals > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-2">
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
                  <th className="table-th">出勤</th>
                  <th className="table-th">退勤</th>
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
                  <tr><td colSpan={9} className="text-center py-8 text-gray-400">読込中...</td></tr>
                ) : records.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-8 text-gray-400">この月の記録はありません</td></tr>
                ) : records.map(r => (
                  <tr key={r.id} className={`hover:bg-gray-50 ${r.early_finish_status === 'pending' ? 'bg-amber-50/40' : ''}`}>
                    <td className="table-td font-medium whitespace-nowrap">
                      {format(parseISO(r.date), 'M/d(EEE)', { locale: ja })}
                    </td>
                    <td className="table-td whitespace-nowrap">
                      {formatTime(r.clock_in)}
                      {r.late_minutes > 0 && (
                        <div className="text-[10px] text-amber-600">+{formatMinutes(r.late_minutes)}</div>
                      )}
                    </td>
                    <td className="table-td whitespace-nowrap">
                      {formatTime(r.clock_out)}
                      {r.clock_out_reason && r.clock_out_reason !== 'normal' && (
                        <div className="text-[10px] text-gray-400">
                          {r.clock_out_reason === 'early_finish' ? '早上がり' : '早退'}
                        </div>
                      )}
                    </td>
                    <td className="table-td text-gray-500">
                      {r.scheduled_minutes > 0 ? formatMinutes(r.scheduled_minutes) : '—'}
                    </td>
                    <td className="table-td font-medium">
                      {r.actual_minutes > 0 ? formatMinutes(r.actual_minutes) : '—'}
                    </td>
                    <td className="table-td">
                      {r.overtime_minutes > 0
                        ? <span className="text-amber-600 font-medium">+{formatMinutes(r.overtime_minutes)}</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="table-td">
                      {r.deduction_minutes > 0
                        ? <span className="text-red-500 font-medium">-{formatMinutes(r.deduction_minutes)}</span>
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
                          <button
                            onClick={() => handleEarlyFinishReview(r.id, true)}
                            disabled={approving === r.id}
                            className="text-xs bg-emerald-100 text-emerald-700 hover:bg-emerald-200 px-2 py-1 rounded font-medium"
                          >
                            承認
                          </button>
                          <button
                            onClick={() => handleEarlyFinishReview(r.id, false)}
                            disabled={approving === r.id}
                            className="text-xs bg-red-100 text-red-600 hover:bg-red-200 px-2 py-1 rounded font-medium"
                          >
                            否認
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">{r.note ?? ''}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Month totals */}
        {records.length > 0 && (
          <div className="card bg-gray-50">
            <h3 className="text-xs font-semibold text-gray-500 mb-3">月次サマリー</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-2 text-sm">
              <SummaryRow label="出勤日数" value={`${summary.workDays}日`} />
              <SummaryRow label="欠勤日数" value={`${summary.absentDays}日`} highlight={summary.absentDays > 0 ? 'text-red-500' : undefined} />
              <SummaryRow label="有給取得" value={`${summary.paidLeave}日`} />
              <SummaryRow label="遅刻回数" value={`${summary.lateCount}回`} highlight={summary.lateCount > 0 ? 'text-amber-600' : undefined} />
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
