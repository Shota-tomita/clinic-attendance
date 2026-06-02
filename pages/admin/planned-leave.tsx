import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/lib/auth'
import { supabase, Profile } from '@/lib/supabase'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'

export default function PlannedLeavePage() {
  const { user, profile, loading, isAdmin } = useAuth()
  const router = useRouter()

  const [staffList, setStaffList] = useState<Profile[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState('')
  const [history, setHistory] = useState<any[]>([])

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
    else if (!loading && profile && !isAdmin) router.replace('/dashboard')
  }, [user, loading, profile, isAdmin])

  useEffect(() => {
    if (isAdmin) {
      fetchStaff()
      fetchHistory()
    }
  }, [isAdmin])

  const fetchStaff = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*, departments(*)')
      .neq('role', 'admin')
      .eq('employment_type', 'full_time')
      .order('name')
    setStaffList(data ?? [])
  }

  const fetchHistory = async () => {
    const { data } = await supabase
      .from('leave_requests')
      .select('*, profiles(name)')
      .eq('leave_category', 'planned')
      .order('created_at', { ascending: false })
      .limit(50)
    setHistory(data ?? [])
  }

  const toggleAll = () => {
    if (selectedIds.length === staffList.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(staffList.map(s => s.id))
    }
  }

  const toggleStaff = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    )
  }

  const handleSubmit = async () => {
    if (!date) { setResult('❌ 日付を入力してください'); return }
    if (selectedIds.length === 0) { setResult('❌ 対象スタッフを選択してください'); return }
    if (!confirm(`${selectedIds.length}名に ${date} の計画的有給を付与しますか？`)) return

    setSaving(true)
    setResult('')

    let success = 0
    let errors = 0

    for (const userId of selectedIds) {
      // 有給申請を作成（自動承認）
      const { error } = await supabase.from('leave_requests').insert({
        user_id: userId,
        leave_type: 'paid_leave',
        leave_category: 'planned',
        start_date: date,
        end_date: date,
        days_count: 1,
        reason: reason || '計画的有給付与',
        status: 'approved',
        reviewed_by: user?.id,
      })

      if (!error) {
        // 使用済み日数を加算
        const { data: p } = await supabase
          .from('profiles')
          .select('used_leave_days')
          .eq('id', userId)
          .single()
        await supabase.from('profiles').update({
          used_leave_days: (p?.used_leave_days ?? 0) + 1
        }).eq('id', userId)
        success++
      } else {
        errors++
      }
    }

    setSaving(false)
    setResult(`✅ ${success}名に計画的有給を付与しました${errors > 0 ? `（${errors}件エラー）` : ''}`)
    setSelectedIds([])
    setDate('')
    setReason('')
    fetchHistory()
    fetchStaff()
  }

  if (loading || !profile) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-4xl animate-pulse">🏥</div>
    </div>
  )

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">📋 計画的有給付与</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            指定した日付に対象スタッフ全員の有給を一斉付与します（年5日義務対応）
          </p>
        </div>

        {/* 付与設定 */}
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">付与設定</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">付与日 <span className="text-red-400">*</span></label>
              <input type="date" className="input" value={date}
                onChange={e => setDate(e.target.value)} />
            </div>
            <div>
              <label className="label">理由（任意）</label>
              <input className="input" value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="例: 夏季一斉有給" />
            </div>
          </div>
        </div>

        {/* 対象スタッフ選択 */}
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">対象スタッフ</h2>
            <button onClick={toggleAll} className="text-xs text-clinic-600 hover:text-clinic-700 font-medium">
              {selectedIds.length === staffList.length ? '全解除' : '全員選択'}
            </button>
          </div>

          <div className="space-y-1.5">
            {staffList.map(s => {
              const remaining = s.annual_leave_days - s.used_leave_days
              return (
                <div
                  key={s.id}
                  onClick={() => toggleStaff(s.id)}
                  className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all
                    ${selectedIds.includes(s.id)
                      ? 'bg-clinic-50 border border-clinic-200'
                      : 'bg-gray-50 hover:bg-gray-100'}`}
                >
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0
                    ${selectedIds.includes(s.id) ? 'bg-clinic-500 border-clinic-500' : 'border-gray-300'}`}>
                    {selectedIds.includes(s.id) && <span className="text-white text-xs">✓</span>}
                  </div>
                  <div className="w-7 h-7 rounded-full bg-clinic-100 text-clinic-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                    {s.name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-800">{s.name}</div>
                    <div className="text-xs text-gray-400">{(s as any).departments?.name}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className={`text-sm font-bold ${remaining <= 3 ? 'text-red-500' : 'text-clinic-600'}`}>
                      {remaining}日
                    </div>
                    <div className="text-xs text-gray-400">有給残</div>
                  </div>
                </div>
              )
            })}
          </div>

          {selectedIds.length > 0 && (
            <div className="bg-clinic-50 rounded-xl px-4 py-2.5 text-sm text-clinic-700">
              <strong>{selectedIds.length}名</strong> を選択中
            </div>
          )}
        </div>

        {result && (
          <div className={`text-sm px-4 py-3 rounded-xl ${
            result.includes('✅') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
          }`}>
            {result}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={saving || selectedIds.length === 0 || !date}
          className="btn-primary w-full py-3 text-base"
        >
          {saving ? '付与中...' : `${selectedIds.length}名に計画的有給を付与する`}
        </button>

        {/* 付与履歴 */}
        {history.length > 0 && (
          <div className="card space-y-3">
            <h2 className="text-sm font-semibold text-gray-700">付与履歴</h2>
            <div className="space-y-2">
              {history.map(h => (
                <div key={h.id} className="flex items-center justify-between text-sm py-1.5 border-b border-gray-50 last:border-0">
                  <div>
                    <div className="font-medium text-gray-700">{h.profiles?.name}</div>
                    <div className="text-xs text-gray-400">{h.reason}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-gray-600">{h.start_date}</div>
                    <div className="text-xs text-emerald-600">1日付与</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
