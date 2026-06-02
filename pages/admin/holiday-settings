import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { format, parseISO, addDays, eachDayOfInterval } from 'date-fns'
import { ja } from 'date-fns/locale'

type ClosedPeriod = {
  id: string
  name: string
  start_date: string
  end_date: string
  period_type: 'obon' | 'custom'
  year: number
}

export default function HolidaySettingsPage() {
  const { user, profile, loading, isAdmin } = useAuth()
  const router = useRouter()

  const [closedPeriods, setClosedPeriods] = useState<ClosedPeriod[]>([])
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [form, setForm] = useState({
    name: 'お盆休み',
    start_date: '',
    end_date: '',
    period_type: 'obon' as 'obon' | 'custom',
    year: new Date().getFullYear(),
  })

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
    else if (!loading && profile && !isAdmin) router.replace('/dashboard')
  }, [user, loading, profile, isAdmin])

  useEffect(() => {
    if (isAdmin) fetchClosedPeriods()
  }, [isAdmin])

  const fetchClosedPeriods = async () => {
    const { data } = await supabase
      .from('closed_periods')
      .select('*')
      .order('start_date', { ascending: false })
    setClosedPeriods(data ?? [])
  }

  const handleSave = async () => {
    if (!form.start_date || !form.end_date) return
    setSaving(true)
    await supabase.from('closed_periods').insert({
      name: form.name,
      start_date: form.start_date,
      end_date: form.end_date,
      period_type: form.period_type,
      year: form.year,
    })
    setSaving(false)
    setShowForm(false)
    setForm({ name: 'お盆休み', start_date: '', end_date: '', period_type: 'obon', year: new Date().getFullYear() })
    fetchClosedPeriods()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('この休診期間を削除しますか？')) return
    await supabase.from('closed_periods').delete().eq('id', id)
    fetchClosedPeriods()
  }

  // 年末年始の自動表示（12/29〜1/3）
  const currentYear = new Date().getFullYear()
  const nenmatsu = [
    { label: `${currentYear}年末年始`, dates: `${currentYear}/12/29 〜 ${currentYear + 1}/1/3` },
    { label: `${currentYear - 1}年末年始`, dates: `${currentYear - 1}/12/29 〜 ${currentYear}/1/3` },
  ]

  if (loading || !profile) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-4xl animate-pulse">🏥</div>
    </div>
  )

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">🗓️ 休診日設定</h1>
          <p className="text-xs text-gray-400 mt-0.5">お盆・臨時休診などの特別休診日を設定します</p>
        </div>

        {/* 自動設定（年末年始） */}
        <div className="card space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">🎍 年末年始（自動設定）</h2>
          <p className="text-xs text-gray-400">毎年12/29〜1/3は自動的に休診日として扱われます。</p>
          <div className="space-y-2">
            {nenmatsu.map(n => (
              <div key={n.label} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-2.5">
                <span className="text-sm text-gray-700">{n.label}</span>
                <span className="text-xs text-gray-500">{n.dates}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 定休日 */}
        <div className="card space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">📅 定休日（固定）</h2>
          <div className="space-y-2">
            {[
              { label: '日曜日', desc: '毎週日曜は休診' },
              { label: '祝日', desc: '国民の祝日は休診' },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-2.5">
                <span className="text-sm text-gray-700">{item.label}</span>
                <span className="text-xs text-gray-400">{item.desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* お盆・臨時休診 */}
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">🎋 お盆・臨時休診</h2>
            <button onClick={() => setShowForm(true)} className="btn-primary text-xs px-3 py-1.5">
              ＋ 追加
            </button>
          </div>

          {closedPeriods.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">設定がありません</p>
          ) : (
            <div className="space-y-2">
              {closedPeriods.map(p => (
                <div key={p.id} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-2.5">
                  <div>
                    <div className="text-sm font-medium text-gray-700">{p.name}</div>
                    <div className="text-xs text-gray-400">{p.start_date} 〜 {p.end_date}</div>
                  </div>
                  <button onClick={() => handleDelete(p.id)}
                    className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50">
                    削除
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 追加フォーム */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="font-semibold text-gray-800">休診期間を追加</h2>
            <div>
              <label className="label">種別</label>
              <div className="grid grid-cols-2 gap-2">
                {([['obon', 'お盆'], ['custom', '臨時休診']] as const).map(([v, l]) => (
                  <button key={v}
                    onClick={() => setForm(f => ({
                      ...f,
                      period_type: v,
                      name: v === 'obon' ? 'お盆休み' : '臨時休診',
                    }))}
                    className={`py-2 rounded-xl text-sm font-medium border-2 transition-all
                      ${form.period_type === v ? 'border-clinic-500 bg-clinic-50 text-clinic-700' : 'border-gray-200 text-gray-500'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">名称</label>
              <input className="input" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="例: お盆休み2026" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">開始日</label>
                <input type="date" className="input" value={form.start_date}
                  onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
              </div>
              <div>
                <label className="label">終了日</label>
                <input type="date" className="input" value={form.end_date}
                  onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowForm(false)} className="btn-secondary flex-1">キャンセル</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">
                {saving ? '保存中...' : '追加'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
