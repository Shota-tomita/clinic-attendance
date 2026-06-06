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

// 看護師・ORT の曜日自動パターンマップ
const AUTO_PATTERN_MAP: Record<string, Record<number, string>> = {
  '00000000-0000-0000-0000-000000000001': { // 看護師
    1: 'a1000001-0000-0000-0000-000000000001', // 月
    2: 'a1000001-0000-0000-0000-000000000001', // 火
    3: 'a1000001-0000-0000-0000-000000000002', // 水
    5: 'a1000001-0000-0000-0000-000000000005', // 金（別パターン）
    6: 'a1000001-0000-0000-0000-000000000003', // 土
  },
  '63aaa75e-18dc-41cd-81e5-34097b0131f5': { // ORT
    1: 'a2000001-0000-0000-0000-000000000001', // 月
    2: 'a2000001-0000-0000-0000-000000000001', // 火
    3: 'a2000001-0000-0000-0000-000000000002', // 水
    5: 'a2000001-0000-0000-0000-000000000001', // 金
    6: 'a2000001-0000-0000-0000-000000000003', // 土
  },
}

export default function ShiftPage() {
  const { user, profile, loading, isAdmin, isLeader } = useAuth()
  const router = useRouter()

  const [month, setMonth] = useState(getCurrentMonth())
  const [staffList, setStaffList] = useState<Profile[]>([])
  const [sortKey, setSortKey] = useState<'department' | 'name' | 'employment'>('department')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [patterns, setPatterns] = useState<ShiftPattern[]>([])
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([])
  const [fetching, setFetching] = useState(false)

  const [modal, setModal] = useState<{ userId: string; date: string; dow: number; existing?: ShiftAssignment; deptId?: string } | null>(null)
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
    if (isLeader && !isAdmin && profile?.department_id) {
      q = q.eq('department_id', profile.department_id)
    }
    const { data } = await q
    setStaffList(data ?? [])
  }

  const fetchPatterns = async () => {
    const { data } = await supabase
      .from('shift_patterns')
      .select('*, shift_pattern_blocks(*)')
      .eq('is_active', true)
      .order('name')
    setPatterns(data ?? [])
  }

  const fetchAssignments = async () => {
    if (staffList.length === 0) return
    setFetching(true)
    const { start, end } = getMonthRange(month)
    const ids = staffList.map(s => s.id)
    const { data } = await supabase
      .from('shift_assignments')
      .select('*, shift_patterns(*, shift_pattern_blocks(*))')
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
    const dow = getDay(parseISO(date))
    const existing = getAssignment(userId, date)
    const staff = staffList.find(s => s.id === userId)
    const deptId = staff?.department_id ?? undefined

    let defaultPatternId = ''
    if (deptId && AUTO_PATTERN_MAP[deptId]) {
      defaultPatternId = AUTO_PATTERN_MAP[deptId][dow] ?? ''
    }

    setModal({ userId, date, dow, existing, deptId })
    setModalPatternId(existing?.shift_pattern_id ?? defaultPatternId)
    setModalNote(existing?.note ?? '')
  }

  const getFilteredPatterns = (deptId?: string) => {
    if (!deptId) return patterns
    return patterns.filter(p => (p as any).department_id === deptId || !(p as any).department_id)
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

  const handleAutoFill = async (userId: string, deptId: string) => {
    if (!AUTO_PATTERN_MAP[deptId]) return
    const patternMap = AUTO_PATTERN_MAP[deptId]
    const { start, end } = getMonthRange(month)
    const allDays = eachDayOfInterval({ start: parseISO(start), end: parseISO(end) })

    const rows = allDays
      .filter(d => patternMap[getDay(d)])
      .map(d => ({
        user_id: userId,
        date: format(d, 'yyyy-MM-dd'),
        shift_pattern_id: patternMap[getDay(d)],
        assigned_by: user?.id,
      }))

    for (const row of rows) {
      await supabase.from('shift_assignments').upsert(row, { onConflict: 'user_id,date' })
    }
    fetchAssignments()
  }

  const sortedStaffList = [...staffList].sort((a, b) => {
    let valA: any, valB: any
    if (sortKey === 'name') { valA = a.name; valB = b.name }
    else if (sortKey === 'department') { valA = (a as any).departments?.name ?? ''; valB = (b as any).departments?.name ?? '' }
    else if (sortKey === 'employment') { valA = a.employment_type; valB = b.employment_type }
    if (valA < valB) return sortOrder === 'asc' ? -1 : 1
    if (valA > valB) return sortOrder === 'asc' ? 1 : -1
    return 0
  })

  const prevMonth = () => setMonth(format(subMonths(parseISO(month + '-01'), 1), 'yyyy-MM'))
  const nextMonth = () => setMonth(format(addMonths(parseISO(month + '-01'), 1), 'yyyy-MM'))

  const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

  if (loading || !profile) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-4xl animate-pulse">🏥</div>
    </div>
  )

  const filteredPatterns = modal ? getFilteredPatterns(modal.deptId) : patterns

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

        {/* Month nav */}
        <div className="card flex items-center gap-3 py-3">
          <button onClick={prevMonth} className="btn-secondary px-3 py-1.5 text-sm">‹</button>
          <span className="text-base font-semibold text-gray-800 flex-1 text-center">
            {format(parseISO(month + '-01'), 'yyyy年M月', { locale: ja })}
          </span>
          <button onClick={nextMonth} className="btn-secondary px-3 py-1.5 text-sm">›</button>
        </div>

        {/* ソートUI */}
        <div className="flex gap-2 items-center flex-wrap">
          <span className="text-xs text-gray-500 font-medium">並び替え：</span>
          {([
            ['department', '部署'],
            ['name', '名前'],
            ['employment', '雇用形態'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                if (sortKey === key) setSortOrder(o => o === 'asc' ? 'desc' : 'asc')
                else { setSortKey(key); setSortOrder('asc') }
              }}
              className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-all
                ${sortKey === key ? 'bg-clinic-600 text-white border-clinic-600' : 'bg-white text-gray-600 border-gray-200 hover:border-clinic-400'}`}
            >
              {label} {sortKey === key ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
            </button>
          ))}
        </div>

        {/* Legend */}
        <div className="flex gap-2 flex-wrap">
          {patterns.map(p => (
            <div key={p.id} className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: p.color }} />
              <span className="text-xs text-gray-500">{p.name}</span>
            </div>
          ))}
        </div>

        {/* Shift table */}
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-max">
              <thead className="bg-gray-50 border-b border-gray-100 sticky top-0 z-20">
                <tr>
                  <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left font-medium text-gray-600 min-w-[120px]">
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
                ) : sortedStaffList.length === 0 ? (
                  <tr><td colSpan={days.length + 1} className="text-center py-8 text-gray-400">スタッフがいません</td></tr>
                ) : sortedStaffList.map(staff => {
                  const deptId = staff.department_id ?? ''
                  const hasAutoPattern = !!AUTO_PATTERN_MAP[deptId]
                  return (
                    <tr key={staff.id} className="hover:bg-gray-50/50">
                      <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-700 border-r border-gray-100">
                        <div className="flex items-center gap-1.5">
                          <div className="w-6 h-6 rounded-full bg-clinic-100 text-clinic-700 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                            {staff.name[0]}
                          </div>
                          <div>
                            <span className="truncate max-w-[70px] block">{staff.name}</span>
                            {canManage && hasAutoPattern && (
                              <button
                                onClick={() => handleAutoFill(staff.id, deptId)}
                                className="text-[9px] text-clinic-500 hover:text-clinic-700 underline"
                              >
                                曜日自動設定
                              </button>
                            )}
                          </div>
                        </div>
                      </td>
                      {days.map(d => {
                        const dateStr = format(d, 'yyyy-MM-dd')
                        const a = getAssignment(staff.id, dateStr)
                        const pat = a?.shift_patterns
                        const dow = getDay(d)
                        const isWeekend = dow === 0 || dow === 6
                        const isClosed = dow === 0
                        return (
                          <td
                            key={dateStr}
                            onClick={() => openModal(staff.id, dateStr)}
                            className={`px-0.5 py-1 text-center cursor-pointer transition-colors
                              ${canManage ? 'hover:bg-clinic-50' : ''}
                              ${isClosed ? 'bg-gray-100/70' : isWeekend ? 'bg-gray-50/70' : ''}`}
                          >
                            {pat ? (
                              <div
                                className="shift-cell text-white mx-auto"
                                style={{ backgroundColor: pat.color }}
                                title={pat.name}
                              >
                                {pat.name.slice(pat.name.indexOf('_') + 1, pat.name.indexOf('_') + 3)}
                              </div>
                            ) : a ? (
                              <div className="shift-cell bg-gray-200 text-gray-600 mx-auto">手</div>
                            ) : (
                              canManage && !isClosed && <div className="text-gray-200 text-center">＋</div>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Assignment modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="font-semibold text-gray-800">シフト設定</h2>
            <div className="text-sm text-gray-500">
              {staffList.find(s => s.id === modal.userId)?.name} / {modal.date}（{WEEKDAYS[modal.dow]}）
            </div>

            <div>
              <label className="label">シフトパターン</label>
              <select
                className="select"
                value={modalPatternId}
                onChange={e => setModalPatternId(e.target.value)}
              >
                <option value="">— 選択してください —</option>
                {getFilteredPatterns(modal.deptId).map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}（{(p.shift_pattern_blocks ?? []).sort((a,b) => a.sort_order - b.sort_order).map(b => `${b.start_time.slice(0,5)}〜${b.end_time.slice(0,5)}`).join(' / ')}）
                  </option>
                ))}
              </select>
            </div>

            {modalPatternId && (() => {
              const p = patterns.find(pt => pt.id === modalPatternId)
              return p ? (
                <div className="bg-clinic-50 rounded-lg p-2 flex items-center gap-2">
                  <div className="shift-cell text-white text-xs px-2 py-1" style={{ backgroundColor: p.color }}>{p.name}</div>
                  <span className="text-sm text-gray-600">
                    {(p.shift_pattern_blocks ?? []).sort((a,b) => a.sort_order - b.sort_order).map(b => `${b.start_time.slice(0,5)}〜${b.end_time.slice(0,5)}`).join(' / ')}
                  </span>
                </div>
              ) : null
            })()}

            <div>
              <label className="label">メモ（任意）</label>
              <input className="input" value={modalNote} onChange={e => setModalNote(e.target.value)} placeholder="例: 早退予定あり" />
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
