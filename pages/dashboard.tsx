import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/lib/auth'
import { supabase, AttendanceRecord, ShiftAssignment, ShiftPatternBlock } from '@/lib/supabase'
import {
  todayString, formatTime, formatMinutes,
  statusLabel, statusColor, getCurrentMonth, getMonthRange,
  calcScheduledMinutes
} from '@/lib/utils'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'

export default function DashboardPage() {
  const { user, profile, loading, isAdmin, isLeader } = useAuth()
  const router = useRouter()
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null)
  const [todayShift, setTodayShift] = useState<ShiftAssignment | null>(null)
  const [todayBlocks, setTodayBlocks] = useState<ShiftPatternBlock[]>([])
  const [recentRecords, setRecentRecords] = useState<AttendanceRecord[]>([])
  const [pendingApprovals, setPendingApprovals] = useState(0)
  const [monthStats, setMonthStats] = useState({ overtime: 0, deduction: 0, late: 0 })
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [user, loading])

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!user) return
    fetchToday()
    fetchRecent()
    fetchMonthStats()
    if (isAdmin || isLeader) fetchPendingApprovals()
  }, [user, profile])

  const fetchToday = async () => {
    if (!user) return
    const today = todayString()
    const { data: rec } = await supabase
      .from('attendance_records').select('*').eq('user_id', user.id).eq('date', today).single()
    setTodayRecord(rec)

    const { data: sa } = await supabase
      .from('shift_assignments')
      .select('*, shift_patterns(*, shift_pattern_blocks(*))')
      .eq('user_id', user.id).eq('date', today).single()
    setTodayShift(sa)
    if (sa?.shift_patterns?.shift_pattern_blocks) {
      setTodayBlocks([...sa.shift_patterns.shift_pattern_blocks].sort(
        (a: ShiftPatternBlock, b: ShiftPatternBlock) => a.sort_order - b.sort_order
      ))
    }
  }

  const fetchRecent = async () => {
    if (!user) return
    const { data } = await supabase
      .from('attendance_records').select('*').eq('user_id', user.id)
      .order('date', { ascending: false }).limit(7)
    setRecentRecords(data ?? [])
  }

  const fetchMonthStats = async () => {
    if (!user) return
    const { start, end } = getMonthRange(getCurrentMonth())
    const { data } = await supabase
      .from('attendance_records').select('overtime_minutes,deduction_minutes,late_minutes')
      .eq('user_id', user.id).gte('date', start).lte('date', end)
    if (data) {
      setMonthStats({
        overtime: data.reduce((s, r) => s + (r.overtime_minutes ?? 0), 0),
        deduction: data.reduce((s, r) => s + (r.deduction_minutes ?? 0), 0),
        late: data.filter(r => (r.late_minutes ?? 0) > 0).length,
      })
    }
  }

  const fetchPendingApprovals = async () => {
    if (!user || !profile) return
    let q = supabase.from('attendance_records')
      .select('id', { count: 'exact', head: true })
      .eq('early_finish_status', 'pending')
    if (isLeader && !isAdmin && profile.department_id) {
      const { data: ids } = await supabase.from('profiles').select('id').eq('department_id', profile.department_id)
      if (ids) q = q.in('user_id', ids.map(i => i.id))
    }
    const { count } = await q
    setPendingApprovals(count ?? 0)
  }

  if (loading || !profile) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-4xl animate-pulse">🏥</div>
    </div>
  )

  const remaining = profile.annual_leave_days - profile.used_leave_days
  const scheduledMin = calcScheduledMinutes(todayBlocks)

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-5">
        {/* Header */}
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            おはようございます、{profile.name}さん 👋
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {format(now, 'yyyy年M月d日(EEE) HH:mm:ss', { locale: ja })}
          </p>
        </div>

        {/* Pending approval alert */}
        {(isAdmin || isLeader) && pendingApprovals > 0 && (
          <button
            onClick={() => router.push('/attendance/history')}
            className="w-full bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-left hover:bg-amber-100 transition-colors"
          >
            <span className="text-amber-700 font-medium text-sm">
              ⚠️ 早上がり承認待ちが {pendingApprovals} 件あります → 確認する
            </span>
          </button>
        )}

        {/* Top stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="card text-center">
            <div className="text-2xl font-bold text-clinic-700">{remaining}</div>
            <div className="text-xs text-gray-500 mt-0.5">有給残日数</div>
          </div>
          <div className="card text-center">
            <div className={`text-2xl font-bold ${monthStats.overtime > 0 ? 'text-amber-600' : 'text-gray-300'}`}>
              {monthStats.overtime > 0 ? formatMinutes(monthStats.overtime) : '—'}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">今月の残業</div>
          </div>
          <div className="card text-center">
            <div className={`text-2xl font-bold ${monthStats.late > 0 ? 'text-amber-600' : 'text-gray-300'}`}>
              {monthStats.late > 0 ? `${monthStats.late}回` : '—'}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">今月の遅刻</div>
          </div>
          <div className="card text-center">
            <div className={`text-2xl font-bold ${monthStats.deduction > 0 ? 'text-red-500' : 'text-gray-300'}`}>
              {monthStats.deduction > 0 ? formatMinutes(monthStats.deduction) : '—'}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">今月の控除</div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          {/* Today */}
          <div className="card space-y-4">
            <h2 className="font-semibold text-gray-800 text-sm">📅 今日の状況</h2>

            {/* Shift blocks */}
            {todayShift?.shift_patterns ? (
              <div className="bg-clinic-50 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span
                    className="text-xs font-bold text-white px-2.5 py-1 rounded-lg"
                    style={{ backgroundColor: todayShift.shift_patterns.color }}
                  >
                    {todayShift.shift_patterns.name}
                  </span>
                  <span className="text-xs text-gray-500">所定 {formatMinutes(scheduledMin)}</span>
                </div>
                <div className="space-y-1">
                  {todayBlocks.map((b, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-gray-600">
                      {b.label && <span className="text-gray-400 w-6">{b.label}</span>}
                      <span>{b.start_time.slice(0,5)} 〜 {b.end_time.slice(0,5)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-400">シフト未設定</div>
            )}

            {/* Today status */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-500">出勤</span>
                <span className="text-sm font-medium">{formatTime(todayRecord?.clock_in)}</span>
              </div>
              {todayRecord?.late_minutes > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-500">遅刻</span>
                  <span className="text-sm text-amber-600">+{formatMinutes(todayRecord.late_minutes)}</span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-500">退勤</span>
                <span className="text-sm font-medium">{formatTime(todayRecord?.clock_out)}</span>
              </div>
              {todayRecord?.clock_out && (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-gray-500">実働</span>
                    <span className="text-sm font-medium text-gray-700">{formatMinutes(todayRecord.actual_minutes)}</span>
                  </div>
                  {todayRecord.overtime_minutes > 0 && (
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-500">残業</span>
                      <span className="text-sm font-medium text-amber-600">+{formatMinutes(todayRecord.overtime_minutes)}</span>
                    </div>
                  )}
                  {todayRecord.deduction_minutes > 0 && (
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-500">控除</span>
                      <span className="text-sm font-medium text-red-500">-{formatMinutes(todayRecord.deduction_minutes)}</span>
                    </div>
                  )}
                </>
              )}
            </div>

            <button onClick={() => router.push('/attendance')} className="btn-primary w-full text-sm">
              ⏱️ 打刻ページへ
            </button>
          </div>

          {/* Recent */}
          <div className="card">
            <h2 className="font-semibold text-gray-800 text-sm mb-3">📋 最近の勤怠</h2>
            {recentRecords.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">記録がありません</p>
            ) : (
              <div className="space-y-2">
                {recentRecords.map(r => (
                  <div key={r.id} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                    <div>
                      <div className="text-xs font-medium text-gray-700">{r.date}</div>
                      <div className="text-xs text-gray-400">
                        {formatTime(r.clock_in)} 〜 {formatTime(r.clock_out)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-right">
                      <div>
                        {r.actual_minutes > 0 && (
                          <div className="text-xs text-gray-600">{formatMinutes(r.actual_minutes)}</div>
                        )}
                        {r.overtime_minutes > 0 && (
                          <div className="text-xs text-amber-600">+{formatMinutes(r.overtime_minutes)}</div>
                        )}
                        {r.deduction_minutes > 0 && (
                          <div className="text-xs text-red-500">-{formatMinutes(r.deduction_minutes)}</div>
                        )}
                      </div>
                      <span className={`badge ${statusColor(r.status)}`}>{statusLabel(r.status)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => router.push('/attendance/history')} className="btn-secondary w-full text-xs mt-3">
              履歴をもっと見る →
            </button>
          </div>
        </div>
      </div>
    </Layout>
  )
}
