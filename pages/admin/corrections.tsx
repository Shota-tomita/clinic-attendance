import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'

const FIELD_LABELS: Record<string, string> = {
  am_clock_in: '午前出勤',
  am_clock_out: '午前退勤',
  pm_clock_in: '午後出勤',
  pm_clock_out: '午後退勤',
}

const STATUS_LABELS: Record<string, string> = {
  pending: '審査中',
  approved: '承認済',
  rejected: '却下',
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-600',
}

export default function CorrectionsAdminPage() {
  const { user, profile, loading, isAdmin } = useAuth()
  const router = useRouter()

  const [corrections, setCorrections] = useState<any[]>([])
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [adminNote, setAdminNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState<'pending' | 'all'>('pending')

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
    else if (!loading && profile && !isAdmin) router.replace('/dashboard')
  }, [user, loading, profile, isAdmin])

  useEffect(() => {
    if (isAdmin) fetchCorrections()
  }, [isAdmin])

  const fetchCorrections = async () => {
    const { data } = await supabase
      .from('attendance_corrections')
      .select('*, profiles(name, department_id)')
      .order('created_at', { ascending: false })
    setCorrections(data ?? [])
  }

  const formatTime = (iso: string | null) => {
    if (!iso) return '未打刻'
    return format(new Date(iso), 'HH:mm')
  }

  const handleApprove = async (correction: any) => {
    setSaving(true)

    // 打刻データを修正
    const { data: record } = await supabase
      .from('attendance_records')
      .select('id')
      .eq('user_id', correction.user_id)
      .eq('date', correction.date)
      .single()

    if (record) {
      // 既存レコードを更新
      await supabase.from('attendance_records')
        .update({ [correction.field]: correction.new_value })
        .eq('id', record.id)
    } else {
      // レコードがない場合は新規作成
      const insertData: any = {
        user_id: correction.user_id,
        date: correction.date,
        status: 'present',
        clock_out_reason: 'normal',
        early_finish_status: 'not_required',
        [correction.field]: correction.new_value,
      }
      // clock_in/clock_outも更新（後方互換）
      if (correction.field === 'am_clock_in') insertData.clock_in = correction.new_value
      if (correction.field === 'pm_clock_out') insertData.clock_out = correction.new_value
      await supabase.from('attendance_records').insert(insertData)
    }

    // 申請を承認
    await supabase.from('attendance_corrections').update({
      status: 'approved',
      reviewed_by: user!.id,
      reviewed_at: new Date().toISOString(),
      admin_note: adminNote || null,
    }).eq('id', correction.id)

    setSaving(false)
    setReviewingId(null)
    setAdminNote('')
    fetchCorrections()
  }

  const handleReject = async (correctionId: string) => {
    setSaving(true)
    await supabase.from('attendance_corrections').update({
      status: 'rejected',
      reviewed_by: user!.id,
      reviewed_at: new Date().toISOString(),
      admin_note: adminNote || null,
    }).eq('id', correctionId)
    setSaving(false)
    setReviewingId(null)
    setAdminNote('')
    fetchCorrections()
  }

  const filtered = corrections.filter(c => filter === 'all' || c.status === 'pending')
  const pendingCount = corrections.filter(c => c.status === 'pending').length

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
            <h1 className="text-xl font-semibold text-gray-900">📝 打刻修正申請管理</h1>
            {pendingCount > 0 && (
              <p className="text-xs text-amber-600 mt-0.5">⚠️ 審査待ち {pendingCount}件</p>
            )}
          </div>
          <div className="flex gap-2">
            {(['pending', 'all'] as const).map(f => (
              <button key={f}
                onClick={() => setFilter(f)}
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
            ) : filtered.map(c => (
              <div key={c.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-800">
                        {c.profiles?.name}
                      </span>
                      <span className="text-xs text-gray-400">
                        {c.date} / {FIELD_LABELS[c.field]}
                      </span>
                    </div>
                    <div className="text-xs text-gray-600 mt-0.5">
                      <span className="text-gray-400">修正:</span>{' '}
                      {formatTime(c.old_value)} → <span className="font-medium text-clinic-600">{formatTime(c.new_value)}</span>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">理由: {c.reason}</div>
                    {c.admin_note && (
                      <div className="text-xs text-blue-600 mt-0.5">コメント: {c.admin_note}</div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className={`badge ${STATUS_COLORS[c.status]}`}>
                      {STATUS_LABELS[c.status]}
                    </span>
                    {c.status === 'pending' && (
                      <button onClick={() => { setReviewingId(c.id); setAdminNote('') }}
                        className="btn-secondary text-xs px-2 py-1">
                        審査
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 審査モーダル */}
      {reviewingId && (() => {
        const c = corrections.find(c => c.id === reviewingId)!
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
              <h2 className="font-semibold text-gray-800">打刻修正申請の審査</h2>
              <div className="bg-gray-50 rounded-xl p-3 text-sm space-y-1.5">
                <div><span className="text-gray-500">申請者:</span> {c.profiles?.name}</div>
                <div><span className="text-gray-500">日付:</span> {c.date}</div>
                <div><span className="text-gray-500">項目:</span> {FIELD_LABELS[c.field]}</div>
                <div>
                  <span className="text-gray-500">修正内容:</span>{' '}
                  {formatTime(c.old_value)} → <span className="font-medium text-clinic-600">{formatTime(c.new_value)}</span>
                </div>
                <div><span className="text-gray-500">理由:</span> {c.reason}</div>
              </div>
              <div>
                <label className="label">管理者コメント（任意）</label>
                <input className="input" value={adminNote}
                  onChange={e => setAdminNote(e.target.value)}
                  placeholder="スタッフへのコメント" />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setReviewingId(null)} className="btn-secondary flex-1 text-sm">閉じる</button>
                <button onClick={() => handleReject(c.id)} disabled={saving}
                  className="btn-danger flex-1 text-sm">却下</button>
                <button onClick={() => handleApprove(c)} disabled={saving}
                  className="btn-primary flex-1 text-sm">
                  {saving ? '処理中...' : '承認'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </Layout>
  )
}
