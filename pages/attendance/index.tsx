import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/lib/auth'
import { supabase, AttendanceRecord, ShiftAssignment, ShiftPatternBlock, ClockOutReason } from '@/lib/supabase'
import {
  todayString, formatTime, formatMinutes,
  calcScheduledMinutes, calcActualMinutes, calcLateMinutes, calcEarlyMinutes,
  calcAttendance, clockOutReasonLabel, earlyFinishStatusLabel, earlyFinishStatusColor,
  blocksToTimeRange
} from '@/lib/utils'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'

export default function AttendancePage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  const [record, setRecord] = useState<AttendanceRecord | null>(null)
  const [shift, setShift] = useState<ShiftAssignment | null>(null)
  const [blocks, setBlocks] = useState<ShiftPatternBlock[]>([])
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [now, setNow] = useState(new Date())

  // 退勤時の選択
  const [showClockOutModal, setShowClockOutModal] = useState(false)
  const [clockOutReason, setClockOutReason] = useState<ClockOutReason>('normal')

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [user, loading])

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (user) fetchToday()
  }, [user])

  const fetchToday = async () => {
    if (!user) return
    const today = todayString()

    const { data: rec } = await supabase
      .from('attendance_records')
      .select('*')
      .eq('user_id', user.id)
      .eq('date', today)
      .single()
    setRecord(rec)

    const { data: sa } = await supabase
      .from('shift_assignments')
      .select('*, shift_patterns(*, shift_pattern_blocks(*))')
      .eq('user_id', user.id)
      .eq('date', today)
      .single()
    setShift(sa)

    if (sa?.shift_patterns?.shift_pattern_blocks) {
      const sorted = [...sa.shift_patterns.shift_pattern_blocks].sort(
        (a: ShiftPatternBlock, b: ShiftPatternBlock) => a.sort_order - b.sort_order
      )
      setBlocks(sorted)
    }
  }

  // リアルタイム計算（退勤前のプレビュー）
  const liveCalc = () => {
    if (!record?.clock_in) return null
    const clockOut = new Date().toISOString()
    return calcAttendance({
      blocks,
      clockIn: record.clock_in,
      clockOut,
      date: todayString(),
      clockOutReason,
      currentEarlyFinishStatus: 'not_required',
      isAbsent: false,
    })
  }

  const clockIn = async () => {
    if (!user || saving) return
    setSaving(true)
    setMessage('')
    const now = new Date().toISOString()
    const today = todayString()

    // 遅刻チェック
    const lateMin = calcLateMinutes(blocks, now, today)
    const status = lateMin > 0 ? 'late' : 'present'

    const { error } = await supabase.from('attendance_records').upsert({
      user_id: user.id,
      date: today,
      clock_in: now,
      status,
      late_minutes: lateMin,
      scheduled_minutes: calcScheduledMinutes(blocks),
      clock_out_reason: 'normal',
      early_finish_status: 'not_required',
    }, { onConflict: 'user_id,date' })

    setSaving(false)
    if (error) { setMessage('エラー: ' + error.message); return }
    setMessage(lateMin > 0
      ? `✅ 出勤打刻しました（遅刻 ${formatMinutes(lateMin)}）`
      : '✅ 出勤打刻しました'
    )
    fetchToday()
  }

  const clockOut = async () => {
    if (!user || !record || saving) return
    setSaving(true)
    setMessage('')

    const clockOutTime = new Date().toISOString()
    const today = todayString()

    const result = calcAttendance({
      blocks,
      clockIn: record.clock_in,
      clockOut: clockOutTime,
      date: today,
      clockOutReason,
      currentEarlyFinishStatus: 'not_required',
      isAbsent: false,
    })

    // ステータス判定
    let status = record.status
    if (result.lateMinutes > 0 && result.earlyLeaveMinutes > 0) status = 'early_leave'
    else if (result.lateMinutes > 0) status = 'late'
    else if (clockOutReason === 'early_leave') status = 'early_leave'
    else status = 'present'

    const { error } = await supabase.from('attendance_records').update({
      clock_out: clockOutTime,
      clock_out_reason: clockOutReason,
      status,
      actual_minutes: result.actualMinutes,
      overtime_minutes: result.overtimeMinutes,
      deduction_minutes: result.deductionMinutes,
      late_minutes: result.lateMinutes,
      early_leave_minutes: result.earlyLeaveMinutes,
      early_finish_status: result.earlyFinishStatus,
    }).eq('id', record.id)

    setSaving(false)
    setShowClockOutModal(false)
    if (error) { setMessage('エラー: ' + error.message); return }

    let msg = '✅ 退勤打刻しました'
    if (result.overtimeMinutes > 0) msg += `（残業 ${formatMinutes(result.overtimeMinutes)}）`
    if (result.earlyFinishStatus === 'pending') msg += '\n📋 30分以上の早上がりのため、リーダー/院長の承認待ちです'
    setMessage(msg)
    fetchToday()
  }

  const canClockIn = !record?.clock_in
  const canClockOut = !!record?.clock_in && !record?.clock_out
  const scheduledMin = calcScheduledMinutes(blocks)
  const preview = canClockOut ? liveCalc() : null

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-4xl animate-pulse">🏥</div>
    </div>
  )

  return (
    <Layout>
      <div className="max-w-md mx-auto space-y-4">
        <h1 className="text-xl font-semibold text-gray-900">⏱️ 出退勤打刻</h1>

        {/* Clock display */}
        <div className="card text-center py-7">
          <div className="text-5xl font-display font-semibold text-clinic-700 tabular-nums">
            {format(now, 'HH:mm:ss')}
          </div>
          <div className="text-sm text-gray-500 mt-1.5">
            {format(now, 'yyyy年M月d日(EEE)', { locale: ja })}
          </div>
        </div>

        {/* Today's shift */}
        {shift?.shift_patterns && (
          <div className="card py-3">
            <div className="text-xs text-gray-400 mb-1.5">本日のシフト</div>
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="text-xs font-bold text-white px-2.5 py-1 rounded-lg"
                style={{ backgroundColor: shift.shift_patterns.color }}
              >
                {shift.shift_patterns.name}
              </span>
              <div className="space-y-0.5">
                {blocks.map((b, i) => (
                  <div key={i} className="text-xs text-gray-600">
                    {b.label && <span className="text-gray-400 mr-1">{b.label}</span>}
                    {b.start_time.slice(0, 5)} 〜 {b.end_time.slice(0, 5)}
                  </div>
                ))}
              </div>
              <span className="text-xs text-gray-400 ml-auto">
                所定 {formatMinutes(scheduledMin)}
              </span>
            </div>
          </div>
        )}

        {/* Status grid */}
        <div className="card space-y-2.5">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">本日の状況</h2>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <div className="text-lg font-semibold text-gray-800">{formatTime(record?.clock_in)}</div>
              <div className="text-xs text-gray-400 mt-0.5">出勤</div>
              {record?.late_minutes && record.late_minutes > 0 ? (
                <div className="text-xs text-amber-600 mt-0.5">遅刻 {formatMinutes(record.late_minutes)}</div>
              ) : null}
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <div className="text-lg font-semibold text-gray-800">{formatTime(record?.clock_out)}</div>
              <div className="text-xs text-gray-400 mt-0.5">退勤</div>
              {record?.clock_out && record.clock_out_reason !== 'normal' && (
                <div className={`text-xs mt-0.5 ${record.clock_out_reason === 'early_leave' ? 'text-orange-500' : 'text-blue-500'}`}>
                  {clockOutReasonLabel(record.clock_out_reason)}
                </div>
              )}
            </div>
          </div>

          {/* Calculated times */}
          {record?.clock_in && record?.clock_out && (
            <div className="border-t border-gray-100 pt-2.5 space-y-1.5">
              <Row label="実働時間" value={formatMinutes(record.actual_minutes)} />
              <Row label="所定時間" value={formatMinutes(record.scheduled_minutes)} />
              {record.overtime_minutes > 0 && (
                <Row label="残業時間" value={formatMinutes(record.overtime_minutes)} highlight="text-amber-600" />
              )}
              {record.deduction_minutes > 0 && (
                <Row label="控除時間" value={formatMinutes(record.deduction_minutes)} highlight="text-red-500" />
              )}
              {record.early_finish_status !== 'not_required' && (
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-500">早上がり承認</span>
                  <span className={`badge text-xs ${earlyFinishStatusColor(record.early_finish_status)}`}>
                    {earlyFinishStatusLabel(record.early_finish_status)}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Live preview while working */}
          {canClockOut && preview && (
            <div className="border-t border-dashed border-clinic-200 pt-2.5 space-y-1 bg-clinic-50/30 rounded-lg px-2 py-2">
              <div className="text-xs text-clinic-600 font-medium mb-1">現時点での見込み</div>
              <Row label="実働" value={formatMinutes(preview.actualMinutes)} />
              {preview.overtimeMinutes > 0 && (
                <Row label="残業（見込）" value={formatMinutes(preview.overtimeMinutes)} highlight="text-amber-600" />
              )}
              {preview.lateMinutes > 0 && (
                <Row label="遅刻" value={formatMinutes(preview.lateMinutes)} highlight="text-amber-600" />
              )}
            </div>
          )}
        </div>

        {/* Clock buttons */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={clockIn}
            disabled={!canClockIn || saving}
            className={`py-5 rounded-xl font-semibold text-base transition-all duration-200
              ${canClockIn
                ? 'bg-clinic-600 text-white hover:bg-clinic-700 btn-clock shadow-lg shadow-clinic-200'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
          >
            <div className="text-2xl mb-1">🟢</div>
            出勤
          </button>
          <button
            onClick={() => { setClockOutReason('normal'); setShowClockOutModal(true) }}
            disabled={!canClockOut || saving}
            className={`py-5 rounded-xl font-semibold text-base transition-all duration-200
              ${canClockOut
                ? 'bg-red-500 text-white hover:bg-red-600 shadow-lg shadow-red-100'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
          >
            <div className="text-2xl mb-1">🔴</div>
            退勤
          </button>
        </div>

        {message && (
          <div className="text-sm text-gray-700 bg-emerald-50 border border-emerald-100 rounded-lg px-4 py-3 whitespace-pre-line">
            {message}
          </div>
        )}

        {record?.clock_out && (
          <div className="card text-center bg-clinic-50 border-clinic-100">
            <p className="text-sm text-clinic-700 font-medium">本日の勤務は完了しました 🎉</p>
            <p className="text-xs text-clinic-500 mt-1">
              実働: {formatMinutes(record.actual_minutes)}
              {record.overtime_minutes > 0 && `（残業 ${formatMinutes(record.overtime_minutes)}）`}
              {record.deduction_minutes > 0 && ` / 控除 ${formatMinutes(record.deduction_minutes)}`}
            </p>
          </div>
        )}
      </div>

      {/* Clock-out reason modal */}
      {showClockOutModal && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="font-semibold text-gray-800">退勤理由を選択</h2>

            <div className="space-y-2">
              {([
                { value: 'normal' as ClockOutReason, label: '通常退勤', desc: '所定時間通り、または残業後', icon: '✅' },
                { value: 'early_finish' as ClockOutReason, label: '業務完了（早上がり）', desc: '仕事が終わったため早めに上がる（控除なし申請）', icon: '🏃' },
                { value: 'early_leave' as ClockOutReason, label: '早退', desc: '体調不良・私用など（控除あり）', icon: '🤒' },
              ] as const).map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setClockOutReason(opt.value)}
                  className={`w-full text-left rounded-xl p-3.5 border-2 transition-all
                    ${clockOutReason === opt.value
                      ? 'border-clinic-500 bg-clinic-50'
                      : 'border-gray-200 hover:border-gray-300'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{opt.icon}</span>
                    <div>
                      <div className="text-sm font-medium text-gray-800">{opt.label}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{opt.desc}</div>
                    </div>
                    {clockOutReason === opt.value && (
                      <span className="ml-auto text-clinic-500">✓</span>
                    )}
                  </div>
                </button>
              ))}
            </div>

            {/* Preview for selected reason */}
            {(() => {
              const p = calcAttendance({
                blocks,
                clockIn: record?.clock_in ?? null,
                clockOut: new Date().toISOString(),
                date: todayString(),
                clockOutReason,
                currentEarlyFinishStatus: 'not_required',
                isAbsent: false,
              })
              return (
                <div className="bg-gray-50 rounded-xl p-3 text-xs space-y-1 text-gray-600">
                  <div className="font-medium text-gray-700 mb-1">この退勤で確定する内容</div>
                  <div className="flex justify-between">
                    <span>所定時間</span><span>{formatMinutes(p.scheduledMinutes)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>実働時間</span><span>{formatMinutes(p.actualMinutes)}</span>
                  </div>
                  {p.overtimeMinutes > 0 && (
                    <div className="flex justify-between text-amber-600 font-medium">
                      <span>残業時間</span><span>+{formatMinutes(p.overtimeMinutes)}</span>
                    </div>
                  )}
                  {p.lateMinutes > 0 && (
                    <div className="flex justify-between text-amber-600">
                      <span>遅刻</span><span>{formatMinutes(p.lateMinutes)}</span>
                    </div>
                  )}
                  {p.earlyLeaveMinutes > 0 && (
                    <div className="flex justify-between text-red-500">
                      <span>早退控除</span><span>-{formatMinutes(p.earlyLeaveMinutes)}</span>
                    </div>
                  )}
                  {p.deductionMinutes > 0 && (
                    <div className="flex justify-between text-red-600 font-medium border-t border-gray-200 pt-1 mt-1">
                      <span>合計控除</span><span>-{formatMinutes(p.deductionMinutes)}</span>
                    </div>
                  )}
                  {p.earlyFinishStatus === 'pending' && (
                    <div className="text-amber-600 mt-1">
                      ⚠️ 30分以上の早上がりのため、承認が必要です
                    </div>
                  )}
                </div>
              )
            })()}

            <div className="flex gap-3">
              <button onClick={() => setShowClockOutModal(false)} className="btn-secondary flex-1">キャンセル</button>
              <button onClick={clockOut} disabled={saving} className="btn-primary flex-1">
                {saving ? '打刻中...' : '退勤確定'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}

const Row = ({ label, value, highlight }: { label: string; value: string; highlight?: string }) => (
  <div className="flex justify-between items-center">
    <span className="text-xs text-gray-500">{label}</span>
    <span className={`text-sm font-medium ${highlight ?? 'text-gray-700'}`}>{value}</span>
  </div>
)
