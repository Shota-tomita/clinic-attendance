import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { format, parseISO } from 'date-fns'
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

export default function CorrectionPage() {
  const { user, profile, loading } = useAuth()
  const router = useRouter()

  const [corrections, setCorrections] = useState<any[]>([])
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [existingRecord, setExistingRecord] = useState<any>(null)

  const [form, setForm] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    field: 'am_clock_in',
    new_time: '',
    reason: '',
  })

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [user, loading])

  useEffect(() => {
    if (user) fetchCorrections()
  }, [user])

  useEffect(() => {
    if (form.date) fetchExistingRecord(form.date)
  }, [form.date])

  const fetchCorrections = async () => {
    const { data } = await supabase
      .from('attendance_corrections')
      .select('*')
      .eq('user_id', user!.id)
      .order('created_at', { ascending: false })
    setCorrections(data ?? [])
  }

  const fetchExistingRecord = async (date: string) => {
    const { data } = await supabase
      .from('attendance_records')
      .select('*')
      .eq('user_id', user!.id)
      .eq('date', date)
      .single()
    setExistingRecord(data ?? null)
  }

  const getCurrentValue = (field: string) => {
    if (!existingRecord) return null
    return existingRecord[field] ?? null
  }

  const handleSubmit = async () => {
    if (!form.new_time) { setError('修正後の時刻を入力してください'); return }
    if (!form.reason.trim()) { setError('理由を入力してください'); return }

    setSaving(true)
    setError('')

    const newValue = `${form.date}T${form.new_time}:00+09:00`
    const oldValue = getCurrentValue(form.field)

    const { error: err } = await supabase.from('attendance_corrections').insert({
      user_id: user!.id,
      date: form.date,
      field: form.field,
      old_value: oldValue,
      new_value: newValue,
      reason: form.reason,
      status: 'pending',
    })

    setSaving(false)
    if (err) { setError(err.message); return }

    setShowForm(false)
    setForm({ date: format(new Date(), 'yyyy-MM-dd'), field: 'am_clock_in', new_time: '', reason: '' })
    fetchCorrections()
  }

  const formatTime = (iso: string | null) => {
    if (!iso) return '未打刻'
    return format(new Date(iso), 'HH:mm')
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
            <h1 className="text-xl font-semibold text-gray-900">📝 打刻修正申請</h1>
            <p className="text-xs text-gray-400 mt-0.5">打刻ミスがあった場合はこちらから申請してください</p>
          </div>
          <button onClick={() => { setShowForm(true); setError('') }} className="btn-primary text-sm">
            ＋ 新規申請
          </button>
        </div>

        {/* 申請一覧 */}
        <div className="card p-0 overflow-hidden">
          <div className="divide-y divide-gray-50">
            {corrections.length === 0 ? (
              <div className="text-center py-10 text-gray-400 text-sm">申請がありません</div>
            ) : corrections.map(c => (
              <div key={c.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800">
                        {c.date} / {FIELD_LABELS[c.field]}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {c.old_value ? formatTime(c.old_value) : '未打刻'} → {formatTime(c.new_value)}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">理由: {c.reason}</div>
                    {c.admin_note && (
                      <div className="text-xs text-blue-600 mt-0.5">管理者コメント: {c.admin_note}</div>
                    )}
                  </div>
                  <span className={`badge ${STATUS_COLORS[c.status]}`}>
                    {STATUS_LABELS[c.status]}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 申請フォーム */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/40 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4 my-8">
            <h2 className="font-semibold text-gray-800">打刻修正申請</h2>

            <div>
              <label className="label">日付</label>
              <input type="date" className="input" value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            </div>

            {/* 既存の打刻状況 */}
            {existingRecord && (
              <div className="bg-gray-50 rounded-xl p-3 text-sm space-y-1">
                <div className="text-xs font-medium text-gray-500 mb-1.5">現在の打刻状況</div>
                {Object.entries(FIELD_LABELS).map(([key, label]) => (
                  <div key={key} className="flex justify-between">
                    <span className="text-gray-500">{label}</span>
                    <span className={existingRecord[key] ? 'text-gray-700' : 'text-gray-300'}>
                      {formatTime(existingRecord[key])}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {!existingRecord && form.date && (
              <div className="bg-amber-50 rounded-xl p-3 text-xs text-amber-700">
                ⚠️ この日の打刻記録がありません。打刻漏れの場合も申請できます。
              </div>
            )}

            <div>
              <label className="label">修正する項目</label>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(FIELD_LABELS).map(([key, label]) => (
                  <button key={key}
                    onClick={() => setForm(f => ({ ...f, field: key }))}
                    className={`py-2.5 rounded-xl text-sm font-medium border-2 transition-all
                      ${form.field === key
                        ? 'border-clinic-500 bg-clinic-50 text-clinic-700'
                        : 'border-gray-200 text-gray-500'}`}>
                    {label}
                    {existingRecord?.[key] && (
                      <div className="text-xs mt-0.5 opacity-70">{formatTime(existingRecord[key])}</div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="label">修正後の時刻</label>
              <input type="time" className="input" value={form.new_time}
                onChange={e => setForm(f => ({ ...f, new_time: e.target.value }))} />
            </div>

            <div>
              <label className="label">理由 <span className="text-red-400">*</span></label>
              <textarea className="input resize-none" rows={3}
                value={form.reason}
                onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                placeholder="例: 打刻を忘れてしまいました。実際は8:45に出勤しました。" />
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
