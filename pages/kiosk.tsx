import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { todayString, formatMinutes } from '@/lib/utils'
import { format, differenceInMinutes, parseISO } from 'date-fns'
import { ja } from 'date-fns/locale'

type Step = 'staff_login' | 'blocked' | 'clock_action' | 'done'

type ShiftBlock = {
  sort_order: number
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
      const { data } = await supabase.from('kiosk_settings').select('allowed_ips')
        .order('created_at', { ascending: false }).limit(1).single()
      const allowed: string[] = data?.allowed_ips ?? []
      if (allowed.length > 0 && !allowed.includes(ip)) setStep('blocked')
    } catch {
      // ネットワークエラーは通す
    }
  }

  const resetAll = () => {
    setStep('staff_login')
    setStaffEmail('')
    setStaffPassword('')
    setLoginError('')
    setStaffSession(null)
    setResultMessage('')
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

  const hasAmShift = (blocks: ShiftBlock[]) => blocks.length === 0 || blocks.some(b => b.sort_order === 0)
  const hasPmShift = (blocks: ShiftBlock[]) => blocks.length === 0 || blocks.some(b => b.sort_order === 1)

  const getPhase = (session: StaffSession): 'am_in' | 'am_out' | 'pm_in' | 'pm_out' | 'done' => {
    const r = session.record
    if (!r || (!r.am_clock_in && !r.am_leave)) return 'am_in'
    if (r.am_clock_in && !r.am_clock_out && hasAmShift(session.blocks) && hasPmShift(session.blocks)) return 'am_out'
    if ((r.am_clock_out || r.am_leave) && !r.pm_clock_in && hasPmShift(session.blocks)) return 'pm_in'
    if (r.pm_clock_in && !r.pm_clock_out) return 'pm_out'
    if (r.am_clock_in && !r.am_clock_out && !hasPmShift(session.blocks)) return 'pm_out'
    return 'done'
  }

  const calcEarlyMinutes = (session: StaffSession, clockOutISO: string, isAm: boolean): number => {
    const today = todayString()
    const block = isAm
      ? session.blocks.find(b => b.sort_order === 0)
      : session.blocks[session.blocks.length - 1]
    if (!block) return 0
    const [eh, em] = block.end_time.split(':').map(Number)
    const scheduledEnd = new Date(`${today}T${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}:00`)
    return Math.max(differenceInMinutes(scheduledEnd, parseISO(clockOutISO)), 0)
  }

  const doClock = async (isEarlyLeave: boolean = false) => {
    if (!staffSession || saving) return
    const phase = getPhase(staffSession)
    if (phase === 'done') return

    setSaving(true)
    const nowISO = new Date().toISOString()
    const today = todayString()

    if (phase === 'am_in') {
      const { data } = await supabase.from('attendance_records').insert({
        user_id: staffSession.id,
        date: today,
        am_clock_in: nowISO,
        clock_in: nowISO,
        status: 'present',
        clock_out_reason: 'normal',
        early_finish_status: 'not_required',
      }).select().single()
      setStaffSession(s => s ? { ...s, record: data } : s)
      setResultMessage(`${staffSession.name} さん、出勤しました ✅`)
    } else if (phase === 'pm_in') {
      await supabase.from('attendance_records').update({ pm_clock_in: nowISO }).eq('id', staffSession.record.id)
      setResultMessage(`${staffSession.name} さん、午後出勤しました ✅`)
    } else if (phase === 'am_out' || phase === 'pm_out') {
      const isAm = phase === 'am_out'
      const update: any = {}

      if (isEarlyLeave) {
        if (isAm) update.am_clock_out = nowISO
        else { update.pm_clock_out = nowISO; update.clock_out = nowISO }
        update.status = 'early_leave'
        update.clock_out_reason = 'early_leave'
        update.early_finish_status = 'not_required'
        setResultMessage(`${staffSession.name} さん、早退しました`)
      } else {
        if (isAm) update.am_clock_out = nowISO
        else { update.pm_clock_out = nowISO; update.clock_out = nowISO }
        update.clock_out_reason = 'normal'

        const earlyMin = calcEarlyMinutes(staffSession, nowISO, isAm)
        if (earlyMin > 0) {
          update.early_finish_status = 'pending'
          update.status = 'present'
        } else {
          update.early_finish_status = 'not_required'
          update.status = 'present'
        }
        setResultMessage(`${staffSession.name} さん、${isAm ? '午前退勤' : '退勤'}しました ✅`)
      }
      await supabase.from('attendance_records').update(update).eq('id', staffSession.record.id)
    }

    setSaving(false)
    setStep('done')
  }

  const phase = staffSession ? getPhase(staffSession) : null
  const isClockOut = phase === 'am_out' || phase === 'pm_out'

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
            {phase === 'done' && (
              <div className="text-center text-sm text-clinic-600 bg-clinic-50 rounded-xl py-4">
                本日の打刻は完了しています
              </div>
            )}

            {/* 出勤・午後出勤ボタン */}
            {(phase === 'am_in' || phase === 'pm_in') && (
              <button onClick={() => doClock(false)} disabled={saving}
                className="w-full py-5 rounded-xl text-white font-bold text-xl active:scale-95 transition-all shadow-lg bg-emerald-500">
                {saving ? '打刻中...' : phase === 'am_in' ? '🟢 出勤' : '🟢 午後出勤'}
              </button>
            )}

            {/* 退勤・早退ボタン */}
            {isClockOut && (
              <div className="space-y-3">
                <button onClick={() => doClock(false)} disabled={saving}
                  className="w-full py-4 rounded-xl text-white font-bold text-xl active:scale-95 transition-all shadow-lg bg-red-500">
                  {saving ? '打刻中...' : phase === 'am_out' ? '🔴 午前退勤' : '🔴 退勤'}
                </button>
                <button onClick={() => doClock(true)} disabled={saving}
                  className="w-full py-4 rounded-xl text-white font-bold text-xl active:scale-95 transition-all shadow-lg bg-orange-400">
                  {saving ? '打刻中...' : phase === 'am_out' ? '🟠 午前早退' : '🟠 早退'}
                </button>
              </div>
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
