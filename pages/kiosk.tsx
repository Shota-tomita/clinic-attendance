import { useState, useEffect } from 'react'
import { supabase, AttendanceRecord, ShiftPatternBlock } from '@/lib/supabase'
import {
  todayString, formatTime, formatMinutes,
  calcScheduledMinutes, calcLateMinutes, calcAttendance
} from '@/lib/utils'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'

// 共用アカウントのメールアドレス（Supabaseに登録するアカウント）
const KIOSK_SHARED_EMAIL_DOMAIN = 'kiosk'  // kiosk@クリニックドメイン など

type Step = 'blocked' | 'staff_login' | 'clock_action' | 'done'

type StaffSession = {
  id: string
  name: string
  record: AttendanceRecord | null
  blocks: ShiftPatternBlock[]
}

export default function KioskPage() {
  const [step, setStep] = useState<Step>('staff_login')
  const [ipAllowed, setIpAllowed] = useState<boolean | null>(null)
  const [staffEmail, setStaffEmail] = useState('')
  const [staffPassword, setStaffPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [staffSession, setStaffSession] = useState<StaffSession | null>(null)
  const [saving, setSaving] = useState(false)
  const [clockOutReason, setClockOutReason] = useState<'normal' | 'early_finish' | 'early_leave'>('normal')
  const [showReasonSelect, setShowReasonSelect] = useState(false)
  const [resultMessage, setResultMessage] = useState('')
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // IP確認
  useEffect(() => {
    checkIp()
  }, [])

  // 完了後5秒でリセット
  useEffect(() => {
    if (step === 'done') {
      const t = setTimeout(resetAll, 5000)
      return () => clearTimeout(t)
    }
  }, [step])

  const checkIp = async () => {
    try {
      // クライアントのIPを取得
      const res = await fetch('https://api.ipify.org?format=json')
      const { ip } = await res.json()

      // Supabaseの許可IPリストと照合
      const { data } = await supabase
        .from('kiosk_settings')
        .select('allowed_ips')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      const allowed: string[] = data?.allowed_ips ?? []

      // IPリストが空 = 未設定（セットアップ中）→ 通す
      if (allowed.length === 0) {
        setIpAllowed(true)
        return
      }

      setIpAllowed(allowed.includes(ip))
      if (!allowed.includes(ip)) setStep('blocked')
    } catch {
      // IP取得失敗時は通す（ネットワークエラー考慮）
      setIpAllowed(true)
    }
  }

  const resetAll = () => {
    setStep('staff_login')
    setStaffEmail('')
    setStaffPassword('')
    setLoginError('')
    setStaffSession(null)
    setResultMessage('')
    setShowReasonSelect(false)
    setClockOutReason('normal')
  }

  const staffLogin = async () => {
    if (!staffEmail || !staffPassword) {
      setLoginError('IDとパスワードを入力してください')
      return
    }
    setSaving(true)
    setLoginError('')

    const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
      email: staffEmail,
      password: staffPassword,
    })

    if (authErr || !authData.user) {
      setLoginError('IDまたはパスワードが違います')
      setSaving(false)
      return
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authData.user.id)
      .single()

    if (!profile) {
      setLoginError('スタッフ情報が見つかりません')
      setSaving(false)
      return
    }

    // 今日の打刻記録
    const { data: record } = await supabase
      .from('attendance_records')
      .select('*')
      .eq('user_id', authData.user.id)
      .eq('date', todayString())
      .single()

    // シフトブロック
    const { data: shift } = await supabase
      .from('shift_assignments')
      .select('*, shift_patterns(*, shift_pattern_blocks(*))')
      .eq('user_id', authData.user.id)
      .eq('date', todayString())
      .single()

    const blocks: ShiftPatternBlock[] = shift?.shift_patterns?.shift_pattern_blocks
      ? [...shift.shift_patterns.shift_pattern_blocks].sort(
          (a: ShiftPatternBlock, b: ShiftPatternBlock) => a.sort_order - b.sort_order
        )
      : []

    setStaffSession({ id: authData.user.id, name: profile.name, record, blocks })
    setSaving(false)
    setStep('clock_action')

    // キオスクはステートレス→セッションをすぐ破棄
    await supabase.auth.signOut()
  }

  const doClockin = async () => {
    if (!staffSession || saving) return
    setSaving(true)
    const nowIso = new Date().toISOString()
    const today = todayString()
    const lateMin = calcLateMinutes(staffSession.blocks, nowIso, today)

    const { error } = await supabase.from('attendance_records').upsert({
      user_id: staffSession.id,
      date: today,
      clock_in: nowIso,
      status: lateMin > 0 ? 'late' : 'present',
      late_minutes: lateMin,
      scheduled_minutes: calcScheduledMinutes(staffSession.blocks),
      clock_out_reason: 'normal',
      early_finish_status: 'not_required',
    }, { onConflict: 'user_id,date' })

    setSaving(false)
    if (error) { setResultMessage('エラーが発生しました'); setStep('done'); return }

    setResultMessage(
      lateMin > 0
        ? `${staffSession.name} さん、出勤しました\n⚠️ 遅刻 ${formatMinutes(lateMin)}`
        : `${staffSession.name} さん、出勤しました ✅`
    )
    setStep('done')
  }

  const doClockout = async () => {
    if (!staffSession?.record || saving) return
    setSaving(true)
    const nowIso = new Date().toISOString()

    const result = calcAttendance({
      blocks: staffSession.blocks,
      clockIn: staffSession.record.clock_in,
      clockOut: nowIso,
      date: todayString(),
      clockOutReason,
      currentEarlyFinishStatus: 'not_required',
      isAbsent: false,
    })

    let status = staffSession.record.status
    if (clockOutReason === 'early_leave') status = 'early_leave'
    else if (result.lateMinutes > 0) status = 'late'
    else status = 'present'

    const { error } = await supabase.from('attendance_records').update({
      clock_out: nowIso,
      clock_out_reason: clockOutReason,
      status,
      actual_minutes: result.actualMinutes,
      overtime_minutes: result.overtimeMinutes,
      deduction_minutes: result.deductionMinutes,
      late_minutes: result.lateMinutes,
      early_leave_minutes: result.earlyLeaveMinutes,
      early_finish_status: result.earlyFinishStatus,
    }).eq('id', staffSession.record.id)

    setSaving(false)
    if (error) { setResultMessage('エラーが発生しました'); setStep('done'); return }

    let msg = `${staffSession.name} さん、退勤しました ✅\n`
    msg += `実働: ${formatMinutes(result.actualMinutes)}`
    if (result.overtimeMinutes > 0) msg += ` / 残業: ${formatMinutes(result.overtimeMinutes)}`
    if (result.earlyFinishStatus === 'pending') msg += '\n📋 早上がりは承認待ちです'
    setResultMessage(msg)
    setStep('done')
  }

  const canClockIn = staffSession && !staffSession.record?.clock_in
  const canClockOut = staffSession?.record?.clock_in && !staffSession.record?.clock_out

  return (
    <div className="min-h-screen bg-gradient-to-br from-clinic-900 to-clinic-700 flex flex-col items-center justify-center p-6">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="text-5xl mb-2">🏥</div>
        <h1 className="text-2xl font-display font-bold text-white">出退勤打刻</h1>
        <p className="text-clinic-200 text-sm mt-1">
          {format(now, 'yyyy年M月d日(EEE) HH:mm:ss', { locale: ja })}
        </p>
      </div>

      <div className="w-full max-w-sm">

        {/* ─── IP制限ブロック ─── */}
        {step === 'blocked' && (
          <div className="bg-white rounded-2xl shadow-2xl p-8 text-center space-y-4">
            <div className="text-5xl">🔒</div>
            <h2 className="font-semibold text-gray-800">アクセスできません</h2>
            <p className="text-sm text-gray-500">
              この端末からは打刻できません。<br/>
              院内のネットワークから接続してください。
            </p>
            <p className="text-xs text-gray-400">
              設定が必要な場合は院長にお問い合わせください
            </p>
          </div>
        )}

        {/* ─── スタッフログイン ─── */}
        {step === 'staff_login' && (
          <div className="bg-white rounded-2xl shadow-2xl p-7 space-y-5">
            <div className="text-center">
              <div className="text-3xl mb-2">👤</div>
              <h2 className="font-semibold text-gray-800">スタッフIDでログイン</h2>
              <p className="text-xs text-gray-400 mt-1">自分のIDとパスワードを入力してください</p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="label">メールアドレス（ID）</label>
                <input
                  type="email"
                  className="input"
                  value={staffEmail}
                  onChange={e => setStaffEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && staffLogin()}
                  placeholder="your@clinic.jp"
                  autoFocus
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="label">パスワード</label>
                <input
                  type="password"
                  className="input"
                  value={staffPassword}
                  onChange={e => setStaffPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && staffLogin()}
                  placeholder="••••••••"
                  autoComplete="off"
                />
              </div>
              {loginError && (
                <p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">{loginError}</p>
              )}
            </div>

            <button
              onClick={staffLogin}
              disabled={saving}
              className="btn-primary w-full h-12 text-base"
            >
              {saving ? '確認中...' : 'ログイン'}
            </button>
          </div>
        )}

        {/* ─── 打刻アクション ─── */}
        {step === 'clock_action' && staffSession && (
          <div className="bg-white rounded-2xl shadow-2xl p-7 space-y-5">
            {/* スタッフ情報 */}
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-clinic-100 text-clinic-700 font-bold text-2xl flex items-center justify-center mx-auto mb-2">
                {staffSession.name[0]}
              </div>
              <h2 className="font-semibold text-gray-800 text-lg">{staffSession.name} さん</h2>
            </div>

            {/* 本日状況 */}
            <div className="bg-gray-50 rounded-xl p-3 grid grid-cols-2 gap-2 text-center text-sm">
              <div>
                <div className="text-xs text-gray-400">出勤</div>
                <div className="font-semibold">{formatTime(staffSession.record?.clock_in)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-400">退勤</div>
                <div className="font-semibold">{formatTime(staffSession.record?.clock_out)}</div>
              </div>
            </div>

            {/* シフト */}
            {staffSession.blocks.length > 0 && (
              <div className="text-xs text-gray-500 text-center space-y-0.5">
                {staffSession.blocks.map((b, i) => (
                  <div key={i}>
                    {b.label && <span className="text-gray-400 mr-1">{b.label}</span>}
                    {b.start_time.slice(0,5)}〜{b.end_time.slice(0,5)}
                  </div>
                ))}
                <div className="text-clinic-600 font-medium mt-1">
                  所定 {formatMinutes(calcScheduledMinutes(staffSession.blocks))}
                </div>
              </div>
            )}

            {/* 既に完了 */}
            {staffSession.record?.clock_out && (
              <div className="text-center text-sm text-clinic-600 bg-clinic-50 rounded-xl py-4">
                本日の打刻は完了しています
              </div>
            )}

            {/* 出勤ボタン */}
            {canClockIn && !showReasonSelect && (
              <button
                onClick={doClockin}
                disabled={saving}
                className="w-full py-5 rounded-xl bg-clinic-600 text-white font-bold text-xl hover:bg-clinic-700 active:scale-95 transition-all shadow-lg shadow-clinic-200 btn-clock"
              >
                🟢 出勤
              </button>
            )}

            {/* 退勤ボタン */}
            {canClockOut && !showReasonSelect && (
              <button
                onClick={() => setShowReasonSelect(true)}
                disabled={saving}
                className="w-full py-5 rounded-xl bg-red-500 text-white font-bold text-xl hover:bg-red-600 active:scale-95 transition-all shadow-lg shadow-red-100"
              >
                🔴 退勤
              </button>
            )}

            {/* 退勤理由選択 */}
            {canClockOut && showReasonSelect && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500 text-center font-medium">退勤理由を選択してください</p>
                {([
                  { value: 'normal' as const,       label: '通常退勤',           icon: '✅' },
                  { value: 'early_finish' as const,  label: '業務完了（早上がり）', icon: '🏃' },
                  { value: 'early_leave' as const,   label: '早退（体調不良・私用）', icon: '🤒' },
                ]).map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setClockOutReason(opt.value)}
                    className={`w-full text-left rounded-xl px-4 py-3 border-2 text-sm transition-all
                      ${clockOutReason === opt.value
                        ? 'border-clinic-500 bg-clinic-50'
                        : 'border-gray-200 hover:border-gray-300'}`}
                  >
                    {opt.icon} {opt.label}
                    {clockOutReason === opt.value && (
                      <span className="float-right text-clinic-500">✓</span>
                    )}
                  </button>
                ))}
                <div className="flex gap-2 pt-1">
                  <button onClick={() => setShowReasonSelect(false)} className="btn-secondary flex-1 text-sm">
                    戻る
                  </button>
                  <button onClick={doClockout} disabled={saving} className="btn-primary flex-1 text-sm">
                    {saving ? '打刻中...' : '退勤確定'}
                  </button>
                </div>
              </div>
            )}

            <button
              onClick={resetAll}
              className="w-full text-xs text-gray-400 hover:text-gray-600 py-2"
            >
              キャンセル
            </button>
          </div>
        )}

        {/* ─── 完了 ─── */}
        {step === 'done' && (
          <div className="bg-white rounded-2xl shadow-2xl p-8 text-center space-y-4">
            <div className="text-6xl">
              {resultMessage.includes('エラー') ? '❌' : '✅'}
            </div>
            <p className="text-gray-800 font-medium text-lg whitespace-pre-line leading-relaxed">
              {resultMessage}
            </p>
            <p className="text-xs text-gray-400">5秒後に自動リセットします</p>
            <button onClick={resetAll} className="btn-primary w-full">
              次のスタッフへ
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
