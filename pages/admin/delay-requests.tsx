// pages/admin/delay-requests.tsx
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

const STATUS_LABELS: Record<string, string> = {
  pending: '審査中', approved: '承認済', rejected: '却下',
}
const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-600',
}

export default function AdminDelayRequestsPage() {
  const { user, profile, loading, isAdmin } = useAuth()
  const router = useRouter()

  const [requests, setRequests] = useState<any[]>([])
  const [staffNames, setStaffNames] = useState<Record<string, string>>({})
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [approvedMinutes, setApprovedMinutes] = useState('')
  const [adminNote, setAdminNote] = useState('')
  const [certUrl, setCertUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState<'pending' | 'all'>('pending')
  const [staffList, setStaffList] = useState<any[]>([])
  const [showDirectForm, setShowDirectForm] = useState(false)
  const [directForm, setDirectForm] = useState({
    user_id: '',
    date: '',
    approved_minutes: '',
    admin_note: '',
  })

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
    else if (!loading && profile && !isAdmin) router.replace('/dashboard')
  }, [user, loading, profile, isAdmin])

  useEffect(() => {
    if (isAdmin) { fetchRequests(); fetchStaffNames(); fetchStaffList() }
  }, [isAdmin])

  const fetchRequests = async () => {
    const { data } = await supabase
      .from('delay_requests')
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

  const openReview = async (req: any) => {
    setReviewingId(req.id)
    setApprovedMinutes(String(req.requested_minutes ?? ''))
    setAdminNote('')
    setCertUrl(null)
    if (req.certificate_url) {
      const { data } = await supabase.storage
        .from('delay-certificates')
        .createSignedUrl(req.certificate_url, 3600)
      setCertUrl(data?.signedUrl ?? null)
    }
  }

  const handleApprove = async (req: any) => {
    if (approvedMinutes === '') { alert('承認する分数を入力してください'); return }
    setSaving(true)
    await supabase.from('delay_requests').update({
      status: 'approved',
      approved_minutes: Number(approvedMinutes),
      reviewed_by: user!.id,
      reviewed_at: new Date().toISOString(),
      admin_note: adminNote || null,
    }).eq('id', req.id)
    setSaving(false)
    setReviewingId(null)
    fetchRequests()
  }

  const handleReject = async (id: string) => {
    setSaving(true)
    await supabase.from('delay_requests').update({
      status: 'rejected',
      reviewed_by: user!.id,
      reviewed_at: new Date().toISOString(),
      admin_note: adminNote || null,
    }).eq('id', id)
    setSaving(false)
    setReviewingId(null)
    fetchRequests()
  }

  // 管理者が申請なしで直接、遅刻を打ち消す（承認済みとして登録）
  const handleDirectRegister = async () => {
    if (!directForm.user_id || !directForm.date || directForm.approved_minutes === '') {
      alert('スタッフ・日付・免除分数を入力してください')
      return
    }
    setSaving(true)
    await supabase.from('delay_requests').upsert({
      user_id: directForm.user_id,
      date: directForm.date,
      requested_minutes: Number(directForm.approved_minutes),
      approved_minutes: Number(directForm.approved_minutes),
      reason: '院長による直接登録（申請なし）',
      status: 'approved',
      reviewed_by: user!.id,
      reviewed_at: new Date().toISOString(),
      admin_note: directForm.admin_note || null,
    }, { onConflict: 'user_id,date' })
    setSaving(false)
    setShowDirectForm(false)
    setDirectForm({ user_id: '', date: '', approved_minutes: '', admin_note: '' })
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
            <h1 className="text-xl font-semibold text-gray-900">🚃 電車遅延申請管理</h1>
            {pendingCount > 0 && <p className="text-xs text-amber-600 mt-0.5">⚠️ 審査待ち {pendingCount}件</p>}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowDirectForm(true)} className="btn-secondary text-sm">＋ 直接打ち消し</button>
            {(['pending', 'all'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-all
                  ${filter === f ? 'bg-clinic-600 text-white border-clinic-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                {f === 'pending' ? '審査待ち' : 'すべて'}
              </button>
            ))}
          </div>
        </div>

        <p className="text-xs text-gray-400 -mt-3">
          承認した分数だけ、その日の遅刻時間から控除されます。残った遅刻時間があれば遅刻回数としてカウントされます。
          申請がなくても「＋直接打ち消し」から管理者が遅刻を打ち消せます。
        </p>

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
                    <span className="text-xs text-gray-400">{r.date}</span>
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                      証明書{r.certificate_minutes ?? '—'}分 / 申請{r.requested_minutes}分
                    </span>
                  </div>
                  {r.reason && <div className="text-xs text-gray-400 mt-0.5">理由: {r.reason}</div>}
                  {r.status === 'approved' && (
                    <div className="text-xs text-emerald-600 mt-0.5">承認: {r.approved_minutes}分</div>
                  )}
                  {r.admin_note && <div className="text-xs text-blue-600 mt-0.5">コメント: {r.admin_note}</div>}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={`badge ${STATUS_COLORS[r.status]}`}>{STATUS_LABELS[r.status]}</span>
                  {r.status === 'pending' && (
                    <button onClick={() => openReview(r)} className="btn-secondary text-xs px-2 py-1">審査</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {reviewingId && (() => {
        const req = requests.find(r => r.id === reviewingId)!
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
              <h2 className="font-semibold text-gray-800">遅延申請の審査</h2>
              <div className="bg-gray-50 rounded-xl p-3 text-sm space-y-1.5">
                <div><span className="text-gray-500">申請者:</span> {staffNames[req.user_id]}</div>
                <div><span className="text-gray-500">日付:</span> {req.date}</div>
                <div><span className="text-gray-500">証明書記載分数:</span> {req.certificate_minutes ?? '—'}分</div>
                <div><span className="text-gray-500">申請分数:</span> {req.requested_minutes}分</div>
                {req.reason && <div><span className="text-gray-500">理由:</span> {req.reason}</div>}
              </div>
              {certUrl && (
                <a href={certUrl} target="_blank" rel="noreferrer" className="block">
                  <img src={certUrl} alt="遅延証明書" className="w-full rounded-lg border border-gray-200" />
                </a>
              )}
              <div>
                <label className="label">承認する免除分数 <span className="text-red-400">*</span></label>
                <input type="number" className="input" value={approvedMinutes}
                  onChange={e => setApprovedMinutes(e.target.value)} />
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

      {/* 直接打ち消しモーダル（申請なし） */}
      {showDirectForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="font-semibold text-gray-800">遅刻を直接打ち消す（申請なし）</h2>
            <p className="text-xs text-gray-400">
              スタッフからの申請がなくても、管理者の判断で遅刻分を打ち消せます。
            </p>
            <div>
              <label className="label">スタッフ</label>
              <select className="select" value={directForm.user_id}
                onChange={e => setDirectForm(f => ({ ...f, user_id: e.target.value }))}>
                <option value="">— 選択してください —</option>
                {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">日付</label>
              <input type="date" className="input" value={directForm.date}
                onChange={e => setDirectForm(f => ({ ...f, date: e.target.value }))} />
            </div>
            <div>
              <label className="label">打ち消す分数（遅刻時間から控除する分数）</label>
              <input type="number" className="input" value={directForm.approved_minutes}
                onChange={e => setDirectForm(f => ({ ...f, approved_minutes: e.target.value }))}
                placeholder="例: 15（大きい値にすれば全て打ち消せます）" />
            </div>
            <div>
              <label className="label">コメント（任意）</label>
              <input className="input" value={directForm.admin_note}
                onChange={e => setDirectForm(f => ({ ...f, admin_note: e.target.value }))}
                placeholder="打ち消す理由など" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowDirectForm(false)} className="btn-secondary flex-1 text-sm">キャンセル</button>
              <button onClick={handleDirectRegister} disabled={saving} className="btn-primary flex-1 text-sm">
                {saving ? '登録中...' : '打ち消す'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
