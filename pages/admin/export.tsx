import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { getCurrentMonth, getMonthRange, formatMinutes } from '@/lib/utils'
import { format, parseISO, differenceInMinutes } from 'date-fns'
import { ja } from 'date-fns/locale'

// 実働時間計算（シフト開始より早い分を除外）
function calcActualMin(r: any, blocks: any[]): number {
  const sorted = [...blocks].sort((a: any, b: any) => a.sort_order - b.sort_order)
  const amBlock = sorted.find((b: any) => b.sort_order === 0)
  const pmBlock = sorted.find((b: any) => b.sort_order === 1)
  let total = 0

  const rawAmIn = r.am_clock_in ? parseISO(r.am_clock_in) : null
  const amOut = r.am_clock_out ? parseISO(r.am_clock_out) : null
  let effectiveAmIn = rawAmIn
  if (rawAmIn && amBlock) {
    const [sh, sm] = amBlock.start_time.split(':').map(Number)
    const shiftStart = new Date(`${r.date}T${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}:00+09:00`)
    if (rawAmIn < shiftStart) effectiveAmIn = shiftStart
  }
  if (effectiveAmIn && amOut) total += Math.max(differenceInMinutes(amOut, effectiveAmIn), 0)

  const rawPmIn = r.pm_clock_in ? parseISO(r.pm_clock_in) : null
  const pmOut = r.pm_clock_out ? parseISO(r.pm_clock_out) : null
  let effectivePmIn = rawPmIn
  if (rawPmIn && pmBlock) {
    const [sh, sm] = pmBlock.start_time.split(':').map(Number)
    const shiftStart = new Date(`${r.date}T${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}:00+09:00`)
    if (rawPmIn < shiftStart) effectivePmIn = shiftStart
  }
  if (effectivePmIn && pmOut) total += Math.max(differenceInMinutes(pmOut, effectivePmIn), 0)
  if (!rawPmIn && effectiveAmIn && pmOut) total = Math.max(differenceInMinutes(pmOut, effectiveAmIn), 0)
  if (total === 0 && r.clock_in && r.clock_out)
    total = Math.max(differenceInMinutes(parseISO(r.clock_out), parseISO(r.clock_in)), 0)
  return total
}

function calcScheduledMin(blocks: any[]): number {
  return blocks.reduce((sum: number, b: any) => {
    const [sh, sm] = b.start_time.split(':').map(Number)
    const [eh, em] = b.end_time.split(':').map(Number)
    return sum + (eh * 60 + em) - (sh * 60 + sm)
  }, 0)
}

function calcLateMin(r: any, blocks: any[]): number {
  const sorted = [...blocks].sort((a: any, b: any) => a.sort_order - b.sort_order)
  let total = 0
  // 早出（シフト開始より早い）は遅刻0
  const amBlock = sorted.find((b: any) => b.sort_order === 0)
  const clockIn = r.am_clock_in || r.clock_in
  if (amBlock && clockIn) {
    const [sh, sm] = amBlock.start_time.split(':').map(Number)
    const start = new Date(`${r.date}T${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}:00+09:00`)
    const late = differenceInMinutes(parseISO(clockIn), start)
    if (late > 0) total += late
  }
  const pmBlock = sorted.find((b: any) => b.sort_order === 1)
  if (pmBlock && r.pm_clock_in) {
    const [sh, sm] = pmBlock.start_time.split(':').map(Number)
    const start = new Date(`${r.date}T${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}:00+09:00`)
    const late = differenceInMinutes(parseISO(r.pm_clock_in), start)
    if (late > 0) total += late
  }
  return total
}

export default function ExportPage() {
  const { user, profile, loading, isAdmin } = useAuth()
  const router = useRouter()
  const [month, setMonth] = useState(getCurrentMonth())
  const [exporting, setExporting] = useState(false)
  const [preview, setPreview] = useState<any[]>([])
  const [fetching, setFetching] = useState(false)
  const [sortKey, setSortKey] = useState<'name' | 'department' | 'employment'>('name')

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [user, loading])

  useEffect(() => {
    if (!loading && profile && !isAdmin) router.replace('/dashboard')
  }, [loading, profile, isAdmin])

  useEffect(() => { if (isAdmin) fetchPreview() }, [isAdmin, month])

  const fetchPreview = async () => {
    setFetching(true)
    const { start, end } = getMonthRange(month)

    // スタッフ一覧を別途取得（RLS回避）
    const { data: staffList } = await supabase
      .from('profiles')
      .select('id, name, employment_type, base_salary, commute_monthly_fee, departments(name)')
      .order('name')

    const staffById: Record<string, any> = {}
    for (const s of staffList ?? []) staffById[s.id] = s

    // 勤怠記録
    const { data: records } = await supabase
      .from('attendance_records')
      .select('*')
      .gte('date', start)
      .lte('date', end)

    // シフト
    const { data: shifts } = await supabase
      .from('shift_assignments')
      .select('user_id, date, shift_patterns(shift_pattern_blocks(*))')
      .gte('date', start)
      .lte('date', end)

    const shiftMap: Record<string, any[]> = {}
    for (const s of shifts ?? []) {
      const blocks = (s.shift_patterns as any)?.shift_pattern_blocks ?? []
      shiftMap[`${s.user_id}_${s.date}`] = blocks
    }

    // スタッフごとに集計
    const staffMap: Record<string, any> = {}
    for (const r of records ?? []) {
      const staff = staffById[r.user_id]
      if (!staff) continue

      if (!staffMap[r.user_id]) {
        staffMap[r.user_id] = {
          name: staff.name,
          department: (staff.departments as any)?.name ?? '—',
          employment_type: staff.employment_type,
          base_salary: staff.base_salary ?? 0,
          work_days: 0, absent_days: 0, late_count: 0,
          late_minutes: 0, early_leave_count: 0,
          overtime_minutes: 0, deduction_minutes: 0,
          actual_minutes: 0, paid_leave_days: 0,
          transport_fee: staff.commute_monthly_fee ?? 0,
        }
      }

      const s = staffMap[r.user_id]
      const blocks = shiftMap[`${r.user_id}_${r.date}`] ?? []
      const scheduledMin = calcScheduledMin(blocks)
      const actualMin = calcActualMin(r, blocks)
      const lateMin = calcLateMin(r, blocks)
      const overtimeMin = scheduledMin > 0 ? Math.max(actualMin - scheduledMin, 0) : 0
      const netLate = Math.max(lateMin - overtimeMin, 0)
      const deductionMin = scheduledMin > 0 ? netLate : 0

      if (['present','late','early_leave'].includes(r.status)) s.work_days++
      if (r.status === 'absent') s.absent_days++
      if (lateMin > 0) s.late_count++
      s.late_minutes += lateMin
      if (r.clock_out_reason === 'early_leave') s.early_leave_count++
      s.overtime_minutes += overtimeMin
      s.deduction_minutes += deductionMin
      s.actual_minutes += actualMin
      if (r.status === 'paid_leave') s.paid_leave_days++
    }

    setPreview(Object.entries(staffMap).map(([id, data]) => ({ id, ...data })))
    setFetching(false)
  }

  const sorted = [...preview].sort((a, b) => {
    if (sortKey === 'name') return a.name.localeCompare(b.name, 'ja')
    if (sortKey === 'department') return (a.department ?? '').localeCompare(b.department ?? '', 'ja')
    if (sortKey === 'employment') return a.employment_type.localeCompare(b.employment_type)
    return 0
  })

  const exportCSV = () => {
    setExporting(true)
    const headers = [
      '氏名', '部署', '雇用形態', '基本給',
      '出勤日数', '欠勤日数', '有給取得日数',
      '遅刻回数', '遅刻時間', '早退回数',
      '実働時間', '残業時間', '控除時間', '交通費',
    ]
    const rows = sorted.map(s => [
      s.name, s.department,
      s.employment_type === 'full_time' ? '正社員' : 'パート',
      s.base_salary, s.work_days, s.absent_days, s.paid_leave_days,
      s.late_count, formatMinutes(s.late_minutes), s.early_leave_count,
      formatMinutes(s.actual_minutes), formatMinutes(s.overtime_minutes),
      formatMinutes(s.deduction_minutes), s.transport_fee,
    ])
    const csv = [
      `# ${format(parseISO(month + '-01'), 'yyyy年M月', { locale: ja })} 勤怠データ`,
      `# 出力日: ${format(new Date(), 'yyyy/MM/dd HH:mm')}`,
      '',
      headers.join(','),
      ...rows.map(r => r.map(v => `"${v}"`).join(',')),
    ].join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `勤怠データ_${month}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setExporting(false)
  }

  if (loading || !profile) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-4xl animate-pulse">🏥</div>
    </div>
  )

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">📥 月次データ出力</h1>
          <p className="text-xs text-gray-400 mt-0.5">月次の勤怠データをCSVで出力します</p>
        </div>

        <div className="card flex items-center gap-4 flex-wrap">
          <div>
            <label className="label">対象月</label>
            <input type="month" className="input w-auto" value={month}
              onChange={e => setMonth(e.target.value)} />
          </div>
          <div>
            <label className="label">並び替え</label>
            <select className="select w-auto" value={sortKey}
              onChange={e => setSortKey(e.target.value as any)}>
              <option value="name">名前順</option>
              <option value="department">部署順</option>
              <option value="employment">雇用形態順</option>
            </select>
          </div>
          <button onClick={exportCSV} disabled={exporting || preview.length === 0}
            className="btn-primary text-sm mt-4">
            📥 CSVダウンロード
          </button>
        </div>

        <div className="card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">
              プレビュー（{format(parseISO(month + '-01'), 'yyyy年M月', { locale: ja })}）
            </h2>
            <span className="text-xs text-gray-400">{preview.length}名</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-max">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="table-th">氏名</th>
                  <th className="table-th">部署</th>
                  <th className="table-th">雇用</th>
                  <th className="table-th">出勤</th>
                  <th className="table-th">欠勤</th>
                  <th className="table-th">有給</th>
                  <th className="table-th">遅刻</th>
                  <th className="table-th">実働</th>
                  <th className="table-th">残業</th>
                  <th className="table-th">控除</th>
                  <th className="table-th">交通費</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {fetching ? (
                  <tr><td colSpan={11} className="text-center py-8 text-gray-400">読込中...</td></tr>
                ) : sorted.length === 0 ? (
                  <tr><td colSpan={11} className="text-center py-8 text-gray-400">データがありません</td></tr>
                ) : sorted.map(s => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="table-td font-medium">{s.name}</td>
                    <td className="table-td text-xs text-gray-500">{s.department}</td>
                    <td className="table-td text-xs text-gray-500">
                      {s.employment_type === 'full_time' ? '正社員' : 'パート'}
                    </td>
                    <td className="table-td">{s.work_days}日</td>
                    <td className="table-td">
                      <span className={s.absent_days > 0 ? 'text-red-500 font-medium' : 'text-gray-400'}>
                        {s.absent_days}日
                      </span>
                    </td>
                    <td className="table-td">{s.paid_leave_days}日</td>
                    <td className="table-td">
                      <span className={s.late_count > 0 ? 'text-amber-600 font-medium' : 'text-gray-400'}>
                        {s.late_count}回
                      </span>
                    </td>
                    <td className="table-td">{s.actual_minutes > 0 ? formatMinutes(s.actual_minutes) : '—'}</td>
                    <td className="table-td text-amber-600">
                      {s.overtime_minutes > 0 ? formatMinutes(s.overtime_minutes) : '—'}
                    </td>
                    <td className="table-td text-red-500">
                      {s.deduction_minutes > 0 ? formatMinutes(s.deduction_minutes) : '—'}
                    </td>
                    <td className="table-td text-clinic-700 font-medium">
                      {s.transport_fee > 0 ? `¥${s.transport_fee.toLocaleString()}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  )
}
