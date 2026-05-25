import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/lib/auth'
import { supabase, LeaveRequest, Profile } from '@/lib/supabase'
import { leaveTypeLabel, leaveStatusLabel, leaveStatusColor, todayString } from '@/lib/utils'
import { hasSpecialPeriodInRange, HolidaySettings } from '@/lib/holidays'
import { addDays, format, parseISO, differenceInCalendarDays } from 'date-fns'

const SPECIAL_LEAVE_TYPES = [
  { value: 'condolence', label: '慶弔休暇' },
  { value: 'bereavement', label: '忌引休暇' },
  { value: 'maternity', label: '産前産後休暇' },
  { value: 'paternity', label: '育児休暇' },
  { value: 'moving', label: '引越し休暇' },
  { value: 'other', label: 'その他（自由記述）' },
]

type LeaveWithProfile = LeaveRequest & { profiles?: Profile }

export default function LeavePage() {
  const { user, profile, loading, isAdmin, isLeader } = useAuth()
  const router = useRouter()

  const [requests, setRequests] = useState<LeaveWithProfile[]>([])
  const [tab, setTab] = useState<'paid' | 'sick' | 'special'>('paid')
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [holidaySettings, setHolidaySettings] = useState<HolidaySettings>({
    min_consecutive_days: 3, buffer_days: 2, closed_weekdays: [0, 4], include_holidays: true,
  })

  // 通常有給フォーム
  const [paidForm, setPaidForm] = useState({ start_date: '', end_date: '', reason: '' })
  const [deptWarning, setDeptWarning] = useState<string[] | null>(null)
  const [lowBalanceWarning, setLowBalanceWarning] = useState(false)
  const [isSpecialPeriod, setIsSpecialPeriod] = useState(false)

  // 病欠フォーム
  const [sickForm, setSickForm] = useState({
    date: todayString(),
    use_paid: false,
    has_certificate: false,
    dept_has_leave: false,
  })

  // 特別休暇フォーム
  const [specialForm, setSpecialForm] = useState({
    special_leave_type: 'condolence',
    start_date: '',
    end_date: '',
    note: '',
  })

  // 承認関連
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [consentingId, setConsentingId] = useState<string | null>(null)

  const canReview = isAdmin || isLeader
  const remaining = (profile?.annual_leave_days ?? 0) - (profile?.used_leave_days ?? 0)

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [user, loading])

  useEffect(() => {
    if (user && profile) {
      fetchRequests()
      fetchHolidaySettings()
    }
  }, [user, profile])

  const fetchHolidaySettings = async () => {
    const { data } = await supabase.from('holiday_settings').select('*').single()
    if (data) setHolidaySettings(data)
  }

  const fetchRequests = async () => {
    let q = supabase.from('leave_requests')
      .select('*, profiles(name, email, department_id)')
      .order('created_at', { ascending: false })

    if (!canReview) {
      q = q.eq('user_id', user?.id)
    } else if (isLeader && !isAdmin) {
      const { data: deptStaff } = await supabase
        .from('profiles').select('id').eq('department_id', profile?.department_id)
      const ids = deptStaff?.map(s => s.id) ?? []
      q = q.in('user_id', ids)
    }
    const { data } = await q
    setRequests(data ?? [])
  }

  // 日数計算（平日のみ）
  const calcDays = (start: string, end: string): number => {
    if (!start || !end) return 0
    let count = 0
    let cur = parseISO(start)
    const endDate = parseISO(end)
    while (cur <= endDate) {
      const dow = cur.getDay()
      if (![0, 4].includes(dow)) count++  // 定休日除外
      cur = addDays(cur, 1)
    }
    return count
  }

  const paidDays = calcDays(paidForm.start_date, paidForm.end_date)

  // 日付変更時の警告チェック
  const checkWarnings = async (start: string, end: string) => {
    if (!start || !end || !user) return
    // 残有給チェック
    setLowBalanceWarning(paidDays > remaining)
    // 同部署承認済みチェック
    const { data } = await supabase.rpc('check_dept_group_approved_leave', {
      p_user_id: user.id,
      p_date: start,
    })
    if (data && data[0]?.has_approved) {
      setDeptWarning(data[0].approved_names ?? [])
    } else {
      setDeptWarning(null)
    }
    // 連休特別期間チェック
    const special = await hasSpecialPeriodInRange(start, end, holidaySettings)
    setIsSpecialPeriod(special)
  }

  // 病欠時の自部署有給チェック
  const checkSickDeptLeave = async (date: string) => {
    if (!user) return
    const { data } = await supabase.rpc('check_dept_group_approved_leave', {
      p_user_id: user.id,
      p_date: date,
    })
    setSickForm(f => ({ ...f, dept_has_leave: data?.[0]?.has_approved ?? false }))
  }

  // 通常有給申請
  const submitPaidLeave = async () => {
    if (!paidForm.start_date || !paidForm.end_date) { setError('期間を入力してください'); return }
    if (paidDays <= 0) { setError('終了日は開始日以降にしてください'); return }

    // 前日までチェック
    const today = new Date()
    const startDate = parseISO(paidForm.start_date)
    if (differenceInCalendarDays(startDate, today) < 1) {
      setError('有給申請は前日までに行ってください')
      return
    }

    setSaving(true)
    const category = isSpecialPeriod ? 'special_holiday' : 'normal'

    const { error: err } = await supabase.from('leave_requests').insert({
      user_id: user?.id,
      leave_type: 'paid_leave',
      leave_category: category,
      start_date: paidForm.start_date,
      end_date: paidForm.end_date,
      days_count: paidDays,
      reason: paidForm.reason || null,
      status: 'pending',
      special_flow_status: category === 'special_holiday' ? 'pending' : 'none',
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    setShowForm(false)
    setPaidForm({ start_date: '', end_date: '', reason: '' })
    setDeptWarning(null)
    setIsSpecialPeriod(false)
    fetchRequests()
  }

  // 病欠→有給申請
  const submitSickLeave = async () => {
    setSaving(true)
    const { error: err } = await supabase.from('leave_requests').insert({
      user_id: user?.id,
      leave_type: sickForm.use_paid ? 'paid_leave' : 'sick_leave',
      leave_category: sickForm.use_paid ? 'sick_to_paid' : 'normal',
      start_date: sickForm.date,
      end_date: sickForm.date,
      days_count: 1,
      status: sickForm.use_paid && sickForm.dept_has_leave ? 'pending' : sickForm.use_paid ? 'pending' : 'approved',
      sick_has_certificate: sickForm.has_certificate,
      sick_dept_has_approved_leave: sickForm.dept_has_leave,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    setShowForm(false)
    fetchRequests()
  }

  // 特別休暇申請
  const submitSpecialLeave = async () => {
    if (!specialForm.start_date) { setError('日付を入力してください'); return }
    if (specialForm.special_leave_type === 'other' && !specialForm.note.trim()) {
      setError('理由を入力してください')
      return
    }
    setSaving(true)
    const { error: err } = await supabase.from('leave_requests').insert({
      user_id: user?.id,
      leave_type: 'special_leave',
      leave_category: 'special',
      start_date: specialForm.start_date,
      end_date: specialForm.end_date || specialForm.start_date,
      days_count: calcDays(specialForm.start_date, specialForm.end_date || specialForm.start_date) || 1,
      special_leave_type: specialForm.special_leave_type,
      special_leave_note: specialForm.note || null,
      status: 'pending',
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    setShowForm(false)
    fetchRequests()
  }

  // 承認
  const handleApprove = async (req: LeaveWithProfile) => {
    if (!user) return
    // 承認済み有給が既にある場合は警告のみ（承認可能）
    await supabase.from('leave_requests').update({
      status: 'approved',
      reviewed_by: user.id,
    }).eq('id', req.id)

    // 有給の場合は残日数を減算
    if (req.leave_type === 'paid_leave') {
      const { data: p } = await supabase.from('profiles').select('used_leave_days').eq('id', req.user_id).single()
      await supabase.from('profiles').update({
        used_leave_days: (p?.used_leave_days ?? 0) + req.days_count
      }).eq('id', req.user_id)
    }
    setReviewingId(null)
    fetchRequests()
  }

  // 却下
  const handleReject = async (id: string) => {
    await supabase.from('leave_requests').update({
      status: 'rejected',
      reviewed_by: user?.id,
    }).eq('id', id)
    setReviewingId(null)
    fetchRequests()
  }

  // 承認取り消し同意（スタッフ本人が押す）
  const handleCancellationConsent = async (id: string) => {
    await supabase.from('leave_requests').update({
      cancellation_consent: true,
      cancellation_consent_at: new Date().toISOString(),
    }).eq('id', id)
    setConsentingId(null)
    fetchRequests()
  }

  // 承認取り消し（スタッフ同意後に院長/リーダーが実行）
  const handleCancelApproval = async (req: LeaveWithProfile) => {
    if (!req.cancellation_consent) {
      alert('スタッフの同意が必要です。スタッフに取り消し同意を依頼してください。')
      return
    }
    await supabase.from('leave_requests').update({
      status: 'rejected',
      cancellation_consent: false,
    }).eq('id', req.id)
    // 有給残日数を戻す
    if (req.leave_type === 'paid_leave') {
      const { data: p } = await supabase.from('profiles').select('used_leave_days').eq('id', req.user_id).single()
      await supabase.from('profiles').update({
        used_leave_days: Math.max((p?.used_leave_days ?? 0) - req.days_count, 0)
      }).eq('id', req.user_id)
    }
    fetchRequests()
  }

  const filteredRequests = requests.filter(r => {
    if (tab === 'paid') return ['paid_leave'].includes(r.leave_type)
    if (tab === 'sick') return r.leave_type === 'sick_leave' || r.leave_category === 'sick_to_paid'
    if (tab === 'special') return r.leave_category === 'special'
    return true
  })

  if (loading || !profile) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-4xl animate-pulse">🏥</div>
    </div>
  )

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">🌿 休暇申請</h1>
          <button onClick={() => { setShowForm(true); setError('') }} className="btn-primary text-sm">
            ＋ 新規申請
          </button>
        </div>

        {/* Balance */}
        <div className="card grid grid-cols-3 gap-3 text-center py-4">
          <div>
            <div className="text-2xl font-bold text-gray-800">{profile.annual_leave_days}</div>
            <div className="text-xs text-gray-500">付与日数</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-amber-600">{profile.used_leave_days}</div>
            <div className="text-xs text-gray-500">取得済</div>
          </div>
          <div>
            <div className={`text-2xl font-bold ${remaining <= 3 ? 'text-red-500' : 'text-clinic-600'}`}>{remaining}</div>
            <div className="text-xs text-gray-500">残日数</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
          {([['paid','有給休暇'],['sick','病欠'],['special','特別休暇']] as const).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all
                ${tab === t ? 'bg-white text-clinic-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {label}
            </button>
          ))}
        </div>

        {/* Request list */}
        <div className="card p-0 overflow-hidden">
          <div className="divide-y divide-gray-50">
            {filteredRequests.length === 0 ? (
              <div className="text-center py-10 text-gray-400 text-sm">申請がありません</div>
            ) : filteredRequests.map(r => (
              <div key={r.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    {canReview && r.profiles && (
                      <div className="text-xs text-gray-500 font-medium mb-0.5">{r.profiles.name}</div>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-800">
                        {r.leave_category === 'special_holiday' ? '⭐ 連休前後有給' :
                         r.leave_category === 'sick_to_paid' ? '🏥 病欠→有給' :
                         r.leave_category === 'special' ? `📋 ${SPECIAL_LEAVE_TYPES.find(t => t.value === r.special_leave_type)?.label ?? '特別休暇'}` :
                         '🌿 有給休暇'}
                      </span>
                      <span className="text-xs text-gray-400">{r.days_count}日間</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">{r.start_date} 〜 {r.end_date}</div>
                    {r.special_leave_note && (
                      <div className="text-xs text-gray-400 mt-0.5">備考: {r.special_leave_note}</div>
                    )}
                    {r.sick_dept_has_approved_leave && (
                      <div className="text-xs text-amber-600 mt-0.5">⚠️ 当日同部署に有給あり（証明書要確認）</div>
                    )}
                    {r.special_flow_status === 'pending' && (
                      <div className="text-xs text-blue-600 mt-0.5">⭐ 優先順位フロー処理中</div>
                    )}
                    {/* 取り消し同意ボタン（スタッフ本人・承認済みの場合） */}
                    {!canReview && r.status === 'approved' && !r.cancellation_consent && (
                      <button
                        onClick={() => setConsentingId(r.id)}
                        className="text-xs text-gray-400 hover:text-red-500 mt-1 underline"
                      >
                        承認取り消しに同意する
                      </button>
                    )}
                    {r.cancellation_consent && (
                      <div className="text-xs text-orange-500 mt-0.5">⚠️ 取り消し同意済み</div>
                    )}
                  </div>
                  <div className="flex items-start gap-2 flex-shrink-0 flex-col">
                    <span className={`badge ${leaveStatusColor(r.status)}`}>{leaveStatusLabel(r.status)}</span>
                    {canReview && r.status === 'pending' && (
                      <button onClick={() => setReviewingId(r.id)} className="btn-secondary text-xs px-2 py-1">
                        審査
                      </button>
                    )}
                    {canReview && r.status === 'approved' && (
                      <button
                        onClick={() => handleCancelApproval(r)}
                        className={`text-xs px-2 py-1 rounded
                          ${r.cancellation_consent
                            ? 'bg-red-100 text-red-600 hover:bg-red-200'
                            : 'text-gray-300 cursor-not-allowed'}`}
                        disabled={!r.cancellation_consent}
                        title={!r.cancellation_consent ? 'スタッフの同意が必要です' : ''}
                      >
                        取消
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ─── New request modal ─── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/40 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5 my-8">
            <h2 className="font-semibold text-gray-800">休暇申請</h2>

            {/* Tab select */}
            <div className="flex gap-1 bg-gray-100 p-1 rounded-xl text-sm">
              {([['paid','有給'],['sick','病欠'],['special','特別休暇']] as const).map(([t, label]) => (
                <button key={t} onClick={() => setTab(t)}
                  className={`flex-1 py-1.5 rounded-lg font-medium transition-all
                    ${tab === t ? 'bg-white text-clinic-700 shadow-sm' : 'text-gray-500'}`}>
                  {label}
                </button>
              ))}
            </div>

            {/* ─ 有給フォーム ─ */}
            {tab === 'paid' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">開始日</label>
                    <input type="date" className="input"
                      value={paidForm.start_date}
                      onChange={e => {
                        setPaidForm(f => ({ ...f, start_date: e.target.value }))
                        checkWarnings(e.target.value, paidForm.end_date)
                      }} />
                  </div>
                  <div>
                    <label className="label">終了日</label>
                    <input type="date" className="input"
                      value={paidForm.end_date}
                      onChange={e => {
                        setPaidForm(f => ({ ...f, end_date: e.target.value }))
                        checkWarnings(paidForm.start_date, e.target.value)
                      }} />
                  </div>
                </div>

                {paidDays > 0 && (
                  <div className="bg-clinic-50 rounded-lg px-3 py-2 text-sm text-clinic-700">
                    取得日数: <strong>{paidDays}日</strong>（有給残: {remaining}日）
                  </div>
                )}

                {/* Warnings */}
                {isSpecialPeriod && (
                  <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-xs text-blue-700">
                    ⭐ この期間は連休前後の特別申請期間です。<br/>
                    部署グループ内の優先順位フローで処理されます。
                  </div>
                )}
                {deptWarning && deptWarning.length > 0 && (
                  <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-xs text-amber-700">
                    ⚠️ 同グループの <strong>{deptWarning.join('、')}さん</strong> が同日に承認済みの有給があります。<br/>
                    申請は可能ですが、リーダー判断になります。
                  </div>
                )}
                {lowBalanceWarning && (
                  <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-600">
                    ⚠️ 有給残日数（{remaining}日）を超えています。申請は可能ですが承認が必要です。
                  </div>
                )}

                <div>
                  <label className="label">理由（任意）</label>
                  <textarea className="input resize-none" rows={2}
                    value={paidForm.reason}
                    onChange={e => setPaidForm(f => ({ ...f, reason: e.target.value }))} />
                </div>
              </div>
            )}

            {/* ─ 病欠フォーム ─ */}
            {tab === 'sick' && (
              <div className="space-y-4">
                <div>
                  <label className="label">日付</label>
                  <input type="date" className="input"
                    value={sickForm.date}
                    onChange={e => {
                      setSickForm(f => ({ ...f, date: e.target.value }))
                      checkSickDeptLeave(e.target.value)
                    }} />
                </div>

                {sickForm.dept_has_leave && (
                  <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-xs text-amber-700">
                    ⚠️ 当日、同グループに有給取得者がいます。<br/>
                    有給として申請する場合、<strong>病院受診の証明書</strong>が必要です（事後承認）。
                  </div>
                )}

                <div>
                  <label className="label">この日を有給として申請しますか？</label>
                  <div className="space-y-2 mt-1">
                    <button
                      onClick={() => setSickForm(f => ({ ...f, use_paid: true }))}
                      className={`w-full text-left rounded-xl px-4 py-3 border-2 text-sm transition-all
                        ${sickForm.use_paid ? 'border-clinic-500 bg-clinic-50' : 'border-gray-200 hover:border-gray-300'}`}
                    >
                      🌿 有給として申請する
                      {sickForm.dept_has_leave && <span className="ml-2 text-xs text-amber-600">（証明書要・事後承認）</span>}
                    </button>
                    <button
                      onClick={() => setSickForm(f => ({ ...f, use_paid: false }))}
                      className={`w-full text-left rounded-xl px-4 py-3 border-2 text-sm transition-all
                        ${!sickForm.use_paid ? 'border-clinic-500 bg-clinic-50' : 'border-gray-200 hover:border-gray-300'}`}
                    >
                      📋 欠勤のまま（控除あり）
                    </button>
                  </div>
                </div>

                {sickForm.use_paid && sickForm.dept_has_leave && (
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="cert" checked={sickForm.has_certificate}
                      onChange={e => setSickForm(f => ({ ...f, has_certificate: e.target.checked }))}
                      className="w-4 h-4 accent-clinic-600" />
                    <label htmlFor="cert" className="text-sm text-gray-700">病院受診の証明書を提出予定</label>
                  </div>
                )}
              </div>
            )}

            {/* ─ 特別休暇フォーム ─ */}
            {tab === 'special' && (
              <div className="space-y-4">
                <div>
                  <label className="label">休暇種別</label>
                  <select className="select" value={specialForm.special_leave_type}
                    onChange={e => setSpecialForm(f => ({ ...f, special_leave_type: e.target.value }))}>
                    {SPECIAL_LEAVE_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">開始日</label>
                    <input type="date" className="input"
                      value={specialForm.start_date}
                      onChange={e => setSpecialForm(f => ({ ...f, start_date: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">終了日</label>
                    <input type="date" className="input"
                      value={specialForm.end_date}
                      onChange={e => setSpecialForm(f => ({ ...f, end_date: e.target.value }))} />
                  </div>
                </div>
                {specialForm.special_leave_type === 'other' && (
                  <div>
                    <label className="label">理由 <span className="text-red-400">*</span></label>
                    <textarea className="input resize-none" rows={2}
                      value={specialForm.note}
                      onChange={e => setSpecialForm(f => ({ ...f, note: e.target.value }))}
                      placeholder="休暇の理由を入力してください" />
                  </div>
                )}
                {specialForm.special_leave_type !== 'other' && (
                  <div>
                    <label className="label">備考（任意）</label>
                    <input className="input" value={specialForm.note}
                      onChange={e => setSpecialForm(f => ({ ...f, note: e.target.value }))}
                      placeholder="補足があれば" />
                  </div>
                )}
              </div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex gap-3 pt-1">
              <button onClick={() => { setShowForm(false); setError('') }} className="btn-secondary flex-1">
                キャンセル
              </button>
              <button
                onClick={tab === 'paid' ? submitPaidLeave : tab === 'sick' ? submitSickLeave : submitSpecialLeave}
                disabled={saving}
                className="btn-primary flex-1"
              >
                {saving ? '申請中...' : '申請する'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Review modal ─── */}
      {reviewingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            {(() => {
              const req = requests.find(r => r.id === reviewingId)!
              return (
                <>
                  <h2 className="font-semibold text-gray-800">申請審査</h2>
                  <div className="bg-gray-50 rounded-xl p-3 text-sm space-y-1.5">
                    <div><span className="text-gray-500">申請者:</span> {req.profiles?.name}</div>
                    <div><span className="text-gray-500">期間:</span> {req.start_date} 〜 {req.end_date}（{req.days_count}日）</div>
                    {req.leave_category === 'special_holiday' && (
                      <div className="text-blue-600">⭐ 連休前後特別有給</div>
                    )}
                    {req.sick_dept_has_approved_leave && (
                      <div className="text-amber-600">⚠️ 当日同グループに有給あり</div>
                    )}
                    {req.sick_has_certificate && (
                      <div className="text-emerald-600">✅ 証明書提出予定</div>
                    )}
                    {req.special_leave_note && (
                      <div><span className="text-gray-500">理由:</span> {req.special_leave_note}</div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setReviewingId(null)} className="btn-secondary flex-1 text-sm">閉じる</button>
                    <button onClick={() => handleReject(req.id)} className="btn-danger flex-1 text-sm">却下</button>
                    <button onClick={() => handleApprove(req)} className="btn-primary flex-1 text-sm">承認</button>
                  </div>
                </>
              )
            })()}
          </div>
        </div>
      )}

      {/* ─── Consent modal ─── */}
      {consentingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="font-semibold text-gray-800">承認取り消しへの同意</h2>
            <p className="text-sm text-gray-600">
              承認済みの有給を取り消すことに同意しますか？<br/>
              同意後、リーダーまたは院長が取り消し手続きを行います。
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConsentingId(null)} className="btn-secondary flex-1">キャンセル</button>
              <button onClick={() => handleCancellationConsent(consentingId)} className="btn-danger flex-1">同意する</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
