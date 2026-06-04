import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/lib/auth'
import { supabase, Profile, Department, Allowance, SalaryHistory } from '@/lib/supabase'
import { calcNextAccrualDate, calcGrantDays } from '@/lib/payroll'
import { differenceInMonths, differenceInYears, format, parseISO } from 'date-fns'
import { ja } from 'date-fns/locale'

const COMMUTE_LABELS = { train: '電車・バス', car: 'マイカー', bicycle: '自転車', none: 'なし' }

const ALLOWANCE_TYPE_LABELS: Record<string, string> = {
  position: '役職手当',
  skill: '技能手当',
  qualification: '資格手当',
  base_up: 'ベースアップ手当',
  custom: 'その他手当',
}

const RATE_TYPE_LABELS: Record<string, string> = {
  weekday_am: '平日午前',
  weekday_pm: '平日午後',
  saturday: '土曜',
  custom: '特定曜日',
}

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土']

export default function StaffDetailPage() {
  const { user, profile: myProfile, loading, isAdmin } = useAuth()
  const router = useRouter()
  const { id } = router.query

  const [staff, setStaff] = useState<Profile | null>(null)
  const [departments, setDepartments] = useState<Department[]>([])
  const [allowances, setAllowances] = useState<Allowance[]>([])
  const [salaryHistory, setSalaryHistory] = useState<SalaryHistory[]>([])
  const [partTimeRates, setPartTimeRates] = useState<any[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [activeTab, setActiveTab] = useState<'basic' | 'salary' | 'transport' | 'leave'>('basic')

  const [form, setForm] = useState({
    name: '', role: 'staff', department_id: '',
    employment_type: 'full_time',
    hire_date: '', weekly_scheduled_days: 5,
    base_salary: 0,
    pay_type: 'monthly',
    hourly_rate: 0,
    daily_rate: 0,
    is_exempt_from_leave_limit: false,
    commute_fee_type: 'monthly',
    commute_per_trip_fee: 0,
    commute_type: 'train',
    commute_distance_km: '',
    commute_car_rate_type: 'legal',
    commute_car_custom_rate: '',
    commute_monthly_fee: 0,
    annual_leave_days: 10,
    used_leave_days: 0,
    lineworks_user_id: '',
  })

  const [newAllowance, setNewAllowance] = useState({
    allowance_type: 'position',
    name: '役職手当',
    amount: 0,
    include_in_overtime: true,
    effective_from: format(new Date(), 'yyyy-MM-dd'),
  })
  const [showAllowanceForm, setShowAllowanceForm] = useState(false)
  const [showSalaryForm, setShowSalaryForm] = useState(false)
  const [newSalary, setNewSalary] = useState({
    effective_date: format(new Date(), 'yyyy-MM-dd'),
    base_salary: 0,
    change_reason: '',
  })

  // 時給設定フォーム
  const [showRateForm, setShowRateForm] = useState(false)
  const [supportFees, setSupportFees] = useState<any[]>([])
  const [showSupportFeeForm, setShowSupportFeeForm] = useState(false)
  const [newSupportFee, setNewSupportFee] = useState({ date: format(new Date(), 'yyyy-MM-dd'), amount: 0, note: '' })
  const [newRate, setNewRate] = useState({
    rate_type: 'weekday_am',
    day_of_week: 1,
    time_slot: 'am',
    hourly_rate: 0,
  })

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [user, loading])

  useEffect(() => {
    if (!loading && myProfile && !isAdmin) router.replace('/dashboard')
  }, [loading, myProfile, isAdmin])

  useEffect(() => {
    if (id && isAdmin) {
      fetchStaff()
      fetchDepts()
      fetchAllowances()
      fetchSalaryHistory()
      fetchPartTimeRates()
      fetchSupportFees()
    }
  }, [id, isAdmin])

  const fetchStaff = async () => {
    const { data } = await supabase.from('profiles').select('*, departments(*)').eq('id', id).single()
    if (data) {
      setStaff(data)
      setForm({
        name: data.name, role: data.role,
        department_id: data.department_id ?? '',
        employment_type: data.employment_type,
        hire_date: data.hire_date ?? '',
        weekly_scheduled_days: data.weekly_scheduled_days ?? 5,
        base_salary: data.base_salary ?? 0,
        pay_type: (data as any).pay_type ?? 'monthly',
        hourly_rate: (data as any).hourly_rate ?? 0,
        daily_rate: (data as any).daily_rate ?? 0,
        is_exempt_from_leave_limit: (data as any).is_exempt_from_leave_limit ?? false,
        commute_fee_type: (data as any).commute_fee_type ?? 'monthly',
    commute_per_trip_fee: (data as any).commute_per_trip_fee ?? 0,
    commute_type: data.commute_type ?? 'train',
        commute_distance_km: data.commute_distance_km ?? '',
        commute_car_rate_type: data.commute_car_rate_type ?? 'legal',
        commute_car_custom_rate: data.commute_car_custom_rate ?? '',
        commute_monthly_fee: data.commute_monthly_fee ?? 0,
        annual_leave_days: data.annual_leave_days,
        used_leave_days: data.used_leave_days,
        lineworks_user_id: data.lineworks_user_id ?? '',
      })
      setNewSalary(s => ({ ...s, base_salary: data.base_salary ?? 0 }))
    }
  }

  const fetchDepts = async () => {
    const { data } = await supabase.from('departments').select('*').order('name')
    setDepartments(data ?? [])
  }

  const fetchAllowances = async () => {
    const { data } = await supabase.from('allowances').select('*').eq('user_id', id)
      .is('effective_to', null).order('allowance_type')
    setAllowances(data ?? [])
  }

  const fetchSalaryHistory = async () => {
    const { data } = await supabase.from('salary_history').select('*').eq('user_id', id)
      .order('effective_date', { ascending: false })
    setSalaryHistory(data ?? [])
  }

  const fetchPartTimeRates = async () => {
    const { data } = await supabase.from('part_time_rates').select('*').eq('user_id', id)
      .order('rate_type')
    setPartTimeRates(data ?? [])
  }

  const fetchSupportFees = async () => {
    const { data } = await supabase.from('support_transport_fees').select('*')
      .eq('user_id', id).order('date', { ascending: false })
    setSupportFees(data ?? [])
  }

  const handleAddSupportFee = async () => {
    await supabase.from('support_transport_fees').insert({
      user_id: id,
      date: newSupportFee.date,
      amount: newSupportFee.amount,
      note: newSupportFee.note || null,
      created_by: user?.id,
    })
    setShowSupportFeeForm(false)
    setNewSupportFee({ date: format(new Date(), 'yyyy-MM-dd'), amount: 0, note: '' })
    fetchSupportFees()
  }

  const handleDeleteSupportFee = async (feeId: string) => {
    if (!confirm('この応援交通費を削除しますか？')) return
    await supabase.from('support_transport_fees').delete().eq('id', feeId)
    fetchSupportFees()
  }

  const handleSave = async () => {
    if (!staff) return
    setSaving(true)
    await supabase.from('profiles').update({
      name: form.name, role: form.role,
      department_id: form.department_id || null,
      employment_type: form.employment_type,
      hire_date: form.hire_date || null,
      weekly_scheduled_days: form.weekly_scheduled_days,
      base_salary: form.base_salary,
      pay_type: form.pay_type,
      hourly_rate: form.hourly_rate,
      daily_rate: form.daily_rate,
      is_exempt_from_leave_limit: form.is_exempt_from_leave_limit,
      commute_fee_type: (form as any).commute_fee_type,
      commute_per_trip_fee: (form as any).commute_per_trip_fee,
      commute_type: form.commute_type,
      commute_distance_km: form.commute_distance_km || null,
      commute_car_rate_type: form.commute_car_rate_type,
      commute_car_custom_rate: form.commute_car_custom_rate || null,
      commute_monthly_fee: form.commute_monthly_fee,
      annual_leave_days: form.annual_leave_days,
      used_leave_days: form.used_leave_days,
      lineworks_user_id: form.lineworks_user_id || null,
    }).eq('id', staff.id)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleAddAllowance = async () => {
    await supabase.from('allowances').insert({
      user_id: id, ...newAllowance, amount: Number(newAllowance.amount),
    })
    setShowAllowanceForm(false)
    fetchAllowances()
  }

  const handleDeleteAllowance = async (aid: string) => {
    if (!confirm('この手当を削除しますか？')) return
    await supabase.from('allowances').delete().eq('id', aid)
    fetchAllowances()
  }

  const handleSalaryChange = async () => {
    await supabase.from('salary_history').insert({
      user_id: id,
      effective_date: newSalary.effective_date,
      base_salary: newSalary.base_salary,
      previous_salary: form.base_salary,
      change_amount: newSalary.base_salary - form.base_salary,
      change_reason: newSalary.change_reason || null,
      created_by: user?.id,
    })
    await supabase.from('profiles').update({ base_salary: newSalary.base_salary }).eq('id', id)
    setForm(f => ({ ...f, base_salary: newSalary.base_salary }))
    setShowSalaryForm(false)
    fetchSalaryHistory()
  }

  const handleAddRate = async () => {
    const payload: any = {
      user_id: id,
      rate_type: newRate.rate_type,
      hourly_rate: Number(newRate.hourly_rate),
    }
    if (newRate.rate_type === 'custom') {
      payload.day_of_week = newRate.day_of_week
      payload.time_slot = newRate.time_slot
    }
    await supabase.from('part_time_rates').upsert(payload, {
      onConflict: 'user_id,rate_type,day_of_week,time_slot'
    })
    setShowRateForm(false)
    fetchPartTimeRates()
  }

  const handleDeleteRate = async (rateId: string) => {
    if (!confirm('この時給設定を削除しますか？')) return
    await supabase.from('part_time_rates').delete().eq('id', rateId)
    fetchPartTimeRates()
  }

  const totalAllowances = allowances.reduce((s, a) => s + a.amount, 0)
  const overtimeBase = form.base_salary + allowances.filter(a => a.include_in_overtime).reduce((s, a) => s + a.amount, 0)
  const monthlyTotal = form.base_salary + totalAllowances + form.commute_monthly_fee

  const monthsOfService = form.hire_date ? differenceInMonths(new Date(), parseISO(form.hire_date)) : null
  const yearsOfService = form.hire_date ? differenceInYears(new Date(), parseISO(form.hire_date)) : null
  const nextAccrualDate = form.hire_date ? calcNextAccrualDate(parseISO(form.hire_date)) : null
  const nextGrantDays = monthsOfService !== null ? calcGrantDays(monthsOfService, form.weekly_scheduled_days) : null

  const f = (key: string, val: any) => setForm(prev => ({ ...prev, [key]: val }))

  const getRateLabel = (r: any) => {
    if (r.rate_type === 'custom') {
      return `${DOW_LABELS[r.day_of_week]}曜${r.time_slot === 'am' ? '午前' : '午後'}`
    }
    return RATE_TYPE_LABELS[r.rate_type] ?? r.rate_type
  }

  if (loading || !myProfile) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-4xl animate-pulse">🏥</div>
    </div>
  )

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/staff')} className="text-gray-400 hover:text-gray-600 text-sm">
            ← スタッフ一覧
          </button>
          <h1 className="text-xl font-semibold text-gray-900">{staff?.name ?? '...'} の詳細</h1>
          {saved && <span className="text-xs text-emerald-600 ml-auto">✅ 保存しました</span>}
        </div>

        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl text-sm">
          {([['basic','基本情報'],['salary','給与・手当'],['transport','交通費'],['leave','有給']] as const).map(([t,l]) => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={`flex-1 py-2 rounded-lg font-medium transition-all
                ${activeTab === t ? 'bg-white text-clinic-700 shadow-sm' : 'text-gray-500'}`}>
              {l}
            </button>
          ))}
        </div>

        {/* 基本情報 */}
        {activeTab === 'basic' && (
          <div className="space-y-4">
            <div className="card space-y-4">
              <h2 className="text-sm font-semibold text-gray-700">👤 基本情報</h2>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">氏名</label>
                  <input className="input" value={form.name} onChange={e => f('name', e.target.value)} /></div>
                <div><label className="label">ロール</label>
                  <select className="select" value={form.role} onChange={e => f('role', e.target.value)}>
                    {[['admin','院長'],['leader','リーダー'],['staff','スタッフ']].map(([v,l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select></div>
                <div><label className="label">部署</label>
                  <select className="select" value={form.department_id} onChange={e => f('department_id', e.target.value)}>
                    <option value="">— 未設定 —</option>
                    {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select></div>
                <div><label className="label">雇用形態</label>
                  <select className="select" value={form.employment_type} onChange={e => f('employment_type', e.target.value)}>
                    <option value="full_time">正社員</option>
                    <option value="part_time">パート・アルバイト</option>
                  </select></div>
                <div><label className="label">入職日</label>
                  <input type="date" className="input" value={form.hire_date} onChange={e => f('hire_date', e.target.value)} /></div>
                <div><label className="label">週所定労働日数</label>
                  <select className="select" value={form.weekly_scheduled_days}
                    onChange={e => f('weekly_scheduled_days', Number(e.target.value))}>
                    {[5,4,3,2,1].map(d => <option key={d} value={d}>{d}日/週{d===5?' (常勤)':''}</option>)}
                  </select></div>
              </div>
              {form.hire_date && (
                <div className="bg-clinic-50 rounded-xl p-3 grid grid-cols-3 gap-2 text-center text-sm">
                  <div><div className="text-lg font-bold text-clinic-700">{yearsOfService}年</div><div className="text-xs text-gray-500">勤続年数</div></div>
                  <div><div className="text-sm font-bold text-gray-700">{nextAccrualDate ? format(nextAccrualDate, 'M/d', { locale: ja }) : '—'}</div><div className="text-xs text-gray-500">次回有給付与日</div></div>
                  <div><div className="text-lg font-bold text-emerald-600">{nextGrantDays ?? 0}日</div><div className="text-xs text-gray-500">次回付与予定</div></div>
                </div>
              )}
              <div><label className="label">LINE WORKSユーザーID</label>
                <input className="input" value={form.lineworks_user_id}
                  onChange={e => f('lineworks_user_id', e.target.value)} placeholder="user@workspace" /></div>
            </div>
            <button onClick={handleSave} disabled={saving} className="btn-primary w-full">
              {saving ? '保存中...' : '保存する'}
            </button>
          </div>
        )}

        {/* 給与・手当 */}
        {activeTab === 'salary' && (
          <div className="space-y-4">
            <div className="card space-y-4">
              <h2 className="text-sm font-semibold text-gray-700">💰 給与設定</h2>
              <div>
                <label className="label">給与形態</label>
                <div className="grid grid-cols-3 gap-2">
                  {([['monthly','月給'],['hourly','時給'],['daily','日給']] as const).map(([v,l]) => (
                    <button key={v} onClick={() => f('pay_type', v)}
                      className={`py-2 rounded-xl text-sm font-medium border-2 transition-all
                        ${form.pay_type === v ? 'border-clinic-500 bg-clinic-50 text-clinic-700' : 'border-gray-200 text-gray-500'}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              {form.pay_type === 'monthly' && (
                <div><label className="label">基本給（円）</label>
                  <input type="number" className="input" min={0} value={form.base_salary}
                    onChange={e => f('base_salary', Number(e.target.value))} /></div>
              )}
              {form.pay_type === 'hourly' && (
                <div><label className="label">基本時給（円）</label>
                  <input type="number" className="input" min={0} value={form.hourly_rate}
                    onChange={e => f('hourly_rate', Number(e.target.value))} /></div>
              )}
              {form.pay_type === 'daily' && (
                <div><label className="label">日給（円）</label>
                  <input type="number" className="input" min={0} value={form.daily_rate}
                    onChange={e => f('daily_rate', Number(e.target.value))} /></div>
              )}
              <div className="flex gap-3">
                <button onClick={handleSave} disabled={saving} className="btn-primary flex-1 text-sm">
                  {saving ? '保存中...' : '保存'}
                </button>
                {form.pay_type === 'monthly' && (
                  <button onClick={() => setShowSalaryForm(true)} className="btn-secondary text-sm px-4">昇給記録</button>
                )}
              </div>

              {/* 月次概算（月給の場合） */}
              {form.pay_type === 'monthly' && (
                <div className="bg-gray-50 rounded-xl p-3 space-y-1.5 text-sm">
                  <div className="font-medium text-gray-700 mb-2">月次支給概算</div>
                  <div className="flex justify-between"><span className="text-gray-500">基本給</span><span>¥{form.base_salary.toLocaleString()}</span></div>
                  {allowances.map(a => (
                    <div key={a.id} className="flex justify-between"><span className="text-gray-500">{a.name}</span><span>¥{a.amount.toLocaleString()}</span></div>
                  ))}
                  <div className="flex justify-between text-gray-400 text-xs"><span>交通費</span><span>¥{form.commute_monthly_fee.toLocaleString()}</span></div>
                  <div className="flex justify-between font-bold text-clinic-700 border-t border-gray-200 pt-1.5 mt-1">
                    <span>合計（概算）</span><span>¥{monthlyTotal.toLocaleString()}</span>
                  </div>
                  <div className="text-xs text-gray-400 mt-1">残業代計算基礎: ¥{overtimeBase.toLocaleString()}</div>
                </div>
              )}
            </div>

            {/* 時給設定（時給制スタッフ） */}
            {form.pay_type === 'hourly' && (
              <div className="card space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-gray-700">⏰ 時間帯別時給</h2>
                    <p className="text-xs text-gray-400 mt-0.5">基本時給と異なる時間帯の時給を設定</p>
                  </div>
                  <button onClick={() => setShowRateForm(true)} className="btn-primary text-xs px-3 py-1.5">＋ 追加</button>
                </div>

                {partTimeRates.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">
                    時間帯別設定なし（全て基本時給 ¥{form.hourly_rate.toLocaleString()}/h を適用）
                  </p>
                ) : (
                  <div className="space-y-2">
                    {partTimeRates.map(r => (
                      <div key={r.id} className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2.5">
                        <div>
                          <div className="text-sm font-medium text-gray-800">{getRateLabel(r)}</div>
                          <div className="text-xs text-gray-400">{RATE_TYPE_LABELS[r.rate_type] ?? r.rate_type}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-medium text-gray-700">¥{r.hourly_rate.toLocaleString()}/h</span>
                          <button onClick={() => handleDeleteRate(r.id)} className="text-xs text-red-400 hover:text-red-600">削除</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* 時給早見表 */}
                {partTimeRates.length > 0 && (
                  <div className="bg-blue-50 rounded-xl p-3 text-xs text-blue-700 space-y-1">
                    <div className="font-medium">適用される時給</div>
                    {['weekday_am','weekday_pm','saturday'].map(rt => {
                      const rate = partTimeRates.find(r => r.rate_type === rt)
                      return (
                        <div key={rt} className="flex justify-between">
                          <span>{RATE_TYPE_LABELS[rt]}</span>
                          <span>¥{(rate?.hourly_rate ?? form.hourly_rate).toLocaleString()}/h</span>
                        </div>
                      )
                    })}
                    {partTimeRates.filter(r => r.rate_type === 'custom').map(r => (
                      <div key={r.id} className="flex justify-between">
                        <span>{getRateLabel(r)}</span>
                        <span>¥{r.hourly_rate.toLocaleString()}/h</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 手当（月給の場合） */}
            {form.pay_type === 'monthly' && (
              <div className="card space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-700">各種手当</h2>
                  <button onClick={() => setShowAllowanceForm(true)} className="btn-primary text-xs px-3 py-1.5">＋ 追加</button>
                </div>
                {allowances.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">手当が設定されていません</p>
                ) : allowances.map(a => (
                  <div key={a.id} className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2.5">
                    <div>
                      <div className="text-sm font-medium text-gray-800">{a.name}</div>
                      <div className="text-xs text-gray-400">
                        {ALLOWANCE_TYPE_LABELS[a.allowance_type]}
                        {a.include_in_overtime && <span className="ml-1 text-clinic-500">・残業代対象</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-gray-700">¥{a.amount.toLocaleString()}</span>
                      <button onClick={() => handleDeleteAllowance(a.id)} className="text-xs text-red-400 hover:text-red-600">削除</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 給与改定履歴 */}
            {salaryHistory.length > 0 && (
              <div className="card space-y-3">
                <h2 className="text-sm font-semibold text-gray-700">給与改定履歴</h2>
                {salaryHistory.map(h => (
                  <div key={h.id} className="flex items-center justify-between text-sm py-1.5 border-b border-gray-50 last:border-0">
                    <div>
                      <div className="font-medium text-gray-700">{h.effective_date}</div>
                      <div className="text-xs text-gray-400">{h.change_reason ?? '—'}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium">¥{h.base_salary.toLocaleString()}</div>
                      {h.change_amount !== null && (
                        <div className={`text-xs ${h.change_amount >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {h.change_amount >= 0 ? '+' : ''}¥{h.change_amount.toLocaleString()}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 交通費 */}
        {activeTab === 'transport' && (
          <div className="space-y-4">
            <div className="card space-y-4">
              <h2 className="text-sm font-semibold text-gray-700">🚌 通勤交通費</h2>
              <div>
                <label className="label">交通費計算方式</label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    ['monthly', '月額固定'],
                    ['per_trip', '回数計算（円/回）'],
                  ] as const).map(([v, l]) => (
                    <button key={v} onClick={() => f('commute_fee_type', v)}
                      className={`py-2.5 rounded-xl text-sm font-medium border-2 transition-all
                        ${(form as any).commute_fee_type === v ? 'border-clinic-500 bg-clinic-50 text-clinic-700' : 'border-gray-200 text-gray-500'}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              {(form as any).commute_fee_type === 'per_trip' ? (
                <div className="space-y-3">
                  <div><label className="label">1回あたりの交通費（円）</label>
                    <input type="number" className="input" min={0} value={(form as any).commute_per_trip_fee ?? 0}
                      onChange={e => f('commute_per_trip_fee', Number(e.target.value))} />
                    <p className="text-xs text-gray-400 mt-1">月次データ出力時に出勤日数×単価で自動計算されます</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="label">通勤手段</label>
                    <div className="grid grid-cols-4 gap-2">
                      {(['train','car','bicycle','none'] as const).map(t => (
                        <button key={t} onClick={() => f('commute_type', t)}
                          className={`py-2.5 rounded-xl text-sm font-medium border-2 transition-all
                            ${form.commute_type === t ? 'border-clinic-500 bg-clinic-50 text-clinic-700' : 'border-gray-200 text-gray-500'}`}>
                          {t === 'train' ? '🚃' : t === 'car' ? '🚗' : t === 'bicycle' ? '🚲' : '❌'}
                          <div className="text-xs mt-0.5">{COMMUTE_LABELS[t]}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                  {form.commute_type === 'train' && (
                    <div><label className="label">月額定期代（円）</label>
                      <input type="number" className="input" min={0} value={form.commute_monthly_fee}
                        onChange={e => f('commute_monthly_fee', Number(e.target.value))} /></div>
                  )}
                  {form.commute_type === 'car' && (
                    <div className="space-y-3">
                      <div><label className="label">片道距離（km）</label>
                        <input type="number" className="input" min={0} step={0.1} value={form.commute_distance_km}
                          onChange={e => f('commute_distance_km', e.target.value)} /></div>
                      <div>
                        <label className="label">計算方法</label>
                        <div className="grid grid-cols-2 gap-2">
                          {(['legal','custom'] as const).map(t => (
                            <button key={t} onClick={() => f('commute_car_rate_type', t)}
                              className={`py-2 rounded-xl text-sm font-medium border-2 transition-all
                                ${form.commute_car_rate_type === t ? 'border-clinic-500 bg-clinic-50 text-clinic-700' : 'border-gray-200 text-gray-500'}`}>
                              {t === 'legal' ? '国税庁法定上限' : '独自単価（円/km）'}
                            </button>
                          ))}
                        </div>
                      </div>
                      {form.commute_car_rate_type === 'custom' && (
                        <div><label className="label">単価（円/km）</label>
                          <input type="number" className="input" min={0} value={form.commute_car_custom_rate}
                            onChange={e => f('commute_car_custom_rate', e.target.value)} /></div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 応援交通費 */}
            <div className="card space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-gray-700">🚌 応援交通費</h2>
                  <p className="text-xs text-gray-400 mt-0.5">他クリニックへの応援時の交通費を登録</p>
                </div>
                <button onClick={() => setShowSupportFeeForm(true)} className="btn-primary text-xs px-3 py-1.5">＋ 追加</button>
              </div>
              {supportFees.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-3">応援交通費の記録がありません</p>
              ) : (
                <div className="space-y-2">
                  {supportFees.map(fee => (
                    <div key={fee.id} className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2.5">
                      <div>
                        <div className="text-sm font-medium text-gray-800">{fee.date}</div>
                        {fee.note && <div className="text-xs text-gray-400">{fee.note}</div>}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-medium text-gray-700">¥{fee.amount.toLocaleString()}</span>
                        <button onClick={() => handleDeleteSupportFee(fee.id)}
                          className="text-xs text-red-400 hover:text-red-600">削除</button>
                      </div>
                    </div>
                  ))}
                  <div className="text-right text-sm font-medium text-clinic-700 pt-1">
                    合計: ¥{supportFees.reduce((s, f) => s + f.amount, 0).toLocaleString()}
                  </div>
                </div>
              )}
            </div>

            <button onClick={handleSave} disabled={saving} className="btn-primary w-full">
              {saving ? '保存中...' : '保存する'}
            </button>
          </div>
        )}

        {/* 有給 */}
        {activeTab === 'leave' && (
          <div className="space-y-4">
            <div className="card space-y-4">
              <h2 className="text-sm font-semibold text-gray-700">🌿 有給管理</h2>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="label">付与日数</label>
                  <input type="number" className="input" min={0} max={40} value={form.annual_leave_days}
                    onChange={e => f('annual_leave_days', Number(e.target.value))} /></div>
                <div><label className="label">取得済日数</label>
                  <input type="number" className="input" min={0} value={form.used_leave_days}
                    onChange={e => f('used_leave_days', Number(e.target.value))} /></div>
                <div><label className="label">残日数</label>
                  <div className={`input flex items-center font-bold ${form.annual_leave_days - form.used_leave_days <= 3 ? 'text-red-500' : 'text-clinic-600'}`}>
                    {form.annual_leave_days - form.used_leave_days}日
                  </div></div>
              </div>
              {form.employment_type === 'part_time' && (
                <div className="flex items-center justify-between bg-amber-50 rounded-xl px-4 py-3">
                  <div>
                    <div className="text-sm font-medium text-amber-800">有給重複制限から除外</div>
                    <div className="text-xs text-amber-600">ONにするとパート同士の同日有給を無制限に許可</div>
                  </div>
                  <button
                    onClick={() => f('is_exempt_from_leave_limit', !form.is_exempt_from_leave_limit)}
                    className={`relative w-11 h-6 rounded-full transition-colors ${form.is_exempt_from_leave_limit ? 'bg-amber-500' : 'bg-gray-300'}`}>
                    <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.is_exempt_from_leave_limit ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </div>
              )}
            </div>
            <button onClick={handleSave} disabled={saving} className="btn-primary w-full">
              {saving ? '保存中...' : '保存する'}
            </button>
          </div>
        )}
      </div>

      {/* 時給追加モーダル */}
      {showRateForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="font-semibold text-gray-800">時間帯別時給を追加</h2>
            <div>
              <label className="label">区分</label>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(RATE_TYPE_LABELS).map(([v, l]) => (
                  <button key={v} onClick={() => setNewRate(r => ({ ...r, rate_type: v }))}
                    className={`py-2 rounded-xl text-sm font-medium border-2 transition-all
                      ${newRate.rate_type === v ? 'border-clinic-500 bg-clinic-50 text-clinic-700' : 'border-gray-200 text-gray-500'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            {newRate.rate_type === 'custom' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">曜日</label>
                  <select className="select" value={newRate.day_of_week}
                    onChange={e => setNewRate(r => ({ ...r, day_of_week: Number(e.target.value) }))}>
                    {DOW_LABELS.map((l, i) => <option key={i} value={i}>{l}曜日</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">時間帯</label>
                  <select className="select" value={newRate.time_slot}
                    onChange={e => setNewRate(r => ({ ...r, time_slot: e.target.value }))}>
                    <option value="am">午前</option>
                    <option value="pm">午後</option>
                  </select>
                </div>
              </div>
            )}
            <div>
              <label className="label">時給（円）</label>
              <input type="number" className="input" min={0} value={newRate.hourly_rate}
                onChange={e => setNewRate(r => ({ ...r, hourly_rate: Number(e.target.value) }))} />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowRateForm(false)} className="btn-secondary flex-1">キャンセル</button>
              <button onClick={handleAddRate} className="btn-primary flex-1">追加</button>
            </div>
          </div>
        </div>
      )}

      {/* 手当追加モーダル */}
      {showAllowanceForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="font-semibold text-gray-800">手当を追加</h2>
            <div>
              <label className="label">手当種別</label>
              <select className="select" value={newAllowance.allowance_type}
                onChange={e => {
                  const type = e.target.value
                  setNewAllowance(a => ({ ...a, allowance_type: type, name: type === 'custom' ? '' : ALLOWANCE_TYPE_LABELS[type] }))
                }}>
                {Object.entries(ALLOWANCE_TYPE_LABELS).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            {newAllowance.allowance_type === 'custom' && (
              <div><label className="label">手当名</label>
                <input className="input" value={newAllowance.name}
                  onChange={e => setNewAllowance(a => ({ ...a, name: e.target.value }))} placeholder="例: 住宅手当" /></div>
            )}
            <div><label className="label">月額（円）</label>
              <input type="number" className="input" min={0} value={newAllowance.amount}
                onChange={e => setNewAllowance(a => ({ ...a, amount: Number(e.target.value) }))} /></div>
            <div><label className="label">適用開始日</label>
              <input type="date" className="input" value={newAllowance.effective_from}
                onChange={e => setNewAllowance(a => ({ ...a, effective_from: e.target.value }))} /></div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="ot" checked={newAllowance.include_in_overtime}
                onChange={e => setNewAllowance(a => ({ ...a, include_in_overtime: e.target.checked }))}
                className="w-4 h-4 accent-clinic-600" />
              <label htmlFor="ot" className="text-sm text-gray-700">残業代計算の基礎に含める</label>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowAllowanceForm(false)} className="btn-secondary flex-1">キャンセル</button>
              <button onClick={handleAddAllowance} className="btn-primary flex-1">追加</button>
            </div>
          </div>
        </div>
      )}

      {/* 応援交通費追加モーダル */}
      {showSupportFeeForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="font-semibold text-gray-800">応援交通費を追加</h2>
            <div>
              <label className="label">日付</label>
              <input type="date" className="input" value={newSupportFee.date}
                onChange={e => setNewSupportFee(f => ({ ...f, date: e.target.value }))} />
            </div>
            <div>
              <label className="label">金額（円）</label>
              <input type="number" className="input" min={0} value={newSupportFee.amount}
                onChange={e => setNewSupportFee(f => ({ ...f, amount: Number(e.target.value) }))} />
            </div>
            <div>
              <label className="label">備考（任意）</label>
              <input className="input" value={newSupportFee.note}
                onChange={e => setNewSupportFee(f => ({ ...f, note: e.target.value }))}
                placeholder="例: なんよう眼科応援" />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowSupportFeeForm(false)} className="btn-secondary flex-1">キャンセル</button>
              <button onClick={handleAddSupportFee} className="btn-primary flex-1">追加</button>
            </div>
          </div>
        </div>
      )}

      {/* 昇給記録モーダル */}
      {showSalaryForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="font-semibold text-gray-800">給与改定を記録</h2>
            <div className="bg-gray-50 rounded-xl p-3 text-sm">
              <span className="text-gray-500">現在の基本給: </span>
              <span className="font-bold">¥{form.base_salary.toLocaleString()}</span>
            </div>
            <div>
              <label className="label">改定後の基本給（円）</label>
              <input type="number" className="input" min={0} value={newSalary.base_salary}
                onChange={e => setNewSalary(s => ({ ...s, base_salary: Number(e.target.value) }))} />
              <div className={`text-xs mt-1 font-medium ${newSalary.base_salary - form.base_salary >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {newSalary.base_salary - form.base_salary >= 0 ? '+' : ''}¥{(newSalary.base_salary - form.base_salary).toLocaleString()}
              </div>
            </div>
            <div><label className="label">適用日</label>
              <input type="date" className="input" value={newSalary.effective_date}
                onChange={e => setNewSalary(s => ({ ...s, effective_date: e.target.value }))} /></div>
            <div><label className="label">理由（任意）</label>
              <input className="input" value={newSalary.change_reason}
                onChange={e => setNewSalary(s => ({ ...s, change_reason: e.target.value }))} placeholder="例: 定期昇給・昇格" /></div>
            <div className="flex gap-3">
              <button onClick={() => setShowSalaryForm(false)} className="btn-secondary flex-1">キャンセル</button>
              <button onClick={handleSalaryChange} className="btn-primary flex-1">記録する</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
