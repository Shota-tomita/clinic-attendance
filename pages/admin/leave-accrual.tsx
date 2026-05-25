import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/lib/auth'
import { supabase, Profile } from '@/lib/supabase'
import { calcGrantDays, calcNextAccrualDate, executeLeaveAccrual } from '@/lib/payroll'
import { differenceInMonths, format, parseISO } from 'date-fns'
import { ja } from 'date-fns/locale'

type AccrualHistory = {
  id: string
  user_id: string
  accrual_date: string
  days_granted: number
  days_carried_over: number
  days_expired: number
  balance_before: number
  balance_after: number
  accrual_type: 'auto' | 'manual' | 'initial'
  note: string | null
}

export default function LeaveAccrualPage() {
  const { user, profile, loading, isAdmin } = useAuth()
  const router = useRouter()
  const [staffList, setStaffList] = useState<Profile[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [history, setHistory] = useState<AccrualHistory[]>([])
  const [processing, setProcessing] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [user, loading])

  useEffect(() => {
    if (!loading && profile && !isAdmin) router.replace('/dashboard')
  }, [loading, profile, isAdmin])

  useEffect(() => { if (isAdmin) fetchStaff() }, [isAdmin])
  useEffect(() => { if (selectedId) fetchHistory() }, [selectedId])

  const fetchStaff = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*, departments(*)')
      .neq('role', 'admin')
      .order('name')
    setStaffList(data ?? [])
    if (data?.length) setSelectedId(data[0].id)
  }

  const fetchHistory = async () => {
    const { data } = await supabase
      .from('leave_accrual_history')
      .select('*')
      .eq('user_id', selectedId)
      .order('accrual_date', { ascending: false })
    setHistory(data ?? [])
  }

  const selected = staffList.find(s => s.id === selectedId)
  const monthsOfService = selected?.hire_date
    ? differenceInMonths(new Date(), parseISO(selected.hire_date))
    : null
  const nextAccrual = selected?.hire_date
    ? calcNextAccrualDate(parseISO(selected.hire_date))
    : null
  const nextGrant = monthsOfService !== null && selected
    ? calcGrantDays(monthsOfService, selected.weekly_scheduled_days ?? 5)
    : 0

  const handleManualAccrual = async () => {
    if (!selected) return
    if (!confirm(`${selected.name} さんに有給を手動付与しますか？`)) return
    setProcessing(true)
    setMessage('')
    const result = await executeLeaveAccrual(selected.id)
    setProcessing(false)
    setMessage(result ? `✅ ${result.message}` : '付与対象外（入職6ヶ月未満など）')
    fetchHistory()
    fetchStaff()
  }

  const accrualTypeLabel = (t: string) => ({
    auto: '自動', manual: '手動', initial: '初期設定'
  }[t] ?? t)
  const accrualTypeColor = (t: string) => ({
    auto: 'bg-emerald-100 text-emerald-700',
    manual: 'bg-blue-100 text-blue-700',
    initial: 'bg-gray-100 text-gray-600',
  }[t] ?? '')

  if (loading || !profile) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-4xl animate-pulse">🏥</div>
    </div>
  )

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">📈 有給付与管理</h1>
          <p className="text-xs text-gray-400 mt-0.5">入職日から法定付与日数を自動計算・管理します</p>
        </div>

        {/* スタッフ選択 */}
        <div className="card flex flex-wrap gap-3 items-center py-3">
          <select className="select w-auto" value={selectedId}
            onChange={e => setSelectedId(e.target.value)}>
            {staffList.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {selected && !selected.hire_date && (
            <div className="text-xs text-amber-600 bg-amber-50 px-3 py-1.5 rounded-lg">
              ⚠️ 入職日が未設定です。スタッフ詳細から設定してください。
            </div>
          )}
        </div>

        {/* 現状サマリー */}
        {selected && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="card text-center">
              <div className="text-xl font-bold text-gray-800">{selected.annual_leave_days}</div>
              <div className="text-xs text-gray-500">付与日数</div>
            </div>
            <div className="card text-center">
              <div className="text-xl font-bold text-amber-600">{selected.used_leave_days}</div>
              <div className="text-xs text-gray-500">取得済</div>
            </div>
            <div className="card text-center">
              <div className="text-xl font-bold text-clinic-600">
                {selected.annual_leave_days - selected.used_leave_days}
              </div>
              <div className="text-xs text-gray-500">残日数</div>
            </div>
            <div className="card text-center">
              <div className="text-sm font-bold text-gray-700">
                {nextAccrual ? format(nextAccrual, 'M/d', { locale: ja }) : '—'}
              </div>
              <div className="text-xs text-gray-500">次回付与</div>
              {nextGrant > 0 && (
                <div className="text-xs text-emerald-600 mt-0.5">+{nextGrant}日予定</div>
              )}
            </div>
          </div>
        )}

        {/* 手動付与 */}
        <div className="card space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">手動付与</h2>
          <p className="text-xs text-gray-400">
            通常は入職日から自動計算されますが、必要に応じて手動で付与できます。
          </p>
          {message && (
            <div className="text-sm bg-emerald-50 border border-emerald-100 text-emerald-700 px-3 py-2 rounded-lg">
              {message}
            </div>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => router.push(`/admin/staff-detail?id=${selectedId}`)}
              className="btn-secondary text-sm"
            >
              スタッフ詳細で調整
            </button>
            <button
              onClick={handleManualAccrual}
              disabled={processing || !selected?.hire_date}
              className="btn-primary text-sm"
            >
              {processing ? '処理中...' : '手動付与を実行'}
            </button>
          </div>
        </div>

        {/* 付与履歴 */}
        <div className="card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">付与履歴</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="table-th">日付</th>
                  <th className="table-th">種別</th>
                  <th className="table-th">付与</th>
                  <th className="table-th">繰越</th>
                  <th className="table-th">時効消滅</th>
                  <th className="table-th">付与前</th>
                  <th className="table-th">付与後</th>
                  <th className="table-th">備考</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {history.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-8 text-gray-400">履歴がありません</td></tr>
                ) : history.map(h => (
                  <tr key={h.id} className="hover:bg-gray-50">
                    <td className="table-td whitespace-nowrap">{h.accrual_date}</td>
                    <td className="table-td">
                      <span className={`badge ${accrualTypeColor(h.accrual_type)}`}>
                        {accrualTypeLabel(h.accrual_type)}
                      </span>
                    </td>
                    <td className="table-td text-emerald-600 font-medium">+{h.days_granted}日</td>
                    <td className="table-td text-gray-500">{h.days_carried_over}日</td>
                    <td className="table-td text-red-400">
                      {h.days_expired > 0 ? `-${h.days_expired}日` : '—'}
                    </td>
                    <td className="table-td text-gray-500">{h.balance_before}日</td>
                    <td className="table-td font-medium text-clinic-700">{h.balance_after}日</td>
                    <td className="table-td text-xs text-gray-400">{h.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 全スタッフ一覧 */}
        <div className="card space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">全スタッフの有給状況</h2>
          <div className="space-y-2">
            {staffList.map(s => {
              const remaining = s.annual_leave_days - s.used_leave_days
              const months = s.hire_date ? differenceInMonths(new Date(), parseISO(s.hire_date)) : null
              const nextDate = s.hire_date ? calcNextAccrualDate(parseISO(s.hire_date)) : null
              return (
                <div
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all
                    ${selectedId === s.id ? 'bg-clinic-50 border border-clinic-200' : 'bg-gray-50 hover:bg-gray-100'}`}
                >
                  <div className="w-8 h-8 rounded-full bg-clinic-100 text-clinic-700 font-bold text-sm flex items-center justify-center flex-shrink-0">
                    {s.name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-800">{s.name}</div>
                    <div className="text-xs text-gray-400">
                      {s.hire_date ? `入職 ${s.hire_date}（${Math.floor((months ?? 0) / 12)}年${(months ?? 0) % 12}ヶ月）` : '入職日未設定'}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className={`text-sm font-bold ${remaining <= 3 ? 'text-red-500' : 'text-clinic-600'}`}>
                      {remaining}日
                    </div>
                    <div className="text-xs text-gray-400">残</div>
                  </div>
                  {nextDate && (
                    <div className="text-right flex-shrink-0 hidden md:block">
                      <div className="text-xs text-gray-500">次回付与</div>
                      <div className="text-xs font-medium text-emerald-600">
                        {format(nextDate, 'M/d', { locale: ja })}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </Layout>
  )
}
