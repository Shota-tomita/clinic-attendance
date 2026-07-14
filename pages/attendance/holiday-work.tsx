// pages/attendance/holiday-work.tsx
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { format } from 'date-fns'

const STATUS_LABELS: Record<string, string> = {
  pending: '審査中', approved: '承認済', rejected: '却下',
}
const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-600',
}

export default function HolidayWorkPage() {
  const { user, profile, loading } = useAuth()
  const router = useRouter()
  const [requests, setRequests] = useState<any[]>([])
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    reason: '',
  })

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [user, loading])

  useEffect(() => {
    if (user) fetchRequests()
  }, [user])

  const fetchRequests = async () => {
    const { data } = await supabase
      .from('holiday_work_requests')
      .select('*')
      .eq('user_id', user!.id)
      .order('date', { ascending: false })
    setRequests(data ?? [])
  }

  const handleSubmit = async () => {
    if (!form.date) { setError('日付を入力してください'); return }
    if (!form.reason.trim()) { setError('理由を入力してください'); return }
    setSaving(true)
    setError('')
    const { error: err } = await supabase.from('holiday_work_requests').upsert({
      user_id: user!.id,
      date: form.date,
      reason: form.reason,
      status: 'pending',
    }, { onConflict: 'user_id,date' })
    setSaving(false)
    if (err) { setError(err.message); return }
    setShowForm(false)
    setForm({ date: format(new Date(), 'yyyy-MM-dd'), reason: '' })
    fetchRequests()
  }

  if (loading || !profile) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-4xl animate-pulse">🏥</div>
    </div>
  )

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">🏖️ 休日出勤申請</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              休日に出勤する場合はこちらから申請してください。承認後、始業時刻は管理者が確定し、勤務時間はすべて残業として計算されます。
            </p>
          </div>
          <button onClick={() => { setShowForm(true); setError('') }} className="btn-primary text-sm whitespace-nowrap">
            ＋ 新規申請
          </button>
        </div>

        <div className="card p-0 overflow-hidden">
          <div className="divide-y divide-gray-50">
            {requests.length === 0 ? (
              <div className="text-center py-10 text-gray-400 text-sm">申請がありません</div>
            ) : requests.map(r => (
              <div key={r.id} className="px-4 py-3 flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-800">{r.date}</span>
                    {r.status === 'approved' && r.start_time && (
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                        {r.start_time.slice(0,5)} 開始
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">理由: {r.reason}</div>
                  {r.admin_note && (
                    <div className="text-xs text-blue-600 mt-0.5">管理者コメント: {r.admin_note}</div>
                  )}
                </div>
                <span className={`badge ${STATUS_COLORS[r.status]}`}>{STATUS_LABELS[r.status]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="font-semibold text-gray-800">休日出勤申請</h2>
            <div>
              <label className="label">日付</label>
              <input type="date" className="input" value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            </div>
            <div>
              <label className="label">理由 <span className="text-red-400">*</span></label>
              <textarea className="input resize-none" rows={3}
                value={form.reason}
                onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                placeholder="例: 手術患者対応のため" />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-3">
              <button onClick={() => { setShowForm(false); setError('') }} className="btn-secondary flex-1">
                キャンセル
              </button>
              <button onClick={handleSubmit} disabled={saving} className="btn-primary flex-1">
                {saving ? '申請中...' : '申請する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
