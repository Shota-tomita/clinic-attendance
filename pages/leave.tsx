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
    min_consecutive_days: 3, buffer_days: 2, closed_weekdays: [0], include_holidays: true,
  })

  // 通常有給フォーム
  const [paidForm, setPaidForm] = useState({
    start_date: '', end_date: '', reason: '',
    is_half_day: false, half_day_type: 'am' as 'am' | 'pm',
  })
  const [deptWarning, setDeptWarning] = useState<string[] | null>(null)
  const [lowBalanceWarning, setLowBalanceWarning] = useState(false)
  const [isSpecialPeriod, setIsSpecialPeriod] = useState(false)

  // 病欠フォーム
  const [sickForm, setSickForm] = useState({
    date: todayString(), use_paid: false, has_certificate: false, dept_has_leave: false,
  })

  // 特別休暇フォーム
  const [specialForm, setSpecialForm] = useState({
    special_leave_type: 'condolence', start_date: '', end_date: '', note: '',
  })

  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [consentingId, setConsentingId] = useState<string | null>(null)

  const canReview = isAdmin || isLeader
  const remaining = (profile?.annual_leave_days ?? 0) - (profile?.used_leave_days ?? 0)

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [user, loading])

  useEffect(() => {
    if (user && profile) { fetchRequests(); fetchHolidaySettings() }
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
      const { data: deptStaff } = await supabase.from('profiles').select('id').eq('department_id', profile?.department_id)
      const ids = deptStaff?.map(s => s.id) ?? []
      q = q.in('user_id', ids)
    }
    const { data } = await q
    setRequests(data ?? [])
  }

  const calcDays = (start: string, end: string): number => {
    if (!start || !end) return 0
    let count = 0
    let cur = parseISO(start)
    const endDate = parseISO(end)
    while (cur <= endDate) {
      const dow = cur.getDay()
      if (dow !== 0) count++
      cur = addDays(cur, 1)
    }
    return count
  }

  // 半日の場合は0.5日、そうでなければ通常計算
  const paidDays = paidForm.is_half_day
    ? 0.5
    : calcDays(paidForm.start_date, paidForm.end_date)

  const checkWarnings = async (start: string, end: string) => {
    if (!start || !end || !user) return
    setLowBalanceWarning(paidDays > remaining)
    const { data } = await supabase.rpc('check_dept_group_approved_leave', {
      p_user_id: user.id, p_date: start,
    })
    if (data && data[0]?.has_approved) setDeptWarning(data[0].approved_names ?? [])
    else setDeptWarning(null)
    const special = await hasSpecialPeriodInRange(start, end, holidaySettings)
    setIsSpecialPeriod(special)
  }

  const checkSickDeptLeave = async (date: string) => {
    if (!user) return
    const { data } = await supabase.rpc('check_dept_group_approved_leave', {
      p_user_id: user.id, p_date: date,
    })
    setSickForm(f => ({ ...f, dept_has_leave: data?.[0]?.has_approved ?? false }))
  }

  const submitPaidLeave = async () => {
    if (!paidForm.start_date) { setError('日付を入力してください'); return }
    if (!paidForm.is_half_day && !paidForm.end_date) { setError('終了日を入力してください'); return }
    if (!paidForm.is_half_day && paidDays <= 0) { setError('終了日は開始日以降にしてください'); return }

    const today = new Date()
    const startDate = parseISO(paidForm.start_date)
    if (differenceInCalendarDays(startDate, today) < 1) {
      setError('有給申請は前日までに行ってください'); return
    }

    setSaving(true)
    const endDate = paidForm.is_half_day ? paidForm.start_date : paidForm.end_date
    const category = isSpecialPeriod ? 'special_holiday' : 'normal'

    const { error: err } = await supabase.from('leave_requests').insert({
      user_id: user?.id,
      leave_type: 'paid_leave',
      leave_category: category,
      start_date: paidForm.start_date,
      end_date: endDate,
      days_count: paidDays,
      reason: paidForm.reason || null,
      status: 'pending',
      is_half_day: paidForm.is_half_day,
      half_day_type: paidForm.is_half_day ? paidForm.half_day_type : null,
      special_flow_status: category === 'special_holiday' ? 'pending' : 'none',
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    setShowForm(false)
    setPaidForm({ start_date: '', end_date: '', reason: '', is_half_day: false, half_day_type: 'am' })
    setDeptWarning(null)
    setIsSpecialPeriod(false)
    fetchRequests()
  }

  const submitSickLeave = async () => {
    setSaving(true)
    const { error: err } = await supabase.from('leave_requests').insert({
      user_id: user?.id,
      leave_type: sickForm.use_paid ? 'paid_leave' : 'sick_leave',
      leave_category: sickForm.use_paid ? 'sick_to_paid' : 'normal',
      start_date: sickForm.date, end_date: sickForm.date, days_count: 1,
      status: sickForm.use_paid && sickForm.dept_has_leave ? 'pending' : sickForm.use_paid ? 'pending' : 'approved',
      sick_has_certificate: sickForm.has_certificate,
      sick_dept_has_approved_leave: sickForm.dept_has_leave,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    setShowForm(false)
    fetchRequests()
  }

  const submitSpecialLeave = async () => {
    if (!specialForm.start_date) { setError('日付を入力してください'); return }
    if (specialForm.special_leave_type === 'other' && !specialForm.note.trim()) {
      setError('理由を入力してください'); return
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

  // ── ヘルパー：申請対象日を列挙（日曜除外） ──────────────────
  const getBusinessDates = (startDate: string, endDate: string): string[] => {
    const dates: string[] = []
    let cur = parseISO(startDate)
    const end = parseISO(endDate)
    while (cur <= end) {
      if (cur.getDay() !== 0) dates.push(format(cur, 'yyyy-MM-dd'))
      cur = addDays(cur, 1)
    }
    return dates
  }

  // ── 有給承認時：attendance_records に paid_leave を upsert ──
  const upsertLeaveRecords = async (req: LeaveWithProfile) => {
    if (req.leave_type !== 'paid_leave') return
    const isHalfDay = (req as any).is_half_day === true
    const halfDayType: 'am' | 'pm' = (req as any).half_day_type ?? 'am'
    const dates = getBusinessDates(req.start_date, req.end_date)

    for (const date of dates) {
      const { data: existing } = await supabase
        .from('attendance_records')
        .select('id')
        .eq('user_id', req.user_id)
        .eq('date', date)
        .maybeSingle()

      if (isHalfDay) {
        const updateFields: any = {
          status: 'paid_leave',
          note: `半日有給（${halfDayType === 'am' ? '午前' : '午後'}）`,
          ...(halfDayType === 'am' ? { am_leave: true } : { pm_leave: true }),
        }
        if (existing) {
          await supabase.from('attendance_records').update(updateFields).eq('id', existing.id)
        } else {
          await supabase.from('attendance_records').insert({
            user_id: req.user_id, date,
            status: 'paid_leave', clock_out_reason: 'normal',
            early_finish_status: 'not_required',
            break_minutes: 0, scheduled_minutes: 0, actual_minutes: 0,
            overtime_minutes: 0, deduction_minutes: 0,
            late_minutes: 0, early_leave_minutes: 0,
            ...updateFields,
          })
        }
      } else {
        if (existing) {
          await supabase.from('attendance_records').update({
            status: 'paid_leave',
            am_clock_in: null, am_clock_out: null,
            pm_clock_in: null, pm_clock_out: null,
            clock_in: null, clock_out: null,
            am_leave: false, pm_leave: false,
            note: '有給休暇',
          }).eq('id', existing.id)
        } else {
          await supabase.from('attendance_records').insert({
            user_id: req.user_id, date,
            status: 'paid_leave', clock_out_reason: 'normal',
            early_finish_status: 'not_required',
            break_minutes: 0, scheduled_minutes: 0, actual_minutes: 0,
            overtime_minutes: 0, deduction_minutes: 0,
            late_minutes: 0, early_leave_minutes: 0,
            note: '有給休暇',
          })
        }
      }
    }
  }

  // ── 有給取り消し時：attendance_records を欠勤に戻す ──────────
  const revertLeaveRecords = async (req: LeaveWithProfile) => {
    if (req.leave_type !== 'paid_leave') return
    const dates = getBusinessDates(req.start_date, req.end_date)
    for (const date of dates) {
      const { data: existing } = await supabase
        .from('attendance_records')
        .select('id')
        .eq('user_id', req.user_id)
        .eq('date', date)
        .maybeSingle()
      if (existing) {
        await supabase.from('attendance_records').update({
          status: 'absent',
          am_leave: false, pm_leave: false,
          note: '有給取消',
        }).eq('id', existing.id)
      }
    }
  }

  const handleApprove = async (req: LeaveWithProfile) => {
    if (!user) return
    setSaving(true)

    await supabase.from('leave_requests').update({
      status: 'approved', reviewed_by: user.id,
    }).eq('id', req.id)

    // 勤怠記録を paid_leave で自動作成・更新
    await upsertLeaveRecords(req)

    // used_leave_days をインクリメント
    if (req.leave_type === 'paid_leave') {
      const { data: p } = await supabase
        .from('profiles').select('used_leave_days').eq('id', req.user_id).single()
      await supabase.from('profiles').update({
        used_leave_days: (p?.used_leave_days ?? 0) + req.days_count,
      }).eq('id', req.user_id)
    }

    setSaving(false)
    setReviewingId(null)
    fetchRequests()
  }

  const handleReject = async (id: string) => {
    if (!user) return
    // 却下前に申請内容を取得（承認済みだった場合の巻き戻し用）
    const req = requests.find(r => r.id === id)
    await supabase.from('leave_requests').update({
      status: 'rejected', reviewed_by: user.id,
    }).eq('id', id)

    // 承認済みを却下した場合のみ勤怠・残日数を巻き戻し
    if (req && req.status === 'approved') {
      await revertLeaveRecords(req)
      if (req.leave_type === 'paid_leave') {
        const { data: p } = await supabase
          .from('profiles').select('used_leave_days').eq('id', req.user_id).single()
        await supabase.from('profiles').update({
          used_leave_days: Math.max((p?.used_leave_days ?? 0) - req.days_count, 0),
        }).eq('id', req.user_id)
      }
    }

    setReviewingId(null)
    fetchRequests()
  }

  const handleCancellationConsent = async (id: string) => {
    await supabase.from('leave_requests').update({
      cancellation_consent: true, cancellation_consent_at: new Date().toISOString(),
    }).eq('id', id)
    setConsentingId(null)
    fetchRequests()
  }

  const handleCancelApproval = async (req: LeaveWithProfile) => {
    if (!req.cancellation_consent) {
      alert('スタッフの同意が必要です。')
      return
    }
    await supabase.from('leave_requests').update({
      status: 'rejected', cancellation_consent: false,
    }).eq('id', req.id)

    // 勤怠記録を欠勤に戻す
    await revertLeaveRecords(req)

    // used_leave_days を戻す
    if (req.leave_type === 'paid_leave') {
      const { data: p } = await supabase
        .from('profiles').select('used_leave_days').eq('id', req.user_id).single()
      await supabase.from('profiles').update({
        used_leave_days: Math.max((p?.used_leave_days ?? 0) - req.days_count, 0),
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

        {/* 有給残高 */}
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

        {/* タブ */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
          {([['paid','有給休暇'],['sick','病欠'],['special','特別休暇']] as const).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all
                ${tab === t ? 'bg-white text-clinic-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {label}
            </button>
          ))}
        </div>

        {/* 申請一覧 */}
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
                         (r as any).is_half_day ? `🌿 半日有給（${(r as any).half_day_type === 'am' ? '午前' : '午後'}）` :
                         '🌿 有給休暇'}
                      </span>
                      <span className="text-xs text-gray-400">{r.days_count}日間</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">{r.start_date} 〜 {r.end_date}</div>
                    {r.special_leave_note && <div className="text-xs text-gray-400 mt-0.5">備考: {r.special_leave_note}</div>}
                    {r.sick_dept_has_approved_leave && <div className="text-xs text-amber-600 mt-0.5">⚠️ 当日同部署に有給あり</div>}
                    {r.special_flow_status === 'pending' && <div className="text-xs text-blue-600 mt-0.5">⭐ 優先順位フロー処理中</div>}
                    {!canReview && r.status === 'approved' && !r.cancellation_consent && (
                      <button onClick={() => setConsentingId(r.id)} className="text-xs text-gray-400 hover:text-red-500 mt-1 underline">
                        承認取り消しに同意する
                      </button>
                    )}
                    {r.cancellation_consent && <div className="text-xs text-orange-500 mt-0.5">⚠️ 取り消し同意済み</div>}
                  </div>
                  <div className="flex items-start gap-2 flex-shrink-0 flex-col">
                    <span className={`badge ${leaveStatusColor(r.status)}`}>{leaveStatusLabel(r.status)}</span>
                    {canReview && r.status === 'pending' && (
                      <button onClick={() => setReviewingId(r.id)} className="btn-secondary text-xs px-2 py-1">審査</button>
                    )}
                    {canReview && r.status === 'approved' && (
                      <button
                        onClick={() => handleCancelApproval(r)}
                        className={`text-xs px-2 py-1 rounded ${r.cancellation_consent ? 'bg-red-100 text-red-600 hover:bg-red-200' : 'text-gray-300 cursor-not-allowed'}`}
                        disabled={!r.cancellation_consent}>
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

      {/* 申請フォーム */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/40 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5 my-8">
            <h2 className="font-semibold text-gray-800">休暇申請</h2>

            <div className="flex gap-1 bg-gray-100 p-1 rounded-xl text-sm">
              {([['paid','有給'],['sick','病欠'],['special','特別休暇']] as const).map(([t, label]) => (
                <button key={t} onClick={() => setTab(t)}
                  className={`flex-1 py-1.5 rounded-lg font-medium transition-all
                    ${tab === t ? 'bg-white text-clinic-700 shadow-sm' : 'text-gray-500'}`}>
                  {label}
                </button>
              ))}
            </div>

            {/* 有給フォーム */}
            {tab === 'paid' && (
              <div className="space-y-4">
                {/* 全日・半日選択 */}
                <div>
                  <label className="label">取得区分</label>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      [false, '全日有給'],
                      [true, '半日有給'],
                    ] as const).map(([val, label]) => (
                      <button key={String(val)}
                        onClick={() => setPaidForm(f => ({ ...f, is_half_day: val }))}
                        className={`py-2.5 rounded-xl text-sm font-medium border-2 transition-all
                          ${paidForm.is_half_day === val
                            ? 'border-clinic-500 bg-clinic-50 text-clinic-700'
                            : 'border-gray-200 text-gray-500'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 半日の場合：午前・午後選択 */}
                {paidForm.is_half_day && (
                  <div>
                    <label className="label">午前・午後</label>
                    <div className="grid grid-cols-2 gap-2">
                      {([['am','午前有給'],['pm','午後有給']] as const).map(([val, label]) => (
                        <button key={val}
                          onClick={() => setPaidForm(f => ({ ...f, half_day_type: val }))}
                          className={`py-2.5 rounded-xl text-sm font-medium border-2 transition-all
                            ${paidForm.half_day_type === val
                              ? 'border-clinic-500 bg-clinic-50 text-clinic-700'
                              : 'border-gray-200 text-gray-500'}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 日付 */}
                {paidForm.is_half_day ? (
                  <div>
                    <label className="label">日付</label>
                    <input type="date" className="input"
                      value={paidForm.start_date}
                      onChange={e => {
                        setPaidForm(f => ({ ...f, start_date: e.target.value, end_date: e.target.value }))
                        checkWarnings(e.target.value, e.target.value)
                      }} />
                  </div>
                ) : (
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
                )}

                {paidDays > 0 && (
                  <div className="bg-clinic-50 rounded-lg px-3 py-2 text-sm text-clinic-700">
                    取得日数: <strong>{paidDays}日</strong>（有給残: {remaining}日）
                  </div>
                )}

                {isSpecialPeriod && (
                  <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-xs text-blue-700">
                    ⭐ この期間は連休前後の特別申請期間です。
                  </div>
                )}
                {deptWarning && deptWarning.length > 0 && (
                  <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-xs text-amber-700">
                    ⚠️ 同グループの <strong>{deptWarning.join('、')}さん</strong> が同日に承認済みの有給があります。
                  </div>
                )}
                {lowBalanceWarning && (
                  <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-600">
                    ⚠️ 有給残日数（{remaining}日）を超えています。
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

            {/* 病欠フォーム */}
            {tab === 'sick' && (
              <div className="space-y-4">
                <div>
                  <label className="label">日付</label>
                  <input type="date" className="input" value={sickForm.date}
                    onChange={e => { setSickForm(f => ({ ...f, date: e.target.value })); checkSickDeptLeave(e.target.value) }} />
                </div>
                {sickForm.dept_has_leave && (
                  <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-xs text-amber-700">
                    ⚠️ 当日、同グループに有給取得者がいます。有給として申請する場合、病院受診の証明書が必要です。
                  </div>
                )}
                <div>
                  <label className="label">この日を有給として申請しますか？</label>
                  <div className="space-y-2 mt-1">
                    <button onClick={() => setSickForm(f => ({ ...f, use_paid: true }))}
                      className={`w-full text-left rounded-xl px-4 py-3 border-2 text-sm transition-all
                        ${sickForm.use_paid ? 'border-clinic-500 bg-clinic-50' : 'border-gray-200 hover:border-gray-300'}`}>
                      🌿 有給として申請する
                      {sickForm.dept_has_leave && <span className="ml-2 text-xs text-amber-600">（証明書要・事後承認）</span>}
                    </button>
                    <button onClick={() => setSickForm(f => ({ ...f, use_paid: false }))}
                      className={`w-full text-left rounded-xl px-4 py-3 border-2 text-sm transition-all
                        ${!sickForm.use_paid ? 'border-clinic-500 bg-clinic-50' : 'border-gray-200 hover:border-gray-300'}`}>
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

            {/* 特別休暇フォーム */}
            {tab === 'special' && (
              <div className="space-y-4">
                <div>
                  <label className="label">休暇種別</label>
                  <select className="select" value={specialForm.special_leave_type}
                    onChange={e => setSpecialForm(f => ({ ...f, special_leave_type: e.target.value }))}>
                    {SPECIAL_LEAVE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">開始日</label>
                    <input type="date" className="input" value={specialForm.start_date}
                      onChange={e => setSpecialForm(f => ({ ...f, start_date: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">終了日</label>
                    <input type="date" className="input" value={specialForm.end_date}
                      onChange={e => setSpecialForm(f => ({ ...f, end_date: e.target.value }))} />
                  </div>
                </div>
                {specialForm.special_leave_type === 'other' && (
                  <div>
                    <label className="label">理由 <span className="text-red-400">*</span></label>
                    <textarea className="input resize-none" rows={2} value={specialForm.note}
                      onChange={e => setSpecialForm(f => ({ ...f, note: e.target.value }))}
                      placeholder="休暇の理由を入力してください" />
                  </div>
                )}
                {specialForm.special_leave_type !== 'other' && (
                  <div>
                    <label className="label">備考（任意）</label>
                    <input className="input" value={specialForm.note}
                      onChange={e => setSpecialForm(f => ({ ...f, note: e.target.value }))} placeholder="補足があれば" />
                  </div>
                )}
              </div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex gap-3 pt-1">
              <button onClick={() => { setShowForm(false); setError('') }} className="btn-secondary flex-1">キャンセル</button>
              <button
                onClick={tab === 'paid' ? submitPaidLeave : tab === 'sick' ? submitSickLeave : submitSpecialLeave}
                disabled={saving} className="btn-primary flex-1">
                {saving ? '申請中...' : '申請する'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 審査モーダル */}
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
                    {(req as any).is_half_day && (
                      <div className="text-clinic-600">🌿 半日有給（{(req as any).half_day_type === 'am' ? '午前' : '午後'}）</div>
                    )}
                    {req.leave_category === 'special_holiday' && <div className="text-blue-600">⭐ 連休前後特別有給</div>}
                    {req.sick_dept_has_approved_leave && <div className="text-amber-600">⚠️ 当日同グループに有給あり</div>}
                    {req.sick_has_certificate && <div className="text-emerald-600">✅ 証明書提出予定</div>}
                    {req.special_leave_note && <div><span className="text-gray-500">理由:</span> {req.special_leave_note}</div>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setReviewingId(null)} className="btn-secondary flex-1 text-sm">閉じる</button>
                    <button onClick={() => handleReject(req.id)} disabled={saving} className="btn-danger flex-1 text-sm">{saving ? '処理中...' : '却下'}</button>
                    <button onClick={() => handleApprove(req)} disabled={saving} className="btn-primary flex-1 text-sm">{saving ? '処理中...' : '承認'}</button>
                  </div>
                </>
              )
            })()}
          </div>
        </div>
      )}

      {/* 同意モーダル */}
      {consentingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="font-semibold text-gray-800">承認取り消しへの同意</h2>
            <p className="text-sm text-gray-600">承認済みの有給を取り消すことに同意しますか？</p>
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
