import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { getCurrentMonth, getMonthRange, formatMinutes } from '@/lib/utils'
import { format, parseISO, differenceInMinutes, getDay } from 'date-fns'
import { ja } from 'date-fns/locale'

function calcActualMin(r: any, blocks: any[], amEarlyStartTime?: string, pmEarlyStartTime?: string): number {
  const sorted = [...blocks].sort((a: any, b: any) => a.sort_order - b.sort_order)
  const amBlock = sorted.find((b: any) => b.sort_order === 0)
  const pmBlock = sorted.find((b: any) => b.sort_order === 1)
  let total = 0

  const rawAmIn = r.am_clock_in ? parseISO(r.am_clock_in) : null
  const amOut = r.am_clock_out ? parseISO(r.am_clock_out) : null
  let effectiveAmIn = rawAmIn
  if (rawAmIn && amBlock) {
    const [sh, sm] = amBlock.start_time.split(':').map(Number)
    const shiftAmStart = new Date(`${r.date}T${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}:00+09:00`)
    if (rawAmIn < shiftAmStart) {
      if (amEarlyStartTime) {
        const approvedStart = new Date(`${r.date}T${amEarlyStartTime}+09:00`)
        effectiveAmIn = rawAmIn < approvedStart ? approvedStart : rawAmIn
      } else {
        effectiveAmIn = shiftAmStart
      }
    }
  }
  if (effectiveAmIn && amOut) total += Math.max(differenceInMinutes(amOut, effectiveAmIn), 0)

  const rawPmIn = r.pm_clock_in ? parseISO(r.pm_clock_in) : null
  const pmOut = r.pm_clock_out ? parseISO(r.pm_clock_out) : null
  let effectivePmIn = rawPmIn
  if (rawPmIn && pmBlock) {
    const [sh, sm] = pmBlock.start_time.split(':').map(Number)
    const shiftPmStart = new Date(`${r.date}T${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}:00+09:00`)
    if (rawPmIn < shiftPmStart) {
      if (pmEarlyStartTime) {
        const approvedPmStart = new Date(`${r.date}T${pmEarlyStartTime}+09:00`)
        effectivePmIn = rawPmIn < approvedPmStart ? approvedPmStart : rawPmIn
      } else {
        effectivePmIn = shiftPmStart
      }
    }
  } else if (rawPmIn && !pmBlock && amBlock) {
    const [sh, sm] = amBlock.start_time.split(':').map(Number)
    const shiftStart = new Date(`${r.date}T${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}:00+09:00`)
    if (rawPmIn < shiftStart) effectivePmIn = shiftStart
  }
  if (effectivePmIn && pmOut) total += Math.max(differenceInMinutes(pmOut, effectivePmIn), 0)
  if (!rawPmIn && effectiveAmIn && pmOut && total === 0) total = Math.max(differenceInMinutes(pmOut, effectiveAmIn), 0)
  if (total === 0 && r.clock_in && r.clock_out)
    total = Math.max(differenceInMinutes(parseISO(r.clock_out), parseISO(r.clock_in)), 0)
  return total
}

// 午前・午後それぞれの実働時間を返す（早出申請対応）
function calcAmPmMin(r: any, blocks: any[], amEarlyStartTime?: string, pmEarlyStartTime?: string): { amMin: number, pmMin: number } {
  const sorted = [...blocks].sort((a: any, b: any) => a.sort_order - b.sort_order)
  const amBlock = sorted.find((b: any) => b.sort_order === 0)
  const pmBlock = sorted.find((b: any) => b.sort_order === 1)
  let amMin = 0, pmMin = 0

  const rawAmIn = r.am_clock_in ? parseISO(r.am_clock_in) : null
  const amOut = r.am_clock_out ? parseISO(r.am_clock_out) : null
  let effectiveAmIn = rawAmIn
  if (rawAmIn && amBlock) {
    const [sh, sm] = amBlock.start_time.split(':').map(Number)
    const shiftAmStart = new Date(`${r.date}T${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}:00+09:00`)
    if (rawAmIn < shiftAmStart) {
      if (amEarlyStartTime) {
        const approvedStart = new Date(`${r.date}T${amEarlyStartTime}+09:00`)
        effectiveAmIn = rawAmIn < approvedStart ? approvedStart : rawAmIn
      } else {
        effectiveAmIn = shiftAmStart
      }
    }
  }
  if (effectiveAmIn && amOut) amMin = Math.max(differenceInMinutes(amOut, effectiveAmIn), 0)

  const rawPmIn = r.pm_clock_in ? parseISO(r.pm_clock_in) : null
  const pmOut = r.pm_clock_out ? parseISO(r.pm_clock_out) : null
  let effectivePmIn = rawPmIn
  if (rawPmIn && pmBlock) {
    const [sh, sm] = pmBlock.start_time.split(':').map(Number)
    const shiftPmStart = new Date(`${r.date}T${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}:00+09:00`)
    if (rawPmIn < shiftPmStart) {
      if (pmEarlyStartTime) {
        const approvedPmStart = new Date(`${r.date}T${pmEarlyStartTime}+09:00`)
        effectivePmIn = rawPmIn < approvedPmStart ? approvedPmStart : rawPmIn
      } else {
        effectivePmIn = shiftPmStart
      }
    }
  } else if (rawPmIn && !pmBlock && amBlock) {
    const [sh, sm] = amBlock.start_time.split(':').map(Number)
    const shiftStart = new Date(`${r.date}T${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}:00+09:00`)
    if (rawPmIn < shiftStart) effectivePmIn = shiftStart
  }
  if (effectivePmIn && pmOut) pmMin = Math.max(differenceInMinutes(pmOut, effectivePmIn), 0)
  if (!rawPmIn && effectiveAmIn && pmOut && pmMin === 0) {
    pmMin = Math.max(differenceInMinutes(pmOut, effectiveAmIn), 0)
    amMin = 0
  }
  return { amMin, pmMin }
}

// 残業計算（シフト終了後の実働時間）
function calcOvertimeMin(r: any, blocks: any[]): number {
  if (!blocks || blocks.length === 0) return 0
  const sorted = [...blocks].sort((a: any, b: any) => a.sort_order - b.sort_order)
  const lastBlock = sorted[sorted.length - 1]
  const [eh, em] = lastBlock.end_time.split(':').map(Number)
  const shiftEnd = new Date(`${r.date}T${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}:00+09:00`)
  const clockOut = r.pm_clock_out ? parseISO(r.pm_clock_out)
    : r.am_clock_out ? parseISO(r.am_clock_out)
    : r.clock_out ? parseISO(r.clock_out)
    : null
  if (!clockOut) return 0
  return Math.max(differenceInMinutes(clockOut, shiftEnd), 0)
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

// 時給区分を判定（0=日,1=月...6=土）
function getRateType(dow: number, slot: 'am' | 'pm', rates: any[]): number | null {
  // 特定曜日設定を優先
  const custom = rates.find(r => r.rate_type === 'custom' && r.day_of_week === dow && r.time_slot === slot)
  if (custom) return custom.hourly_rate

  if (dow === 6) {
    const sat = rates.find(r => r.rate_type === 'saturday')
    if (sat) return sat.hourly_rate
  } else if (dow !== 0) {
    const weekday = rates.find(r => r.rate_type === (slot === 'am' ? 'weekday_am' : 'weekday_pm'))
    if (weekday) return weekday.hourly_rate
  }
  return null
}

// ─── 部署固定順ソート ─────────────────────────────────────────
const DEPT_ORDER = ['看護師', 'ORT', '受付', '助手']

function getDeptOrder(deptName: string | undefined | null): number {
  const idx = DEPT_ORDER.indexOf(deptName ?? '')
  return idx === -1 ? DEPT_ORDER.length : idx
}

// ─── クリニック固定順 ─────────────────────────────────────────
const CLINIC_ORDER = ['tomita', 'joyama']
const CLINIC_LABEL: Record<string, string> = { tomita: '富田眼科', joyama: '城山コンタクト' }
function getClinicOrder(clinic: string | undefined | null) {
  const i = CLINIC_ORDER.indexOf(clinic ?? '')
  return i === -1 ? CLINIC_ORDER.length : i
}

// 時給額ごとにminを積み上げるヘルパー
function addRateMin(details: { rate: number; min: number; amount: number }[], rate: number, min: number) {
  const amount = Math.round(min / 60 * rate)
  const existing = details.find(d => d.rate === rate)
  if (existing) { existing.min += min; existing.amount += amount }
  else details.push({ rate, min, amount })
}

export default function ExportPage() {
  const { user, profile, loading, isAdmin } = useAuth()
  const router = useRouter()
  const [month, setMonth] = useState(getCurrentMonth())
  const [exporting, setExporting] = useState(false)
  const [preview, setPreview] = useState<any[]>([])
  const [fetching, setFetching] = useState(false)
  const [sortKey, setSortKey] = useState<'name' | 'department' | 'employment'>('department')

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

    const { data: staffList } = await supabase
      .from('profiles')
      .select('id, name, employment_type, base_salary, hourly_rate, pay_type, commute_monthly_fee, commute_fee_type, commute_per_trip_fee, clinic, departments(name)')
      .order('name')

    const staffById: Record<string, any> = {}
    for (const s of staffList ?? []) staffById[s.id] = s

    const { data: records } = await supabase
      .from('attendance_records')
      .select('*')
      .gte('date', start)
      .lte('date', end)

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

    // 応援交通費を取得
    const { data: supportFees } = await supabase
      .from('support_transport_fees')
      .select('*')
      .gte('date', start)
      .lte('date', end)

    const supportFeesByUser: Record<string, number> = {}
    for (const f of supportFees ?? []) {
      supportFeesByUser[f.user_id] = (supportFeesByUser[f.user_id] ?? 0) + f.amount
    }

    // 承認済み早出申請を取得 → earlyStartMap[userId_date] = {am?, pm?}
    const { data: earlyStarts } = await supabase
      .from('early_start_requests')
      .select('user_id, date, time_slot, start_time')
      .eq('status', 'approved')
      .gte('date', start)
      .lte('date', end)

    const earlyStartMap: Record<string, { am?: string; pm?: string }> = {}
    for (const e of earlyStarts ?? []) {
      const key = `${e.user_id}_${e.date}`
      if (!earlyStartMap[key]) earlyStartMap[key] = {}
      const slot = e.time_slot ?? 'am'
      earlyStartMap[key][slot as 'am' | 'pm'] = e.start_time
    }

    // 時給設定を取得
    const { data: allRates } = await supabase.from('part_time_rates').select('*')
    const ratesByUser: Record<string, any[]> = {}
    for (const r of allRates ?? []) {
      if (!ratesByUser[r.user_id]) ratesByUser[r.user_id] = []
      ratesByUser[r.user_id].push(r)
    }

    const staffMap: Record<string, any> = {}
    for (const r of records ?? []) {
      const staff = staffById[r.user_id]
      if (!staff) continue

      if (!staffMap[r.user_id]) {
        staffMap[r.user_id] = {
          name: staff.name,
          department: (staff.departments as any)?.name ?? '—',
          clinic: (staff as any).clinic ?? 'tomita',
          employment_type: staff.employment_type,
          pay_type: (staff as any).pay_type ?? 'monthly',
          base_salary: staff.base_salary ?? 0,
          hourly_rate: (staff as any).hourly_rate ?? 0,
          work_days: 0, absent_days: 0, late_count: 0,
          late_minutes: 0, early_leave_count: 0,
          overtime_minutes: 0, deduction_minutes: 0,
          actual_minutes: 0, paid_leave_days: 0,
          transport_fee: staff.commute_monthly_fee ?? 0,
          commute_fee_type: (staff as any).commute_fee_type ?? 'monthly',
          commute_per_trip_fee: (staff as any).commute_per_trip_fee ?? 0,
          support_transport_fee: supportFeesByUser[r.user_id] ?? 0,
          // 時給区分別
          paid_leave_min: 0, paid_leave_amount: 0,
          // 時給額ごとの集計: { rate, min, amount }[]
          rate_details: [] as { rate: number; min: number; amount: number }[],
        }
      }

      const s = staffMap[r.user_id]
      const blocks = shiftMap[`${r.user_id}_${r.date}`] ?? []
      const earlyKey = `${r.user_id}_${r.date}`
      const amEarly = earlyStartMap[earlyKey]?.am
      const pmEarly = earlyStartMap[earlyKey]?.pm
      const scheduledMin = calcScheduledMin(blocks)
      const actualMin = calcActualMin(r, blocks, amEarly, pmEarly)
      const lateMin = calcLateMin(r, blocks)
      const staffData = staffById[r.user_id]
      const isPartTime = staffData?.employment_type === 'part_time'
      const overtimeMin = isPartTime
        ? (r.overtime_minutes ?? 0)
        : (scheduledMin > 0 ? Math.max(actualMin - scheduledMin, 0) : 0)
      // 控除計算：早退 or 早上がり否認 or (遅刻かつ所定>実働) のみ
      const isEarlyLeave = r.clock_out_reason === 'early_leave' || r.status === 'early_leave'
      const isEarlyFinishRejected = r.early_finish_status === 'rejected'
      const hasLate = lateMin > 0
      const isShort = scheduledMin > 0 && actualMin < scheduledMin
      const deductionMin = (isEarlyLeave || isEarlyFinishRejected || (hasLate && isShort))
        ? Math.max(scheduledMin - actualMin, 0)
        : 0

      if (['present','late','early_leave'].includes(r.status)) {
        s.work_days++
        if (s.commute_fee_type === 'per_trip') {
          s.transport_fee += s.commute_per_trip_fee
        }
        s.overtime_minutes += overtimeMin
        s.deduction_minutes += deductionMin
        s.actual_minutes += actualMin

        // 時給区分別の計算（時給制スタッフのみ）
        if (s.pay_type === 'hourly') {
          const rates = ratesByUser[r.user_id] ?? []
          const dow = getDay(parseISO(r.date))
          const { amMin, pmMin } = calcAmPmMin(r, blocks, amEarly, pmEarly)
          const overtimeMin = r.overtime_minutes ?? 0

          if (amMin > 0) {
            const rate = getRateType(dow, 'am', rates) ?? s.hourly_rate
            // 実働分から時間外を除いた通常分
            const normalMin = Math.max(amMin - overtimeMin, 0)
            if (normalMin > 0) addRateMin(s.rate_details, rate, normalMin)
          }
          if (pmMin > 0) {
            const rate = getRateType(dow, 'pm', rates) ?? s.hourly_rate
            const normalMin = amMin > 0 ? pmMin : Math.max(pmMin - overtimeMin, 0)
            if (normalMin > 0) addRateMin(s.rate_details, rate, normalMin)
          }
          // 時間外分（×1.25）
          if (overtimeMin > 0) {
            // 時間外は最後の退勤スロットの時給をベースに
            const dow2 = getDay(parseISO(r.date))
            const lastRate = pmMin > 0
              ? (getRateType(dow2, 'pm', rates) ?? s.hourly_rate)
              : (getRateType(dow2, 'am', rates) ?? s.hourly_rate)
            const otRate = Math.round(lastRate * 1.25)
            addRateMin(s.rate_details, otRate, overtimeMin)
          }
        }
      }
      if (r.status === 'absent') s.absent_days++
      if (lateMin > 0) s.late_count++
      s.late_minutes += lateMin
      if (r.clock_out_reason === 'early_leave') s.early_leave_count++

      if (r.status === 'paid_leave') {
        s.paid_leave_days += (r as any).am_leave || (r as any).pm_leave ? 0.5 : 1

        // 時給パートの有給：シフト所定時間で時給計算
        if (s.pay_type === 'hourly' && blocks.length > 0) {
          const rates = ratesByUser[r.user_id] ?? []
          const dow = getDay(parseISO(r.date))
          const isHalfAm = (r as any).am_leave === true
          const isHalfPm = (r as any).pm_leave === true
          const sortedBlocks = [...blocks].sort((a: any, b: any) => a.sort_order - b.sort_order)
          const amBlock = sortedBlocks.find((b: any) => b.sort_order === 0)
          const pmBlock = sortedBlocks.find((b: any) => b.sort_order === 1)

          if (amBlock && !isHalfPm) {
            const [sh, sm] = amBlock.start_time.split(':').map(Number)
            const [eh, em] = amBlock.end_time.split(':').map(Number)
            const min = (eh * 60 + em) - (sh * 60 + sm)
            const rate = getRateType(dow, 'am', rates) ?? s.hourly_rate
            addRateMin(s.rate_details, rate, min)
            s.paid_leave_min = (s.paid_leave_min ?? 0) + min
            s.paid_leave_amount = (s.paid_leave_amount ?? 0) + Math.round(min / 60 * rate)
          }
          if (pmBlock && !isHalfAm) {
            const [sh, sm] = pmBlock.start_time.split(':').map(Number)
            const [eh, em] = pmBlock.end_time.split(':').map(Number)
            const min = (eh * 60 + em) - (sh * 60 + sm)
            const rate = getRateType(dow, 'pm', rates) ?? s.hourly_rate
            addRateMin(s.rate_details, rate, min)
            s.paid_leave_min = (s.paid_leave_min ?? 0) + min
            s.paid_leave_amount = (s.paid_leave_amount ?? 0) + Math.round(min / 60 * rate)
          }
        }
      }
    }

    setPreview(Object.entries(staffMap).map(([id, data]) => ({ id, ...data })))
    setFetching(false)
  }

  const sorted = [...preview].sort((a, b) => {
    // 常にクリニック順を第1キーに
    const cA = getClinicOrder((a as any).clinic)
    const cB = getClinicOrder((b as any).clinic)
    if (cA !== cB) return cA - cB

    if (sortKey === 'name') return a.name.localeCompare(b.name, 'ja')
    if (sortKey === 'department') {
      const dA = getDeptOrder(a.department)
      const dB = getDeptOrder(b.department)
      if (dA !== dB) return dA - dB
      const empA = a.employment_type === 'full_time' ? 0 : 1
      const empB = b.employment_type === 'full_time' ? 0 : 1
      if (empA !== empB) return empA - empB
      return a.name.localeCompare(b.name, 'ja')
    }
    if (sortKey === 'employment') return a.employment_type.localeCompare(b.employment_type)
    return 0
  })

  const exportCSV = () => {
    setExporting(true)

    // 時給内訳の最大パターン数（スタッフごとに異なるため最大を求める）
    const maxRateCount = Math.max(
      1,
      ...sorted.map(s => {
        const details = s.rate_details ?? []
        const paidCount = (s.pay_type === 'hourly' && s.paid_leave_amount > 0) ? 1 : 0
        return details.length + paidCount
      })
    )

    // ヘッダー：時給内訳は「時給N」「時間N」「金額N」×最大数
    const rateHeaders = Array.from({ length: maxRateCount }, (_, i) =>
      [`時給${i + 1}`, `時間${i + 1}`, `金額${i + 1}`, '']
    ).flat()

    const headers = [
      '氏名', '部署', '雇用形態',
      '出勤日数', '欠勤日数', '有給取得日数',
      '遅刻回数', '遅刻時間', '早退回数',
      '実働時間', '残業時間', '控除時間', '交通費',
      '応援交通費',
      ...rateHeaders,
    ]

    const rows = sorted.map(s => {
      // 時給内訳セルを生成（時給・時間・金額・空白の4セット）
      const rateCells: string[] = []
      if (s.pay_type === 'hourly') {
        const details = [...(s.rate_details ?? [])].sort((a: any, b: any) => a.rate - b.rate)
        for (const d of details) {
          rateCells.push(`¥${d.rate.toLocaleString()}/h`, formatMinutes(d.min), `¥${d.amount.toLocaleString()}`, '')
        }
        // 有給時給
        if (s.paid_leave_amount > 0) {
          rateCells.push('有給', formatMinutes(s.paid_leave_min ?? 0), `¥${s.paid_leave_amount.toLocaleString()}`, '')
        }
      }
      // 最大数まで空白で埋める
      while (rateCells.length < maxRateCount * 4) rateCells.push('')

      return [
        s.name, s.department,
        s.employment_type === 'full_time' ? '正社員' : 'パート',
        s.work_days, s.absent_days, s.paid_leave_days,
        s.late_count, formatMinutes(s.late_minutes), s.early_leave_count,
        formatMinutes(s.actual_minutes), formatMinutes(s.overtime_minutes),
        formatMinutes(s.deduction_minutes), s.transport_fee,
        s.support_transport_fee > 0 ? `¥${s.support_transport_fee.toLocaleString()}` : '—',
        ...rateCells,
      ]
    })
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
      <div className="max-w-5xl mx-auto space-y-5">
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
          {/* 上部スクロールバー */}
          <div id="export-top-scroll" className="overflow-x-auto" style={{height:'14px'}}
            onScroll={e => { const b = document.getElementById('export-main-scroll'); if(b) b.scrollLeft=(e.target as HTMLDivElement).scrollLeft }}>
            <div id="export-top-inner" style={{height:'1px', minWidth:'100%'}} />
          </div>
          <div id="export-main-scroll" className="overflow-x-auto"
            onScroll={e => {
              const t = document.getElementById('export-top-scroll'); if(t) t.scrollLeft=(e.target as HTMLDivElement).scrollLeft
              const i = document.getElementById('export-top-inner'); const tbl = (e.target as HTMLDivElement).querySelector('table')
              if(i && tbl) i.style.width = tbl.offsetWidth+'px'
            }}
            ref={el => { if(!el) return; const i=document.getElementById('export-top-inner'); const tbl=el.querySelector('table'); if(i&&tbl) i.style.width=tbl.offsetWidth+'px' }}
          >
            <table className="w-full text-sm min-w-max">
              <thead className="bg-gray-50 border-b border-gray-100 sticky top-0 z-10">
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
                  <th className="table-th">応援交通費</th>
                  <th className="table-th">時給内訳</th>
                  <th className="table-th">有給時給</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {fetching ? (
                  <tr><td colSpan={14} className="text-center py-8 text-gray-400">読込中...</td></tr>
                ) : sorted.length === 0 ? (
                  <tr><td colSpan={14} className="text-center py-8 text-gray-400">データがありません</td></tr>
                ) : sorted.flatMap((s, idx) => {
                  const prevClinic = idx > 0 ? (sorted[idx - 1] as any).clinic : null
                  const curClinic = (s as any).clinic ?? 'tomita'
                  const showClinicHeader = curClinic !== prevClinic
                  const rows: any[] = []
                  if (showClinicHeader) {
                    rows.push(
                      <tr key={`clinic-${curClinic}-${idx}`}>
                        <td colSpan={14} className="px-4 py-2 bg-gray-100 text-xs font-semibold text-gray-500 tracking-wide">
                          🏥 {CLINIC_LABEL[curClinic] ?? curClinic}
                        </td>
                      </tr>
                    )
                  }
                  rows.push(
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="table-td font-medium">
                      <button onClick={() => router.push(`/attendance/history?staffId=${s.id}&month=${month}`)}
                        className="text-clinic-600 hover:text-clinic-700 hover:underline font-medium">
                        {s.name}
                      </button>
                    </td>
                    <td className="table-td text-xs text-gray-500">{s.department}</td>
                    <td className="table-td text-xs text-gray-500">{s.employment_type === 'full_time' ? '正社員' : 'パート'}</td>
                    <td className="table-td">{s.work_days}日</td>
                    <td className="table-td"><span className={s.absent_days > 0 ? 'text-red-500 font-medium' : 'text-gray-400'}>{s.absent_days}日</span></td>
                    <td className="table-td">{s.paid_leave_days}日</td>
                    <td className="table-td"><span className={s.late_count > 0 ? 'text-amber-600 font-medium' : 'text-gray-400'}>{s.late_count}回</span></td>
                    <td className="table-td">{s.actual_minutes > 0 ? formatMinutes(s.actual_minutes) : '—'}</td>
                    <td className="table-td text-amber-600">{s.overtime_minutes > 0 ? formatMinutes(s.overtime_minutes) : '—'}</td>
                    <td className="table-td text-red-500">{s.deduction_minutes > 0 ? formatMinutes(s.deduction_minutes) : '—'}</td>
                    <td className="table-td text-clinic-700 font-medium">{s.transport_fee > 0 ? `¥${s.transport_fee.toLocaleString()}` : '—'}</td>
                    <td className="table-td text-clinic-700 font-medium">
                      {s.support_transport_fee > 0 ? `¥${s.support_transport_fee.toLocaleString()}` : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="table-td text-xs min-w-[160px]">
                      {s.pay_type === 'hourly' && (s.rate_details ?? []).length > 0 ? (
                        <div className="space-y-1">
                          {(s.rate_details as {rate:number;min:number;amount:number}[]).sort((a,b)=>a.rate-b.rate).map(d => (
                            <div key={d.rate} className="flex items-baseline gap-1.5 whitespace-nowrap">
                              <span className="text-gray-400 text-xs w-[72px] shrink-0">¥{d.rate.toLocaleString()}/h</span>
                              <span className="text-gray-700 font-medium">{formatMinutes(d.min)}</span>
                              <span className="text-clinic-600">¥{d.amount.toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="table-td text-xs">
                      {s.pay_type === 'hourly' && s.paid_leave_amount > 0 ? (
                        <div className="text-emerald-600 font-medium">
                          <div>{formatMinutes(s.paid_leave_min ?? 0)}</div>
                          <div>¥{s.paid_leave_amount.toLocaleString()}</div>
                        </div>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                  )
                  return rows
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  )
}
