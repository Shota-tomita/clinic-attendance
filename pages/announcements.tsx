import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { format, parseISO } from 'date-fns'
import { ja } from 'date-fns/locale'

type Announcement = {
  id: string
  title: string
  content: string
  is_pinned: boolean
  target_roles: string[]
  created_by: string | null
  created_at: string
  profiles?: { name: string }
}

export default function AnnouncementsPage() {
  const { user, profile, loading, isAdmin } = useAuth()
  const router = useRouter()
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ title: '', content: '', is_pinned: false })
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [user, loading])

  useEffect(() => {
    if (user) {
      fetchAnnouncements()
      markRead()
    }
  }, [user])

  const fetchAnnouncements = async () => {
    const { data } = await supabase
      .from('announcements')
      .select('*, profiles(name)')
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
    setAnnouncements(data ?? [])
  }

  const markRead = async () => {
    // 未読を既読にする
    const { data } = await supabase.from('announcements').select('id')
    for (const a of data ?? []) {
      await supabase.from('announcement_reads').upsert({
        announcement_id: a.id,
        user_id: user?.id,
      }, { onConflict: 'announcement_id,user_id' })
    }
  }

  const handleSave = async () => {
    if (!form.title.trim() || !form.content.trim()) return
    setSaving(true)
    await supabase.from('announcements').insert({
      title: form.title,
      content: form.content,
      is_pinned: form.is_pinned,
      created_by: user?.id,
    })
    setSaving(false)
    setShowForm(false)
    setForm({ title: '', content: '', is_pinned: false })
    fetchAnnouncements()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このお知らせを削除しますか？')) return
    await supabase.from('announcements').delete().eq('id', id)
    fetchAnnouncements()
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
          <h1 className="text-xl font-semibold text-gray-900">📣 お知らせ</h1>
          {isAdmin && (
            <button onClick={() => setShowForm(true)} className="btn-primary text-sm">
              ＋ 投稿する
            </button>
          )}
        </div>

        {announcements.length === 0 && (
          <div className="card text-center py-12 text-gray-400 text-sm">
            お知らせはありません
          </div>
        )}

        <div className="space-y-3">
          {announcements.map(a => (
            <div
              key={a.id}
              className={`card cursor-pointer transition-all hover:shadow-md
                ${a.is_pinned ? 'border-l-4 border-l-amber-400' : ''}`}
              onClick={() => setExpanded(expanded === a.id ? null : a.id)}
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {a.is_pinned && (
                      <span className="badge bg-amber-100 text-amber-700 text-[10px]">📌 固定</span>
                    )}
                    <h3 className="font-semibold text-gray-800 text-sm">{a.title}</h3>
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {a.profiles?.name ?? '院長'} ·{' '}
                    {format(parseISO(a.created_at), 'M月d日(EEE)', { locale: ja })}
                  </div>

                  {/* 展開時 */}
                  {expanded === a.id && (
                    <div className="mt-3 text-sm text-gray-700 whitespace-pre-line border-t border-gray-100 pt-3">
                      {a.content}
                    </div>
                  )}
                  {expanded !== a.id && (
                    <p className="text-xs text-gray-500 mt-1 truncate">{a.content}</p>
                  )}
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className="text-gray-400 text-xs">
                    {expanded === a.id ? '▲' : '▼'}
                  </span>
                  {isAdmin && (
                    <button
                      onClick={e => { e.stopPropagation(); handleDelete(a.id) }}
                      className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 ml-1"
                    >
                      削除
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 投稿フォーム */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 className="font-semibold text-gray-800">お知らせを投稿</h2>
            <div>
              <label className="label">タイトル <span className="text-red-400">*</span></label>
              <input className="input" value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="例: 年末年始のシフトについて" />
            </div>
            <div>
              <label className="label">内容 <span className="text-red-400">*</span></label>
              <textarea className="input resize-none" rows={5}
                value={form.content}
                onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                placeholder="お知らせ内容を入力してください" />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="pin" checked={form.is_pinned}
                onChange={e => setForm(f => ({ ...f, is_pinned: e.target.checked }))}
                className="w-4 h-4 accent-clinic-600" />
              <label htmlFor="pin" className="text-sm text-gray-700">📌 上部に固定表示する</label>
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={() => setShowForm(false)} className="btn-secondary flex-1">キャンセル</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">
                {saving ? '投稿中...' : '投稿する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
