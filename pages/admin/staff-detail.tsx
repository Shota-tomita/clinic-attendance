import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/lib/auth'
import { supabase, Profile, Department } from '@/lib/supabase'
import { calcTransportFee, calcNextAccrualDate, calcGrantDays } from '@/lib/payroll'
import { differenceInMonths, differenceInYears, format, parseISO } from 'date-fns'
import { ja } from 'date-fns/locale'

const COMMUTE_LABELS = { train: '電車・バス', car: 'マイカー', bicycle: '自転車', none: 'なし' }

export default function StaffDetailPage() {
  const { user, profile: myProfile, loading, isAdmin } = useAuth()
  const router = useRouter()
  const { id } = router.query

  const [staff, setStaff] = useState<Profile | null>(null)
  const [departments, setDepartments] = useState<Department[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [form, setForm] = useState({
    name: '', email: '', role: 'staff', department_id: '',
    employment_type: 'full_time',
    hire_date: '', weekly_scheduled_days: 5,
    base_salary: 0,
    commute_type: 'train',
    commute_distance_km: '',
    commute_car_rate_type: 'legal',
    commute_car_custom_rate: '',
    commute_monthly_fee: 0,
    annual_leave_days: 10, used_leave_days: 0,
    lineworks_user_id: '',
  })

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
      // handled above
      else if (!isAdmin) router.replace('/dashboard')
    }
  }, [user, loading, isAdmin])

  useEffect(() => {
    if (id && isAdmin) {
      fetchStaff()
      fetchDepts()
    }
  }, [id, isAdmin])

  const fetchStaff = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*, departments(*)')
      .eq('id', id)
      .single()
    if (data) {
      setStaff(data)
      setForm({
        name: data.name,
        email: data.email,
        role: data.role,
        department_id: data.department_id ?? '',
        employment_type: data.employment_type,
        hire_date: data.hire_date ?? '',
        weekly_scheduled_days: data.weekly_scheduled_days ?? 5,
        base_salary: data.base_salary ?? 0,
        commute_type: data.commute_type ?? 'train',
        commute_distance_km: data.commute_distance_km ?? '',
        commute_car_rate_type: data.commute_car_rate_type ?? 'legal',
        commute_car_custom_rate: data.commute_car_custom_rate ?? '',
        commute_monthly_fee: data.commute_monthly_fee ?? 0,
        annual_leave_days: data.annual_leave_days,
        used_leave_days: data.used_leave_days,
        lineworks_user_id: data.lineworks_user_id ?? '',
      })
    }
  }

  const fetchDepts = async () => {
    const { data } = await supabase.from('departments').select('*').order('name')
    setDepartments(data ?? [])
  }

  const handleSave = async () => {
    if (!staff) return
    setSaving(true)
    await supabase.from('profiles').update({
      name: form.name,
      role: form.role,
      department_id: form.department_id || null,
      employment_type: form.employment_type,
      hire_date: form.hire_date || null,
      weekly_scheduled_days: form.weekly_scheduled_days,
      base_salary: form.base_salary,
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
    fetchStaff()
  }

  // 計算表示用
  const monthsOfService = form.hire_date
    ? differenceInMonths(new Date(), parseISO(form.hire_date))
    : null
  const yearsOfService = form.hire_date
    ? differenceInYears(new Date(), parseISO(form.hire_date))
    : null
  const nextAccrualDate = form.hire_date
    ? calcNextAccrualDate(parseISO(form.hire_date))
    : null
  const nextGrantDays = monthsOfService !== null
    ? calcGrantDays(monthsOfService, form.weekly_scheduled_days)
    : null

  const estimatedTransport = calcTransportFee({
    commuteType: form.commute_type as any,
    monthlyFee: form.commute_monthly_fee,
    distanceKm: form.commute_distance_km ? Number(form.commute_distance_km) : undefined,
    carRateType: form.commute_car_rate_type as any,
    customRate: form.commute_car_custom_rate ? Number(form.commute_car_custom_rate) : undefined,
  })

  const remainingLeave = form.annual_leave_days - form.used_leave_days

  if (loading || !myProfile) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-4xl animate-pulse">🏥</div>
    </div>
  )

  const f = (key: string, val: any) => setForm(prev => ({ ...prev, [key]: val }))

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/staff')} className="text-gray-400 hover:text-gray-600 text-sm">
            ← スタッフ一覧
          </button>
          <h1 className="text-xl font-semibold text-gray-900">{staff?.name} の詳細</h1>
          {saved && <span className="text-xs text-emerald-600 ml-auto">✅ 保存しました</span>}
        </div>

        {/* 基本情報 */}
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">👤 基本情報</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">氏名</label>
              <input className="input" value={form.name} onChange={e => f('name', e.target.value)} />
            </div>
            <div>
              <label className="label">ロール</label>
              <select className="select" value={form.role} onChange={e => f('role', e.target.value)}>
                {[['admin','院長'],['leader','リーダー'],['staff','スタッフ']].map(([v,l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">部署</label>
              <select className="select" value={form.department_id} onChange={e => f('department_id', e.target.value)}>
                <option value="">— 未設定 —</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">雇用形態</label>
              <select className="select" value={form.employment_type} onChange={e => f('employment_type', e.target.value)}>
                <option value="full_time">正社員</option>
                <option value="part_time">パート・アルバイト</option>
              </select>
            </div>
          </div>
        </div>

        {/* 入職・勤続 */}
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">📅 入職日・勤続情報</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">入職日</label>
              <input type="date" className="input" value={form.hire_date}
                onChange={e => f('hire_date', e.target.value)} />
            </div>
            <div>
              <label className="label">週所定労働日数（パート）</label>
              <select className="select" value={form.weekly_scheduled_days}
                onChange={e => f('weekly_scheduled_days', Number(e.target.value))}>
                {[5, 4, 3, 2, 1].map(d => (
                  <option key={d} value={d}>{d}日/週{d === 5 ? '（常勤）' : ''}</option>
                ))}
              </select>
            </div>
          </div>

          {form.hire_date && (
            <div className="bg-clinic-50 rounded-xl p-3 grid grid-cols-3 gap-2 text-center text-sm">
              <div>
                <div className="text-lg font-bold text-clinic-700">{yearsOfService}年</div>
                <div className="text-xs text-gray-500">勤続年数</div>
              </div>
              <div>
                <div className="text-lg font-bold text-gray-700">
                  {nextAccrualDate ? format(nextAccrualDate, 'M/d', { locale: ja }) : '—'}
                </div>
                <div className="text-xs text-gray-500">次回付与日</div>
              </div>
              <div>
                <div className="text-lg font-bold text-emerald-600">{nextGrantDays ?? 0}日</div>
                <div className="text-xs text-gray-500">次回付与日数</div>
              </div>
            </div>
          )}
        </div>

        {/* 有給管理 */}
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">🌿 有給残日数（手動調整）</h2>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">付与日数</label>
              <input type="number" className="input" min={0} max={40}
                value={form.annual_leave_days}
                onChange={e => f('annual_leave_days', Number(e.target.value))} />
            </div>
            <div>
              <label className="label">取得済日数</label>
              <input type="number" className="input" min={0}
                value={form.used_leave_days}
                onChange={e => f('used_leave_days', Number(e.target.value))} />
            </div>
            <div>
              <label className="label">残日数</label>
              <div className={`input flex items-center font-bold ${remainingLeave <= 3 ? 'text-red-500' : 'text-clinic-600'}`}>
                {remainingLeave}日
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-400">
            ※ システム開始時に現在の残日数を入力してください。以降は入職日から自動計算されます。
          </p>
        </div>

        {/* 交通費 */}
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">🚌 通勤交通費</h2>
          <div>
            <label className="label">通勤手段</label>
            <div className="grid grid-cols-4 gap-2">
              {(['train','car','bicycle','none'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => f('commute_type', t)}
                  className={`py-2.5 rounded-xl text-sm font-medium border-2 transition-all
                    ${form.commute_type === t
                      ? 'border-clinic-500 bg-clinic-50 text-clinic-700'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}
                >
                  {t === 'train' ? '🚃' : t === 'car' ? '🚗' : t === 'bicycle' ? '🚲' : '❌'}
                  <div className="text-xs mt-0.5">{COMMUTE_LABELS[t]}</div>
                </button>
              ))}
            </div>
          </div>

          {form.commute_type === 'train' && (
            <div>
              <label className="label">月額定期代（円）</label>
              <input type="number" className="input" min={0}
                value={form.commute_monthly_fee}
                onChange={e => f('commute_monthly_fee', Number(e.target.value))}
                placeholder="例: 8390" />
            </div>
          )}

          {form.commute_type === 'car' && (
            <div className="space-y-3">
              <div>
                <label className="label">片道距離（km）</label>
                <input type="number" className="input" min={0} step={0.1}
                  value={form.commute_distance_km}
                  onChange={e => f('commute_distance_km', e.target.value)}
                  placeholder="例: 12.5" />
              </div>
              <div>
                <label className="label">計算方法</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['legal','custom'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => f('commute_car_rate_type', t)}
                      className={`py-2 rounded-xl text-sm font-medium border-2 transition-all
                        ${form.commute_car_rate_type === t
                          ? 'border-clinic-500 bg-clinic-50 text-clinic-700'
                          : 'border-gray-200 text-gray-500'}`}
                    >
                      {t === 'legal' ? '国税庁法定上限' : '独自単価（円/km）'}
                    </button>
                  ))}
                </div>
              </div>
              {form.commute_car_rate_type === 'custom' && (
                <div>
                  <label className="label">単価（円/km）</label>
                  <input type="number" className="input" min={0}
                    value={form.commute_car_custom_rate}
                    onChange={e => f('commute_car_custom_rate', e.target.value)}
                    placeholder="例: 15" />
                </div>
              )}
            </div>
          )}

          {form.commute_type !== 'none' && (
            <div className="bg-clinic-50 rounded-xl p-3 flex items-center justify-between">
              <span className="text-sm text-gray-600">月額交通費（目安）</span>
              <span className="text-lg font-bold text-clinic-700">
                ¥{estimatedTransport.toLocaleString()}
              </span>
            </div>
          )}
        </div>

        {/* 給与・評価 */}
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">💰 給与・ボーナス設定</h2>
          <div>
            <label className="label">基本給（円）</label>
            <input type="number" className="input" min={0}
              value={form.base_salary}
              onChange={e => f('base_salary', Number(e.target.value))}
              placeholder="例: 250000" />
          </div>
        </div>

        {/* LINE WORKS */}
        <div className="card space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">💬 LINE WORKS</h2>
          <div>
            <label className="label">LINE WORKSユーザーID</label>
            <input className="input" value={form.lineworks_user_id}
              onChange={e => f('lineworks_user_id', e.target.value)}
              placeholder="例: user@clinicworkspace" />
            <p className="text-xs text-gray-400 mt-1">
              LINE WORKSの管理画面で確認できるユーザーIDを入力してください
            </p>
          </div>
        </div>

        <button onClick={handleSave} disabled={saving} className="btn-primary w-full text-base py-3">
          {saving ? '保存中...' : '保存する'}
        </button>
      </div>
    </Layout>
  )
}
