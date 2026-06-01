import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { todayString, formatTime, formatMinutes, calcScheduledMinutes } from '@/lib/utils'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'

type Step = 'blocked' | 'staff_login' | 'clock_action' | 'done'

type ShiftBlock = {
  sort_order: number
  label: string
  start_time: string
  end_time: string
}

type StaffSession = {
  id: string
  name: string
  record: any | null
  blocks: ShiftBlock[]
}

export default function KioskPage() {
  const [step, setStep] = useState<Step>('staff_login')
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

  useEffect(() => { checkIp() }, [])

  useEffect(() => {
    if (step === 'done') {
      const t = setTimeout(resetAll, 5000)
      return () => clearTimeout(t)
    }
  }, [step])

  const checkIp = async () => {
    try {
      const res = await fetch('https://api.ipify.org?format=json')
      const { ip } = await res.json()
      const { data } = await supabase
        .from('kiosk_settings')
        .select('allowed_ips')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      const allowed: string[] = data?.allowed_ips ?? []
      if (allowed.length === 0) { setStep('staff_login'); return }
      if (!allowed.includes(ip)) setStep('blocked')
    } catch {
      setStep('staff_login')
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
    if (!staffEmail || !staffPassword) { setLoginError('IDとパスワードを入力してください'); return }
    setSaving(true)
    setLoginError('')

    const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
      email: staffEmail, password: staffPassword,
    })
    if (authErr || !authData.user) { setLoginError('IDまたはパスワードが違います'); setSaving(false); return }

    const { data: profile } = await supabase.from('profiles').select('*').eq('id', authData.user.id).single()
    if (!profile) { setLoginError('スタッフ情報が見つかりません'); setSaving(false); return }

    const { data: record } = await supabase.from('attendance_records').select('*')
      .eq('user_id', authData.user.id).eq('date', todayString()).single()

    const { data: shift } = await supabase.from('shift_assignments')
      .select('*, shift_patterns(*, shift_pattern_blocks(*))')
      .eq('user_id', authData.user.id).eq('date', todayString()).single()

    const blocks: ShiftBlock[] = shift?.shift_patterns?.shift_pattern_blocks
      ? [...shift.shift_patterns.shift_pattern_blocks].sort((a: ShiftBlock, b: ShiftBlock) => a.sort_order - b.sort_order)
      : []

    setStaffSession({ id: authData.user.id, name: profile.name, record, blocks })
    setSaving(false)
    setStep('clock_action')
    await supabase.auth.signOut()
  }

  // シフトブロックから午前・午後を判定（未登録の場合は両方あるとみなす）
  const hasAmShift = (blocks: ShiftBlock[]) => blocks.length === 0 || blocks.some(b => b.sort_order === 0)
  const hasPmShift = (blocks: ShiftBlock[]) => blocks.length === 0 || blocks.some(b => b.sort_order === 1)

  // 次のアクションを判定
  const getNextAction = (session: StaffSession): { label: string; type: string | null; color: string } => {
    const r = session.record
    const hasPm = hasPmShift(session.blocks)
    const hasAm = hasAmShift(session.blocks)

    if (!r || (!r.am_clock_in && !r.am_leave)) {
      return { label: '出勤', type: 'am_in', color: 'bg-emerald-500' }
    }
    if (r.am_clock_in && !r.am_clock_out && hasAm && hasPm) {
      return { label: '午前退勤', type: 'am_out', color: 'bg-amber-500' }
    }
    if ((r.am_clock_out || r.am_leave) && !r.pm_clock_in && hasPm) {
      return { label: '午後出勤', type: 'pm_in', color: 'bg-emerald-500' }
    }
    if (r.pm_clock_in && !r.pm_clock_out) {
      return { label: '退勤', type: 'pm_out', color: 'bg-red-500' }
    }
    if (r.am_clock_in && !r.am_clock_out && !hasPm) {
      return { label: '退勤', type: 'am_out', color: 'bg-red-500' }
    }
    return { label: '打刻済み', type: null, color: 'bg-gray-400' }
  }

  const doClock = async () => {
    if (!staffSession || saving) return
    const action = getNextAction(staffSession)
    if (!action.type) return

    // 退勤系は理由選択が必要
    if ((action.type === 'am_out' || action.type === 'pm_out') && !showReasonSelect) {
      setShowReasonSelect(true)
      return
    }

    setSaving(true)
    const nowIso = new Date().toISOString()
    const today = todayString()

    if (!staffSession.record) {
      const { data } = await supabase.from('attendance_records').insert({
        user_id: staffSession.id,
        date: today,
        am_clock_in: nowIso,
        clock_in: nowIso,
        status: 'present',
        clock_out_reason: 'normal',
        early_finish_status: 'not_required',
      }).select().single()
      setStaffSession(s => s ? { ...s, record: data } : s)
    } else {
      const update: any = {}
      if (action.type === 'am_in') { update.am_clock_in = nowIso; update.clock_in = nowIso }
      if (action.type === 'am_out') { update.am_clock_out = nowIso; update.clock_out_reason = clockOutReason }
      if (action.type === 'pm_in') update.pm_clock_in = nowIso
      if (action.type === 'pm_out') {
        update.pm_clock_out = nowIso
        update.clock_out = nowIso
        update.clock_out_reason = clockOutReason
      }
      await supabase.from('attendance_records').update(update).eq('id', staffSession.record.id)
    }

    setSaving(false)
    setShowReasonSelect(false)

    const actionLabels: Record<string, string> = {
      am_in: '出勤しました ✅',
      am_out: '午前退勤しました ✅',
      pm_in: '午後出勤しました ✅',
      pm_out: '退勤しました ✅',
    }
    setResultMessage(`${staffSession.name} さん、${actionLabels[action.type]}`)
    setStep('done')
  }

  const nextAction = staffSession ? getNextAction(staffSession) : null
  const isClockOut = nextAction?.type === 'am_out' || nextAction?.type === 'pm_out'

  return (
    <div className="min-h-screen bg-gradient-to-br from-clinic-900 to-clinic-700 flex flex-col items-center justify-center p-6">
      <div className="text-center mb-8">
        <div className="text-5xl mb-2">🏥</div>
        <h1 className="text-2xl font-bold text-white">出退勤打刻</h1>
        <p className="text-clinic-200 text-sm mt-1">
          {format(now, 'yyyy年M月d日(EEE) HH:mm:ss', { locale: ja })}
        </p>
      </div>

      <div className="w-full max-w-sm">
        {/* IP制限ブロック */}
        {step === 'blocked' && (
          <div className="bg-white rounded-2xl shadow-2xl p-8 text-center space-y-4">
            <div className="text-5xl">🔒</div>
            <h2 className="font-semibold text-gray-800">アクセスできません</h2>
            <p className="text-sm text-gray-500">院内のネットワークから接続してください。</p>
          </div>
        )}

        {/* スタッフログイン */}
        {step === 'staff_login' && (
          <div className="bg-white rounded-2xl shadow-2xl p-7 space-y-5">
            <div className="text-center">
              <div className="text-3xl mb-2">👤</div>
              <h2 className="font-semibold text-gray-800">スタッフIDでログイン</h2>
            </div>
            <div className="space-y-3">
              <div>
                <label className="label">メールアドレス（ID）</label>
                <input type="email" className="input" value={staffEmail}
                  onChange={e => setStaffEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && staffLogin()}
                  placeholder="your@clinic.local" autoFocus autoComplete="off" />
              </div>
              <div>
                <label className="label">パスワード</label>
                <input type="password" className="input" value={staffPassword}
                  onChange={e => setStaffPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && staffLogin()}
                  placeholder="••••••••" autoComplete="off" />
              </div>
              {loginError && <p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">{loginError}</p>}
            </div>
            <button onClick={staffLogin} disabled={saving} className="btn-primary w-full h-12 text-base">
              {saving ? '確認中...' : 'ログイン'}
            </button>
          </div>
        )}

        {/* 打刻アクション */}
        {step === 'clock_action' && staffSession && (
          <div className="bg-white rounded-2xl shadow-2xl p-7 space-y-5">
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-clinic-100 text-clinic-700 font-bold text-2xl flex items-center justify-center mx-auto mb-2">
                {staffSession.name[0]}
              </div>
              <h2 className="font-semibold text-gray-800 text-lg">{staffSession.name} さん</h2>
            </div>

            {/* 打刻状況 */}
            <div className="grid grid-cols-2 gap-2 text-center text-sm">
              {[
                { label: '午前出勤', value: staffSession.record?.am_clock_in, color: 'text-emerald-600' },
                { label: '午前退勤', value: staffSession.record?.am_clock_out, color: 'text-amber-600' },
                { label: '午後出勤', value: staffSession.record?.pm_clock_in, color: 'text-emerald-600' },
                { label: '午後退勤', value: staffSession.record?.pm_clock_out, color: 'text-red-500' },
              ].map(item => (
                <div key={item.label} className="bg-gray-50 rounded-xl p-2.5">
                  <div className="text-xs text-gray-400">{item.label}</div>
                  <div className={`font-semibold ${item.value ? item.color : 'text-gray-300'}`}>
                    {item.value ? format(new Date(item.value), 'HH:mm') : '--:--'}
                  </div>
                </div>
              ))}
            </div>

            {/* シフト */}
            {staffSession.blocks.length > 0 && (
              <div className="text-xs text-gray-500 text-center space-y-0.5">
                {staffSession.blocks.map((b, i) => (
                  <div key={i}>{b.sort_order === 0 ? '午前' : '午後'} {b.start_time.slice(0,5)}〜{b.end_time.slice(0,5)}</div>
                ))}
              </div>
            )}

            {/* 打刻済み */}
            {!nextAction?.type && (
              <div className="text-center text-sm text-clinic-600 bg-clinic-50 rounded-xl py-4">
                本日の打刻は完了しています
              </div>
            )}

            {/* 退勤理由選択 */}
            {showReasonSelect && isClockOut && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500 text-center font-medium">退勤理由を選択してください</p>
                {([
                  { value: 'normal' as const, label: '通常退勤', icon: '✅' },
                  { value: 'early_finish' as const, label: '業務完了（早上がり）', icon: '🏃' },
                  { value: 'early_leave' as const, label: '早退（体調不良・私用）', icon: '🤒' },
                ]).map(opt => (
                  <button key={opt.value} onClick={() => setClockOutReason(opt.value)}
                    className={`w-full text-left rounded-xl px-4 py-3 border-2 text-sm transition-all
                      ${clockOutReason === opt.value ? 'border-clinic-500 bg-clinic-50' : 'border-gray-200 hover:border-gray-300'}`}>
                    {opt.icon} {opt.label}
                    {clockOutReason === opt.value && <span className="float-right text-clinic-500">✓</span>}
                  </button>
                ))}
                <div className="flex gap-2 pt-1">
                  <button onClick={() => setShowReasonSelect(false)} className="btn-secondary flex-1 text-sm">戻る</button>
                  <button onClick={doClock} disabled={saving} className="btn-primary flex-1 text-sm">
                    {saving ? '打刻中...' : '確定'}
                  </button>
                </div>
              </div>
            )}

            {/* 打刻ボタン */}
            {nextAction?.type && !showReasonSelect && (
              <button onClick={doClock} disabled={saving}
                className={`w-full py-5 rounded-xl text-white font-bold text-xl active:scale-95 transition-all shadow-lg ${nextAction.color}`}>
                {saving ? '打刻中...' : nextAction.label}
              </button>
            )}

            <button onClick={resetAll} className="w-full text-xs text-gray-400 hover:text-gray-600 py-2">
              キャンセル
            </button>
          </div>
        )}

        {/* 完了 */}
        {step === 'done' && (
          <div className="bg-white rounded-2xl shadow-2xl p-8 text-center space-y-4">
            <div className="text-6xl">{resultMessage.includes('エラー') ? '❌' : '✅'}</div>
            <p className="text-gray-800 font-medium text-lg whitespace-pre-line">{resultMessage}</p>
            <p className="text-xs text-gray-400">5秒後に自動リセットします</p>
            <button onClick={resetAll} className="btn-primary w-full">次のスタッフへ</button>
          </div>
        )}
      </div>
    </div>
  )
}
