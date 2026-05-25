import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/lib/auth'
import { supabase, ShiftPattern, ShiftAssignment, Profile } from '@/lib/supabase'
import { getCurrentMonth, getMonthRange } from '@/lib/utils'
import {
  format, parseISO, addMonths, subMonths,
  startOfMonth, endOfMonth, eachDayOfInterval, getDay
} from 'date-fns'
import { ja } from 'date-fns/locale'

export default function ShiftPage() {
  const { user, profile, loading, isAdmin, isLeader } = useAuth()
  const router = useRouter()

  const [month, setMonth] = useState(getCurrentMonth())
  const [staffList, setStaffList] = useState<Profile[]>([])
  const [patterns, setPatterns] = useState<ShiftPattern[]>([])
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([])
  const [fetching, setFetching] = useState(false)

  // Modal state
  const [modal, setModal] = useState<{ userId: string; date: string; existing?: ShiftAssignment } | null>(null)
  const [modalPatternId, setModalPatternId] = useState('')
  const [modalNote, setModalNote] = useState('')
  const [modalSaving, setModalSaving] = useState(false)

  const canManage = isAdmin || isLeader

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [user, loading])

  useEffect(() => {
    if (!user || !profile) return
    fetchStaff()
    fetchPatterns()
  }, [user, profile])

  useEffect(() => {
    fetchAssignments()
  }, [month, staffList])

  const fetchStaff = async () => {
    let q = supabase.from('profiles').select('*, departments(*)').order('name')
    if (isLeader && profile?.department_id) {
      q = q.eq('department_id', profile.department_id)
    }
    const { data } = await q
    setStaffList(data ?? [])
  }

  const fetchPatterns = async () => {
    const { data } = await supabase.from('shift_patterns').select('*').eq('is_active', true).order('name')
    setPatterns(data ?? [])
  }

  const fetchAssignments = async () => {
    if (staffList.length === 0) return
    setFetching(true)
    const { start, end } = getMonthRange(month)
    const ids = staffList.map(s => s.id)
    const { data } = await supabase
      .from('shift_assignments')
      .select('*, shift_patterns(*)')
      .in('user_id', ids)
      .gte('date', start)
      .lte('date', end)
    setAssignments(data ?? [])
    setFetching(false)
  }

  const days = eachDayOfInterval({
    start: startOfMonth(parseISO(month + '-01')),
    end: endOfMonth(parseISO(month + '-01')),
  })

  const getAssignment = (userId: string, date: string) =>
    assignments.find(a => a.user_id === userId && a.date === date)

  const openModal = (userId: string, date: string) => {
    if (!canManage) return
    // Check: leader can only edit their dept
    if (isLeader && !isAdmin) {
      const staff = staffList.find(s => s.id === userId)
      if (!staff || staff.department_id !== profile?.department_id) return
    }
    const existing = getAssignment(userId, date)
    setModal({ userId, date, existing })
    setModalPatternId(existing?.shift_pattern_id ?? '')
    setModalNote(existing?.note ?? '')
  }

  const handleSave = async () => {
    if (!modal || !user) return
    setModalSaving(true)
    const payload = {
      user_id: modal.userId,
      date: modal.date,
      shift_pattern_id: modalPatternId || null,
      note: modalNote || null,
      assigned_by: user.id,
    }
    if (modal.existing) {
      await supabase.from('shift_assignments').update(payload).eq('id', modal.existing.id)
    } else {
      await supabase.from('shift_assignments').upsert(payload, { onConflict: 'user_id,date' })
    }
    setModalSaving(false)
    setModal(null)
    fetchAssignments()
  }

  const handleDelete = async () => {
    if (!modal?.existing) return
    await supabase.from('shift_assignments').delete().eq('id', modal.existing.id)
    setModal(null)
    fetchAssignments()
  }

  const prevMonth = () => setMonth(format(subMonths(parseISO(month + '-01'), 1), 'yyyy-MM'))
  const nextMonth = () => setMonth(format(addMonths(parseISO(month + '-01'), 1), 'yyyy-MM'))

  const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

  if (loading || !profile) return <div className="min-h-screen flex items-center justify-center"><div className="text-4xl animate-pulse">🏥</div></div>

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-xl font-semibold text-gray-900">📅 シフト管理</h1>
          {isAdmin && (
            <button onClick={() => router.push('/shift/patterns')} className="btn-secondary text-sm">
              🗂️ パターン編集（院長）
            </button>
          )}
        </div>

        {isLeader && !isAdmin && (
          <div className="text-xs text-blue-600 bg-blue-50 rounded-lg px-3 py-2">
            💡 {profile.departments?.name ?? '所属部署'} のスタッフのシフトを入力できます
          </div>
        )}

        {/* Month nav */}
        <div className="card flex items-center gap-3 py-3">
          <button onClick={prevMonth} className="btn-secondary px-3 py-1.5 text-sm">‹</button>
          <span className="text-base font-semibold text-gray-800 flex-1 text-center">
            {format(parseISO(month + '-01'), 'yyyy年M月', { locale: ja })}
          </span>
          <button onClick={nextMonth} className="btn-secondary px-3 py-1.5 text-sm">›</button>
        </div>

        {/* Legend */}
        <div className="flex gap-2 flex-wrap">
          {patterns.map(p => (
            <div key={p.id} className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: p.color }} />
              <span className="text-xs text-gray-500">{p.name} ({p.start_time.slice(0,5)}〜{p.end_time.slice(0,5)})</span>
            </div>
          ))}
        </div>

        {/* Shift table */}
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-max">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left font-medium text-gray-600 min-w-[100px]">
                    スタッフ
                  </th>
                  {days.map(d => {
                    const dow = getDay(d)
                    return (
                      <th
                        key={d.toISOString()}
                        className={`px-1 py-2 text-center font-medium min-w-[36px]
                          ${dow === 0 ? 'text-red-400' : dow === 6 ? 'text-blue-400' : 'text-gray-500'}`}
                      >
                        <div>{format(d, 'd')}</div>
                        <div className="font-normal text-[10px]">{WEEKDAYS[dow]}</div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {fetching ? (
                  <tr><td colSpan={days.length + 1} className="text-center py-8 text-gray-400">読込中...</td></tr>
                ) : staffList.length === 0 ? (
                  <tr><td colSpan={days.length + 1} className="text-center py-8 text-gray-400">スタッフがいません</td></tr>
                ) : staffList.map(staff => (
                  <tr key={staff.id} className="hover:bg-gray-50/50">
                    <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-700 border-r border-gray-100">
                      <div className="flex items-center gap-1.5">
                        <div className="w-6 h-6 rounded-full bg-clinic-100 text-clinic-700 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                          {staff.name[0]}
                        </div>
                        <span className="truncate max-w-[70px]">{staff.name}</span>
                      </div>
                    </td>
                    {days.map(d => {
                      const dateStr = format(d, 'yyyy-MM-dd')
                      const a = getAssignment(staff.id, dateStr)
                      const pat = a?.shift_patterns
                      const dow = getDay(d)
                      const isWeekend = dow === 0 || dow === 6
                      return (
                        <td
                          key={dateStr}
                          onClick={() => openModal(staff.id, dateStr)}
                          className={`px-0.5 py-1 text-center cursor-pointer transition-colors
                            ${canManage ? 'hover:bg-clinic-50' : ''}
                            ${isWeekend ? 'bg-gray-50/70' : ''}`}
                        >
                          {pat ? (
                            <div
                              className="shift-cell text-white mx-auto"
                              style={{ backgroundColor: pat.color }}
                              title={`${pat.name} ${pat.start_time.slice(0,5)}〜${pat.end_time.slice(0,5)}`}
                            >
                              {pat.name.slice(0, 2)}
                            </div>
                          ) : a ? (
                            <div className="shift-cell bg-gray-200 text-gray-600 mx-auto">手</div>
                          ) : (
                            canManage && <div className="text-gray-200 text-center">＋</div>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Assignment modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="font-semibold text-gray-800">
              シフト設定
            </h2>
            <div className="text-sm text-gray-500">
              {staffList.find(s => s.id === modal.userId)?.name} / {modal.date}
            </div>

            <div>
              <label className="label">シフトパターン</label>
              <select
                className="select"
                value={modalPatternId}
                onChange={e => setModalPatternId(e.target.value)}
              >
                <option value="">— 選択してください —</option>
                {patterns.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}（{p.start_time.slice(0,5)}〜{p.end_time.slice(0,5)}）
                  </option>
                ))}
              </select>
            </div>

            {modalPatternId && (
              <div className="bg-clinic-50 rounded-lg p-2 flex items-center gap-2">
                {(() => {
                  const p = patterns.find(pt => pt.id === modalPatternId)
                  return p ? (
                    <>
                      <div className="shift-cell text-white" style={{ backgroundColor: p.color }}>{p.name}</div>
                      <span className="text-sm text-gray-600">{p.start_time.slice(0,5)} 〜 {p.end_time.slice(0,5)}</span>
                    </>
                  ) : null
                })()}
              </div>
            )}

            <div>
              <label className="label">メモ（任意）</label>
              <input
                className="input"
                value={modalNote}
                onChange={e => setModalNote(e.target.value)}
                placeholder="例: 早退予定あり"
              />
            </div>

            <div className="flex gap-2 pt-1">
              {modal.existing && (
                <button onClick={handleDelete} className="btn-danger text-sm px-3">削除</button>
              )}
              <button onClick={() => setModal(null)} className="btn-secondary flex-1 text-sm">キャンセル</button>
              <button onClick={handleSave} disabled={modalSaving || !modalPatternId} className="btn-primary flex-1 text-sm">
                {modalSaving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
