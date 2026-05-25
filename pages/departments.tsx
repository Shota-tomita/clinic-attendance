import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/lib/auth'
import { supabase, Department } from '@/lib/supabase'

export default function DepartmentsPage() {
  const { user, profile, loading, isAdmin } = useAuth()
  const router = useRouter()
  const [departments, setDepartments] = useState<Department[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Department | null>(null)
  const [form, setForm] = useState({ name: '', description: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [user, loading])

  useEffect(() => {
    if (!loading && profile && !isAdmin) router.replace('/dashboard')
  }, [loading, profile, isAdmin])

  useEffect(() => {
    if (profile) fetchDepts()
  }, [profile])

  const fetchDepts = async () => {
    const { data } = await supabase.from('departments').select('*').order('name')
    setDepartments(data ?? [])
  }

  const openCreate = () => {
    setEditing(null)
    setForm({ name: '', description: '' })
    setError('')
    setShowForm(true)
  }

  const openEdit = (d: Department) => {
    setEditing(d)
    setForm({ name: d.name, description: d.description ?? '' })
    setError('')
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.name.trim()) { setError('部署名を入力してください'); return }
    setSaving(true)
    const payload = { name: form.name.trim(), description: form.description.trim() || null }
    if (editing) {
      await supabase.from('departments').update(payload).eq('id', editing.id)
    } else {
      await supabase.from('departments').insert(payload)
    }
    setSaving(false)
    setShowForm(false)
    fetchDepts()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('この部署を削除しますか？')) return
    await supabase.from('departments').delete().eq('id', id)
    fetchDepts()
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
          <h1 className="text-xl font-semibold text-gray-900">🏢 部署管理</h1>
          <button onClick={openCreate} className="btn-primary text-sm">＋ 部署追加</button>
        </div>

        <div className="space-y-3">
          {departments.length === 0 && (
            <div className="card text-center py-10 text-gray-400 text-sm">部署がまだありません</div>
          )}
          {departments.map(d => (
            <div key={d.id} className="card flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-clinic-100 flex items-center justify-center text-clinic-700 text-lg font-bold">
                🏢
              </div>
              <div className="flex-1">
                <div className="font-medium text-gray-800">{d.name}</div>
                {d.description && <div className="text-xs text-gray-400 mt-0.5">{d.description}</div>}
              </div>
              <div className="flex gap-2">
                <button onClick={() => openEdit(d)} className="btn-secondary text-xs px-3 py-1.5">編集</button>
                <button onClick={() => handleDelete(d.id)} className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50">削除</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="font-semibold text-gray-800">{editing ? '部署編集' : '部署追加'}</h2>
            <div>
              <label className="label">部署名 <span className="text-red-400">*</span></label>
              <input className="input" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="例: 受付・事務" />
            </div>
            <div>
              <label className="label">説明（任意）</label>
              <input className="input" value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="例: 受付・医療事務担当" />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-3 pt-1">
              <button onClick={() => setShowForm(false)} className="btn-secondary flex-1">キャンセル</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
