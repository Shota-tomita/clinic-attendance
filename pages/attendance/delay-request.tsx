// pages/attendance/delay-request.tsx
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

export default function DelayRequestPage() {
  const { user, profile, loading } = useAuth()
  const router = useRouter()
  const [requests, setRequests] = useState<any[]>([])
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [certFile, setCertFile] = useState<File | null>(null)
  const [form, setForm] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    certificate_minutes: '',
    requested_minutes: '',
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
      .from('delay_requests')
      .select('*')
      .eq('user_id', user!.id)
      .order('date', { ascending: false })
    setRequests(data ?? [])
  }

  const needsReason = () => {
    const cert = Number(form.certificate_minutes || 0)
    const req = Number(form.requested_minutes || 0)
    return req > cert
  }

  const handleSubmit = async () => {
    if (!form.date) { setError('日付を入力してください'); return }
    if (!form.requested_minutes) { setError('申請する分数を入力してください'); return }
    if (needsReason() && !form.reason.trim()) {
      setError('証明書の時間を超えて申請する場合は理由の入力が必要です')
      return
    }
    setSaving(true)
    setError('')

    let certificateUrl: string | null = null
    if (certFile) {
      const ext = certFile.name.split('.').pop()
      const path = `${user!.id}/${form.date}_${Date.now()}.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from('delay-certificates')
        .upload(path, certFile)
      if (uploadErr) { setSaving(false); setError('証明書のアップロードに失敗しました: ' + uploadErr.message); return }
      certificateUrl = path
    }

    const { error: err } = await supabase.from('delay_requests').upsert({
      user_id: user!.id,
      date: form.date,
      certificate_minutes: form.certificate_minutes ? Number(form.certificate_minutes) : null,
      requested_minutes: Number(form.requested_minutes),
      reason: form.reason || null,
      certificate_url: certificateUrl,
      status: 'pending',
    }, { onConflict: 'user_id,date' })

    setSaving(false)
    if (err) { setError(err.message); return }
    setShowForm(false)
    setCertFile(null)
    setForm({ date: format(new Date(), 'yyyy-MM-dd'), certificate_minutes: '', requested_minutes: '', reason: '' })
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
            <h1 className="text-xl font-semibold text-gray-900">🚃 電車遅延申請</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              電車遅延で遅刻した場合、証明書を添付して申請してください。承認された分数だけ遅刻時間から控除されます。
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
                    <span className="text-xs text-gray-400">
                      証明書: {r.certificate_minutes ?? '—'}分 / 申請: {r.requested_minutes}分
                    </span>
                  </div>
                  {r.reason && <div className="text-xs text-gray-500 mt-0.5">理由: {r.reason}</div>}
                  {r.status === 'approved' && (
                    <div className="text-xs text-emerald-600 mt-0.5 font-medium">
                      承認分数: {r.approved_minutes}分
                    </div>
                  )}
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
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/40 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4 my-8">
            <h2 className="font-semibold text-gray-800">電車遅延申請</h2>
            <div>
              <label className="label">日付</label>
              <input type="date" className="input" value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            </div>
            <div>
              <label className="label">遅延証明書（画像）</label>
              <input type="file" accept="image/*,application/pdf"
                onChange={e => setCertFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-gray-500 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-clinic-50 file:text-clinic-700 file:text-xs" />
            </div>
            <div>
              <label className="label">証明書に記載の遅延分数</label>
              <input type="number" className="input" value={form.certificate_minutes}
                onChange={e => setForm(f => ({ ...f, certificate_minutes: e.target.value }))}
                placeholder="例: 7" />
            </div>
            <div>
              <label className="label">申請する免除分数 <span className="text-red-400">*</span></label>
              <input type="number" className="input" value={form.requested_minutes}
                onChange={e => setForm(f => ({ ...f, requested_minutes: e.target.value }))}
                placeholder="例: 15" />
            </div>
            {needsReason() && (
              <div>
                <label className="label">証明書の時間を超える理由 <span className="text-red-400">*</span></label>
                <textarea className="input resize-none" rows={3}
                  value={form.reason}
                  onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                  placeholder="例: 乗り換え路線も遅延の影響を受けたため" />
              </div>
            )}
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
