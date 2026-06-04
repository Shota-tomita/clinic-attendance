import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/lib/auth'
import { supabase, Profile } from '@/lib/supabase'
import { format } from 'date-fns'

const STATUS_LABELS: Record<string, string> = {
  pending: '審査中', approved: '承認済', rejected: '却下',
}
const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-600',
}

export default function AdminEarlyStartPage() {
  const { user, profile, loading, isAdmin } = useAuth()
  const router = useRouter()
  const [requests, setRequests] = useState<any[]>([])
  const [staffNames, setStaffNames] = useState<Record<string, string>>({})
  const [staffList, setStaffList] = useState<Profile[]>([])
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [adminNote, setAdminNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState<'pending' | 'all'>('pending')
  const [showDirectForm, setShowDirectForm] = useState(false)
  const [directForm, setDirectForm] = useState({
    user_id: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    start_time: '',
    reason: '',
  })

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
    else if (!loading && profile && !isAdmin) router.replace('/dashboard')
  }, [user, loading, profile, isAdmin])

  useEffect(() => {
    if (isAdmin) {
      fetchRequests()
      fetchStaffNames()
      fetchStaffList()
    }
  }, [isAdmin])

  const fetchRequests = async () => {
    const { data } = await supabase
      .from('early_start_requests')
      .select('*')
      .order('date', { ascending: false })
    setRequests(data ?? [])
  }

  const fetchStaffNames = async () => {
    const { data } = await supabase.from('profiles').select('id, name')
    const map: Record<string, string> = {}
    for (const p of data ?? []) map[p.id] = p.name
    setStaffNames(map)
  }

  const fetchStaffList = async () => {
    const { data } = await supabase.from('profiles').select('*').neq('role', 'admin').order('name')
    setStaffList(data ?? [])
  }

  const handleApprove = async (req: any) => {
    setSaving(true)
    await supabase.from('early_start_requests').update({
      status: 'approved',
      reviewed_by: user!.id,
      reviewed_at: new Date().toISOString(),
      admin_note: adminNote || null,
    }).eq('id', req.id)
    setSaving(false)
    setReviewingId(null)
    setAdminNote('')
    fetchRequests()
  }

  const handleReject = async (id: string) => {
    setSaving(true)
    await supabase.from('early_start_requests').update({
      status: 'rejected',
      reviewed_by: user!.id,
      reviewed_at: new Date().toISOString(),
      admin_note: adminNote || null,
    }).eq('id', id)
    setSaving(false)
    setReviewingId(null)
    setAdminNote('')
    fetchRequests()
  }

  const handleDirectRegister = async () => {
    if (!directForm.user_id || !directForm.date || !directForm.start_time) return
    setSaving(true)
    await supabase.from('early_start_requests').upsert({
      user_id: directForm.user_id,
      date: directForm.date,
      start_time: directForm.start_time,
      reason: directForm.reason || '院長による直接登録',
      status: 'approved',
      reviewed_by: user!.id,
      reviewed_at: new Date().toISOString(),
    }, { onConflict: 'user_id,date' })
    setSaving(false)
    setShowDirectForm(false)
    setDirectForm({ user_id: '', date: format(new Date(), 'yyyy-MM-dd'), start_time: '', reason: '' })
    fetchRequests()
  }

  const filtered = requests.filter(r => filter === 'all' || r.status === 'pending')
  const pendingCount = requests.filter(r => r.status === 'pending').length

  if (loading || !profile) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-4xl animate-pulse">🏥</div>
    </div>
  )

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">⏰ 早出申請管理</h1>
            {pendingCount > 0 && <p className="text-xs text-amber-600 mt-0.5">⚠️ 審査待ち {pendingCount}件</p>}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowDirectForm(true)} className="btn-secondary text-sm">
              ＋ 直接登録
            </button>
            {(['pending', 'all'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-all
                  ${filter === f ? 'bg-clinic-600 text-white border-clinic-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                {f === 'pending' ? '審査待ち' : 'すべて'}
              </button>
            ))}
          </div>
        </div>

        <div className="card p-0 overflow-hidden">
          <div className="divide-y divide-gray-50">
            {filtered.length === 0 ? (
              <div className="text-center py-10 text-gray-400 text-sm">
                {filter === 'pending' ? '審査待ちの申請はありません' : '申請がありません'}
              </div>
            ) : filtered.map(r => (
              <div key={r.id} className="px-4 py-3 flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-800">{staffNames[r.user_id] ?? '—'}</span>
                    <span className="text-xs text-gray-400">{r.date} / {r.start_time?.slice(0,5)} 開始</span>
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">理由: {r.reason}</div>
                  {r.admin_note && <div className="text-xs text-blue-600 mt-0.5">コメント: {r.admin_note}</div>}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={`badge ${STATUS_COLORS[r.status]}`}>{STATUS_LABELS[r.status]}</span>
                  {r.status === 'pending' && (
                    <button onClick={() => { setReviewingId(r.id); setAdminNote('') }}
                      className="btn-secondary text-xs px-2 py-1">審査</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 審査モーダル */}
      {reviewingId && (() => {
        const req = requests.find(r => r.id === reviewingId)!
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
              <h2 className="font-semibold text-gray-800">早出申請の審査</h2>
              <div className="bg-gray-50 rounded-xl p-3 text-sm space-y-1.5">
                <div><span className="text-gray-500">申請者:</span> {staffNames[req.user_id]}</div>
                <div><span className="text-gray-500">日付:</span> {req.date}</div>
                <div><span className="text-gray-500">開始時刻:</span> {req.start_time?.slice(0,5)}</div>
                <div><span className="text-gray-500">理由:</span> {req.reason}</div>
              </div>
              <div>
                <label className="label">コメント（任意）</label>
                <input className="input" value={adminNote}
                  onChange={e => setAdminNote(e.target.value)} placeholder="スタッフへのコメント" />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setReviewingId(null)} className="btn-secondary flex-1 text-sm">閉じる</button>
                <button onClick={() => handleReject(req.id)} disabled={saving} className="btn-danger flex-1 text-sm">却下</button>
                <button onClick={() => handleApprove(req)} disabled={saving} className="btn-primary flex-1 text-sm">
                  {saving ? '処理中...' : '承認'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* 直接登録モーダル */}
      {showDirectForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="font-semibold text-gray-800">早出を直接登録（承認済）</h2>
            <div>
              <label className="label">スタッフ</label>
              <select className="select" value={directForm.user_id}
                onChange={e => setDirectForm(f => ({ ...f, user_id: e.target.value }))}>
                <option value="">— 選択してください —</option>
                {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">日付</label>
                <input type="date" className="input" value={directForm.date}
                  onChange={e => setDirectForm(f => ({ ...f, date: e.target.value }))} />
              </div>
              <div>
                <label className="label">開始時刻</label>
                <input type="time" className="input" value={directForm.start_time}
                  onChange={e => setDirectForm(f => ({ ...f, start_time: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="label">理由（任意）</label>
              <input className="input" value={directForm.reason}
                onChange={e => setDirectForm(f => ({ ...f, reason: e.target.value }))}
                placeholder="例: 手術準備のため" />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowDirectForm(false)} className="btn-secondary flex-1">キャンセル</button>
              <button onClick={handleDirectRegister} disabled={saving || !directForm.user_id || !directForm.start_time}
                className="btn-primary flex-1">
                {saving ? '登録中...' : '承認済みで登録'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
