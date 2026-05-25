import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/lib/auth'
import { supabase, Profile, Department } from '@/lib/supabase'

const roleOptions = [
  { value: 'staff', label: 'スタッフ' },
  { value: 'leader', label: 'リーダー' },
  { value: 'admin', label: '院長' },
]

const employmentOptions = [
  { value: 'full_time', label: '正社員' },
  { value: 'part_time', label: 'パート・アルバイト' },
]

const roleBadge = (role: string) => ({
  admin: 'bg-amber-100 text-amber-700',
  leader: 'bg-blue-100 text-blue-700',
  staff: 'bg-emerald-100 text-emerald-700',
}[role] ?? 'bg-gray-100 text-gray-600')

const roleLabel = (role: string) => ({ admin: '院長', leader: 'リーダー', staff: 'スタッフ' }[role] ?? role)

export default function StaffPage() {
  const { user, profile, loading, isAdmin } = useAuth()
  const router = useRouter()

  const [staff, setStaff] = useState<Profile[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [showInvite, setShowInvite] = useState(false)
  const [editStaff, setEditStaff] = useState<Profile | null>(null)
  const [inviteForm, setInviteForm] = useState({ email: '', name: '', role: 'staff', department_id: '', employment_type: 'full_time', annual_leave_days: 10 })
  const [editForm, setEditForm] = useState({ role: 'staff', department_id: '', employment_type: 'full_time', annual_leave_days: 10 })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [user, loading])

  useEffect(() => {
    if (!loading && profile && !isAdmin) router.replace('/dashboard')
  }, [loading, profile, isAdmin])

  useEffect(() => {
    if (profile) {
      fetchStaff()
      fetchDepartments()
    }
  }, [profile])

  const fetchStaff = async () => {
    const { data } = await supabase.from('profiles').select('*, departments(*)').order('name')
    setStaff(data ?? [])
  }

  const fetchDepartments = async () => {
    const { data } = await supabase.from('departments').select('*').order('name')
    setDepartments(data ?? [])
  }

  const handleInvite = async () => {
    if (!inviteForm.email || !inviteForm.name) { setError('メールと名前は必須です'); return }
    setSaving(true)
    setError('')
    const { data, error: err } = await supabase.auth.signUp({
      email: inviteForm.email,
      password: Math.random().toString(36).slice(-12) + 'Aa1!',
      options: {
        data: {
          name: inviteForm.name,
          role: inviteForm.role,
          department_id: inviteForm.department_id || null,
        },
        emailRedirectTo: window.location.origin + '/login',
      }
    })
    if (err) { setError(err.message); setSaving(false); return }
    if (data.user) {
      await supabase.from('profiles').update({
        employment_type: inviteForm.employment_type,
        annual_leave_days: inviteForm.annual_leave_days,
        department_id: inviteForm.department_id || null,
      }).eq('id', data.user.id)
    }
    setSaving(false)
    setSuccess(`${inviteForm.name} さんへ確認メールを送信しました`)
    setShowInvite(false)
    setInviteForm({ email: '', name: '', role: 'staff', department_id: '', employment_type: 'full_time', annual_leave_days: 10 })
    fetchStaff()
  }

  const handleEdit = async () => {
    if (!editStaff) return
    setSaving(true)
    await supabase.from('profiles').update({
      role: editForm.role,
      department_id: editForm.department_id || null,
      employment_type: editForm.employment_type,
      annual_leave_days: editForm.annual_leave_days,
    }).eq('id', editStaff.id)
    setSaving(false)
    setEditStaff(null)
    fetchStaff()
  }

  const openEdit = (s: Profile) => {
    setEditStaff(s)
    setEditForm({
      role: s.role,
      department_id: s.department_id ?? '',
      employment_type: s.employment_type,
      annual_leave_days: s.annual_leave_days,
    })
  }

  if (loading || !profile) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-4xl animate-pulse">🏥</div>
    </div>
  )

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">👥 スタッフ管理</h1>
          <button onClick={() => { setShowInvite(true); setError('') }} className="btn-primary text-sm">＋ スタッフ招待</button>
        </div>

        {success && (
          <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 text-sm rounded-lg px-4 py-3">{success}</div>
        )}

        <div className="card p-0 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="table-th">名前</th>
                <th className="table-th">ロール</th>
                <th className="table-th">部署</th>
                <th className="table-th">雇用形態</th>
                <th className="table-th">有給</th>
                <th className="table-th"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {staff.map(s => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="table-td">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-clinic-100 text-clinic-700 flex items-center justify-center text-xs font-bold">
                        {s.name[0]}
                      </div>
                      <div>
                        <div className="font-medium">{s.name}</div>
                        <div className="text-xs text-gray-400">{s.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="table-td">
                    <span className={`badge ${roleBadge(s.role)}`}>{roleLabel(s.role)}</span>
                  </td>
                  <td className="table-td text-gray-500">{(s as any).departments?.name ?? '—'}</td>
                  <td className="table-td text-gray-500">{s.employment_type === 'full_time' ? '正社員' : 'パート'}</td>
                  <td className="table-td">
                    <span className="text-clinic-600 font-medium">{s.annual_leave_days - s.used_leave_days}</span>
                    <span className="text-gray-400 text-xs">/{s.annual_leave_days}日</span>
                  </td>
                  <td className="table-td">
                    <button onClick={() => openEdit(s)} className="btn-secondary text-xs px-2 py-1">編集</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="font-semibold text-gray-800">スタッフ招待</h2>
            <div>
              <label className="label">メールアドレス <span className="text-red-400">*</span></label>
              <input type="email" className="input" value={inviteForm.email}
                onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))} placeholder="staff@clinic.jp" />
            </div>
            <div>
              <label className="label">氏名 <span className="text-red-400">*</span></label>
              <input className="input" value={inviteForm.name}
                onChange={e => setInviteForm(f => ({ ...f, name: e.target.value }))} placeholder="山田 花子" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">ロール</label>
                <select className="select" value={inviteForm.role}
                  onChange={e => setInviteForm(f => ({ ...f, role: e.target.value }))}>
                  {roleOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label">部署</label>
                <select className="select" value={inviteForm.department_id}
                  onChange={e => setInviteForm(f => ({ ...f, department_id: e.target.value }))}>
                  <option value="">— 未設定 —</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">雇用形態</label>
                <select className="select" value={inviteForm.employment_type}
                  onChange={e => setInviteForm(f => ({ ...f, employment_type: e.target.value }))}>
                  {employmentOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label">有給付与日数</label>
                <input type="number" className="input" min={0} max={40} value={inviteForm.annual_leave_days}
                  onChange={e => setInviteForm(f => ({ ...f, annual_leave_days: Number(e.target.value) }))} />
              </div>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-3 pt-1">
              <button onClick={() => setShowInvite(false)} className="btn-secondary flex-1">キャンセル</button>
              <button onClick={handleInvite} disabled={saving} className="btn-primary flex-1">
                {saving ? '招待中...' : '招待メール送信'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="font-semibold text-gray-800">{editStaff.name} の設定変更</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">ロール</label>
                <select className="select" value={editForm.role}
                  onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}>
                  {roleOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label">部署</label>
                <select className="select" value={editForm.department_id}
                  onChange={e => setEditForm(f => ({ ...f, department_id: e.target.value }))}>
                  <option value="">— 未設定 —</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">雇用形態</label>
                <select className="select" value={editForm.employment_type}
                  onChange={e => setEditForm(f => ({ ...f, employment_type: e.target.value }))}>
                  {employmentOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label">有給付与日数</label>
                <input type="number" className="input" min={0} max={40} value={editForm.annual_leave_days}
                  onChange={e => setEditForm(f => ({ ...f, annual_leave_days: Number(e.target.value) }))} />
              </div>
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={() => setEditStaff(null)} className="btn-secondary flex-1">キャンセル</button>
              <button onClick={handleEdit} disabled={saving} className="btn-primary flex-1">
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
