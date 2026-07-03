import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/lib/auth'
import { supabase, Profile, Department } from '@/lib/supabase'

// 部署固定順
const DEPT_ORDER = ['看護師', 'ORT', '受付', '助手']
function getDeptOrder(name: string | undefined | null) {
  const i = DEPT_ORDER.indexOf(name ?? '')
  return i === -1 ? DEPT_ORDER.length : i
}

const CLINIC_ORDER = ['tomita', 'joyama']
const CLINIC_LABEL: Record<string, string> = { tomita: '富田眼科', joyama: '城山コンタクト' }
function getClinicOrder(clinic: string | undefined | null) {
  const i = CLINIC_ORDER.indexOf(clinic ?? '')
  return i === -1 ? CLINIC_ORDER.length : i
}

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

// 有給付与計算ユーティリティ
const FULL_TIME_TABLE: Record<number,number> = {6:10,18:11,30:12,42:14,54:16,66:18,78:20}
const PART_TIME_TABLE: Record<number,Record<number,number>> = {
  4:{6:7,18:8,30:9,42:10,54:12,66:13,78:15},
  3:{6:5,18:6,30:6,42:8,54:9,66:10,78:11},
  2:{6:3,18:4,30:4,42:5,54:6,66:6,78:7},
  1:{6:1,18:2,30:2,42:2,54:3,66:3,78:3},
}
function calcGrantDays(empType: string, weekDays: number, tenureMonths: number): number {
  const table = empType === 'full_time' ? FULL_TIME_TABLE : (PART_TIME_TABLE[Math.min(weekDays,4)] ?? PART_TIME_TABLE[1])
  const thresholds = Object.keys(table).map(Number).sort((a,b) => a-b)
  let days = 0
  for (const t of thresholds) { if (tenureMonths >= t) days = table[t] }
  return days
}
function calcNextGrantDate(hireDate: string): Date {
  const hire = new Date(hireDate)
  const next = new Date(hire)
  next.setMonth(next.getMonth() + 6)
  const today = new Date()
  while (next <= today) next.setFullYear(next.getFullYear() + 1)
  return next
}
function calcTenureMonths(hireDate: string): number {
  const hire = new Date(hireDate)
  const today = new Date()
  return (today.getFullYear()-hire.getFullYear())*12 + (today.getMonth()-hire.getMonth())
}

export default function StaffPage() {
  const { user, profile, loading, isAdmin } = useAuth()
  const router = useRouter()

  const [staff, setStaff] = useState<Profile[]>([])
  const [sortKey, setSortKey] = useState<'department' | 'employment' | 'hire_date' | 'role'>('department')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [departments, setDepartments] = useState<Department[]>([])
  const [showInvite, setShowInvite] = useState(false)
  const [editStaff, setEditStaff] = useState<Profile | null>(null)
  const [inviteForm, setInviteForm] = useState({ email: '', name: '', role: 'staff', department_id: '', employment_type: 'full_time', annual_leave_days: 10 })
  const [editForm, setEditForm] = useState({
    role: 'staff', department_id: '', employment_type: 'full_time', annual_leave_days: 10,
    weekly_work_days: 5,
    leader_can_approve_leave: false,
    leader_can_approve_correction: false,
    leader_can_approve_early_start: false,
    leader_can_approve_early_finish: false,
    leader_can_approve_cancel: false,
    postal_code: '',
    address: '',
    clinic: 'tomita',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [resetStaff, setResetStaff] = useState<Profile | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [resetSaving, setResetSaving] = useState(false)
  const [resetMessage, setResetMessage] = useState('')
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
      // 有給付与チェック（付与日を迎えたスタッフを自動更新）
      fetch('/api/leave-grant', { method: 'POST' }).catch(() => {})
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

  const sortedStaff = [...staff].sort((a, b) => {
    const clinicA = getClinicOrder((a as any).clinic)
    const clinicB = getClinicOrder((b as any).clinic)
    const deptA = getDeptOrder((a as any).departments?.name)
    const deptB = getDeptOrder((b as any).departments?.name)

    // 常にクリニック順を第1キーに
    if (clinicA !== clinicB) return clinicA - clinicB

    if (sortKey === 'department') {
      if (deptA !== deptB) return sortOrder === 'asc' ? deptA - deptB : deptB - deptA
      const empA = a.employment_type === 'full_time' ? 0 : 1
      const empB = b.employment_type === 'full_time' ? 0 : 1
      if (empA !== empB) return sortOrder === 'asc' ? empA - empB : empB - empA
      return a.name.localeCompare(b.name, 'ja')
    }
    let valA: any, valB: any
    if (sortKey === 'employment') {
      valA = a.employment_type; valB = b.employment_type
    } else if (sortKey === 'hire_date') {
      valA = (a as any).hire_date ?? ''; valB = (b as any).hire_date ?? ''
    } else if (sortKey === 'role') {
      const order: Record<string, number> = { admin: 0, leader: 1, staff: 2 }
      valA = order[a.role] ?? 3; valB = order[b.role] ?? 3
    }
    if (valA < valB) return sortOrder === 'asc' ? -1 : 1
    if (valA > valB) return sortOrder === 'asc' ? 1 : -1
    return deptA - deptB
  })

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
    const update: any = {
      role: editForm.role,
      department_id: editForm.department_id || null,
      employment_type: editForm.employment_type,
      annual_leave_days: editForm.annual_leave_days,
      weekly_work_days: editForm.weekly_work_days,
      postal_code: editForm.postal_code || null,
      address:     editForm.address     || null,
      clinic:      editForm.clinic,
    }
    if (editForm.role === 'leader') {
      update.leader_can_approve_leave        = editForm.leader_can_approve_leave
      update.leader_can_approve_correction   = editForm.leader_can_approve_correction
      update.leader_can_approve_early_start  = editForm.leader_can_approve_early_start
      update.leader_can_approve_early_finish = editForm.leader_can_approve_early_finish
      update.leader_can_approve_cancel       = editForm.leader_can_approve_cancel
    } else {
      // リーダー以外はすべてfalseにリセット
      update.leader_can_approve_leave        = false
      update.leader_can_approve_correction   = false
      update.leader_can_approve_early_start  = false
      update.leader_can_approve_early_finish = false
      update.leader_can_approve_cancel       = false
    }
    await supabase.from('profiles').update(update).eq('id', editStaff.id)
    setSaving(false)
    setEditStaff(null)
    fetchStaff()
  }

  const openResetPassword = (s: Profile) => {
    setResetStaff(s)
    setNewPassword('')
    setResetMessage('')
  }

  const handleResetPassword = async () => {
    if (!resetStaff || !newPassword) return
    if (newPassword.length < 8) { setResetMessage('8文字以上にしてください'); return }
    setResetSaving(true)
    const res = await fetch('/api/admin/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: resetStaff.id, newPassword }),
    })
    setResetSaving(false)
    if (res.ok) {
      setResetMessage('✅ パスワードをリセットしました')
      setNewPassword('')
    } else {
      setResetMessage('エラーが発生しました')
    }
  }

  const openEdit = (s: Profile) => {
    setEditStaff(s)
    setEditForm({
      role: s.role,
      department_id: s.department_id ?? '',
      employment_type: s.employment_type,
      annual_leave_days: s.annual_leave_days,
      weekly_work_days: (s as any).weekly_work_days ?? 5,
      leader_can_approve_leave:        (s as any).leader_can_approve_leave        ?? false,
      leader_can_approve_correction:   (s as any).leader_can_approve_correction   ?? false,
      leader_can_approve_early_start:  (s as any).leader_can_approve_early_start  ?? false,
      leader_can_approve_early_finish: (s as any).leader_can_approve_early_finish ?? false,
      leader_can_approve_cancel:       (s as any).leader_can_approve_cancel       ?? false,
      postal_code: (s as any).postal_code ?? '',
      address:     (s as any).address     ?? '',
      clinic:      (s as any).clinic      ?? 'tomita',
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

        {/* ソートUI */}
        <div className="card flex flex-wrap gap-2 items-center py-3">
          <span className="text-xs text-gray-500 font-medium">並び替え：</span>
          {([
            ['department', '部署'],
            ['employment', '雇用形態'],
            ['hire_date', '入職日'],
            ['role', 'ロール'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                if (sortKey === key) setSortOrder(o => o === 'asc' ? 'desc' : 'asc')
                else { setSortKey(key); setSortOrder('asc') }
              }}
              className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-all
                ${sortKey === key
                  ? 'bg-clinic-600 text-white border-clinic-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-clinic-400'}`}
            >
              {label} {sortKey === key ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
            </button>
          ))}
        </div>

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
              {sortedStaff.map((s, idx) => {
                const prevClinic = idx > 0 ? (sortedStaff[idx - 1] as any).clinic : null
                const curClinic = (s as any).clinic ?? 'tomita'
                const showClinicHeader = curClinic !== prevClinic
                return (
                  <>
                    {showClinicHeader && (
                      <tr key={`clinic-${curClinic}`}>
                        <td colSpan={7} className="px-4 py-2 bg-gray-100 text-xs font-semibold text-gray-500 tracking-wide">
                          🏥 {CLINIC_LABEL[curClinic] ?? curClinic}
                        </td>
                      </tr>
                    )}
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
                    {(s as any).hire_date && (() => {
                      const next = calcNextGrantDate((s as any).hire_date)
                      const months = calcTenureMonths((s as any).hire_date)
                      const grant = calcGrantDays(s.employment_type, (s as any).weekly_work_days ?? 5, months + 12)
                      const diffDays = Math.ceil((next.getTime() - new Date().getTime()) / 86400000)
                      return (
                        <div className="text-xs text-gray-400 mt-0.5">
                          次回付与: {next.toLocaleDateString('ja-JP', {month:'numeric',day:'numeric'})}
                          （{diffDays}日後・{grant}日）
                        </div>
                      )
                    })()}
                  </td>
                  <td className="table-td">
                    <div className="flex gap-1">
                      <button onClick={() => router.push(`/admin/staff-detail?id=${s.id}`)} className="btn-secondary text-xs px-2 py-1">詳細</button>
                      <button onClick={() => openEdit(s)} className="btn-secondary text-xs px-2 py-1">編集</button>
                      <button onClick={() => openResetPassword(s)} className="text-xs text-amber-500 hover:text-amber-700 px-2 py-1 rounded hover:bg-amber-50">PW</button>
                    </div>
                  </td>
                </tr>
                  </>
                )
              })}
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
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <h2 className="font-semibold text-gray-800">{editStaff.name} の設定変更</h2>
            {/* 所属クリニック */}
            <div>
              <label className="label">所属クリニック</label>
              <select className="select" value={editForm.clinic}
                onChange={e => setEditForm(f => ({ ...f, clinic: e.target.value }))}>
                <option value="tomita">富田眼科クリニック</option>
                <option value="joyama">城山コンタクト</option>
              </select>
            </div>
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
            {/* 週所定労働日数（パートのみ） */}
            {editForm.employment_type !== 'full_time' && (
              <div>
                <label className="label">週所定労働日数</label>
                <select className="select" value={editForm.weekly_work_days}
                  onChange={e => setEditForm(f => ({ ...f, weekly_work_days: Number(e.target.value) }))}>
                  <option value={1}>週1日</option>
                  <option value={2}>週2日</option>
                  <option value={3}>週3日</option>
                  <option value={4}>週4日</option>
                  <option value={5}>週5日以上</option>
                </select>
              </div>
            )}
            {/* 住所 */}
            <div className="space-y-2">
              <div>
                <label className="label">郵便番号</label>
                <input
                  className="input"
                  value={editForm.postal_code}
                  onChange={e => setEditForm(f => ({ ...f, postal_code: e.target.value }))}
                  placeholder="例: 123-4567"
                  maxLength={8}
                />
              </div>
              <div>
                <label className="label">住所</label>
                <input
                  className="input"
                  value={editForm.address}
                  onChange={e => setEditForm(f => ({ ...f, address: e.target.value }))}
                  placeholder="例: 名古屋市中村区..."
                />
              </div>
            </div>
            {editForm.role === 'leader' && (
              <div className="space-y-2">
                <label className="label">リーダー承認権限</label>
                <div className="bg-blue-50 rounded-xl p-3 space-y-2">
                  {([
                    ['leader_can_approve_leave',        '有給申請の承認'],
                    ['leader_can_approve_correction',   '打刻修正申請の承認'],
                    ['leader_can_approve_early_start',  '早出申請の承認'],
                    ['leader_can_approve_early_finish', '早上がりの承認'],
                    ['leader_can_approve_cancel',       '有給取消の承認'],
                  ] as const).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        className="w-4 h-4 rounded text-clinic-600"
                        checked={editForm[key]}
                        onChange={e => setEditForm(f => ({ ...f, [key]: e.target.checked }))}
                      />
                      <span className="text-sm text-gray-700">{label}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-gray-400">※ 自分の部署のスタッフのみ。自身の申請は院長のみ承認可能。</p>
              </div>
            )}
            <div className="flex gap-3 pt-1">
              <button onClick={() => setEditStaff(null)} className="btn-secondary flex-1">キャンセル</button>
              <button onClick={handleEdit} disabled={saving} className="btn-primary flex-1">
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {resetStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="font-semibold text-gray-800">パスワードリセット</h2>
            <p className="text-sm text-gray-500">{resetStaff.name} さんのパスワードを変更します</p>
            <div>
              <label className="label">新しいパスワード（8文字以上）</label>
              <input
                type="text"
                className="input font-mono"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="例: Clinic2026!"
              />
            </div>
            {resetMessage && (
              <div className={"text-sm px-3 py-2 rounded-lg " + (resetMessage.includes('✅') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600')}>
                {resetMessage}
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={() => setResetStaff(null)} className="btn-secondary flex-1">閉じる</button>
              <button onClick={handleResetPassword} disabled={resetSaving} className="btn-primary flex-1">
                {resetSaving ? 'リセット中...' : 'リセット'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
