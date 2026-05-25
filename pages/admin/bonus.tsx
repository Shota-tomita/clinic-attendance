import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/lib/auth'
import { supabase, Profile, MonthlySummary } from '@/lib/supabase'
import { calcBonus } from '@/lib/payroll'
import { formatMinutes, getCurrentMonth } from '@/lib/utils'

type BonusRow = {
  profile: Profile
  summary: MonthlySummary | null
  evaluation: number
  baseAmount: number
  result: ReturnType<typeof calcBonus> | null
}

const PERIODS = [
  { value: `${new Date().getFullYear()}-summer`, label: `${new Date().getFullYear()}年 夏季賞与` },
  { value: `${new Date().getFullYear()}-winter`, label: `${new Date().getFullYear()}年 冬季賞与` },
  { value: `${new Date().getFullYear() - 1}-summer`, label: `${new Date().getFullYear() - 1}年 夏季賞与` },
  { value: `${new Date().getFullYear() - 1}-winter`, label: `${new Date().getFullYear() - 1}年 冬季賞与` },
]

// 対象月（夏=4〜6月、冬=10〜12月）
const getPeriodMonths = (period: string) => {
  const [year, season] = period.split('-')
  if (season === 'summer') return [`${year}-04`, `${year}-05`, `${year}-06`]
  return [`${year}-10`, `${year}-11`, `${year}-12`]
}

export default function BonusPage() {
  const { user, profile, loading, isAdmin } = useAuth()
  const router = useRouter()
  const [period, setPeriod] = useState(PERIODS[0].value)
  const [rows, setRows] = useState<BonusRow[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [lateRate, setLateRate] = useState(1)    // %
  const [absentRate, setAbsentRate] = useState(2) // %

  useEffect(() => {
    if (!loading) {
      if (!user) router.replace('/login')
      else if (!isAdmin) router.replace('/dashboard')
    }
  }, [user, loading, isAdmin])

  useEffect(() => { if (isAdmin) fetchData() }, [isAdmin, period])

  const fetchData = async () => {
    const months = getPeriodMonths(period)

    // スタッフ一覧
    const { data: staffList } = await supabase
      .from('profiles')
      .select('*')
      .neq('role', 'admin')
      .order('name')

    // 期間の月次サマリーを集計
    const { data: summaries } = await supabase
      .from('monthly_summaries')
      .select('*')
      .in('year_month', months)

    // 既存の評価を取得
    const { data: evaluations } = await supabase
      .from('bonus_evaluations')
      .select('*')
      .eq('period', period)

    const newRows: BonusRow[] = (staffList ?? []).map(s => {
      // 期間の月次データを合算
      const staffSummaries = (summaries ?? []).filter(sm => sm.user_id === s.id)
      const merged: MonthlySummary = {
        id: '', user_id: s.id, year_month: period,
        scheduled_days: staffSummaries.reduce((sum, m) => sum + m.scheduled_days, 0),
        actual_days: staffSummaries.reduce((sum, m) => sum + m.actual_days, 0),
        absent_days: staffSummaries.reduce((sum, m) => sum + m.absent_days, 0),
        late_count: staffSummaries.reduce((sum, m) => sum + m.late_count, 0),
        late_total_minutes: staffSummaries.reduce((sum, m) => sum + m.late_total_minutes, 0),
        early_leave_count: staffSummaries.reduce((sum, m) => sum + m.early_leave_count, 0),
        early_leave_total_minutes: staffSummaries.reduce((sum, m) => sum + m.early_leave_total_minutes, 0),
        overtime_total_minutes: staffSummaries.reduce((sum, m) => sum + m.overtime_total_minutes, 0),
        deduction_total_minutes: staffSummaries.reduce((sum, m) => sum + m.deduction_total_minutes, 0),
        paid_leave_days: staffSummaries.reduce((sum, m) => sum + m.paid_leave_days, 0),
        created_at: '', updated_at: '',
      }

      const existing = (evaluations ?? []).find(e => e.user_id === s.id)
      const evalScore = existing?.evaluation_score ?? 5
      const baseAmt = existing?.base_amount ?? Math.round((s.base_salary ?? 0) * 0.3)

      const result = calcBonus({
        baseAmount: baseAmt,
        evaluationScore: evalScore,
        lateCount: merged.late_count,
        absentDays: merged.absent_days,
        lateDeductionRate: lateRate / 100,
        absentDeductionRate: absentRate / 100,
      })

      return {
        profile: s,
        summary: merged,
        evaluation: evalScore,
        baseAmount: baseAmt,
        result,
      }
    })

    setRows(newRows)
  }

  const updateRow = (idx: number, field: 'evaluation' | 'baseAmount', val: number) => {
    setRows(rows => rows.map((r, i) => {
      if (i !== idx) return r
      const newEval = field === 'evaluation' ? val : r.evaluation
      const newBase = field === 'baseAmount' ? val : r.baseAmount
      const result = calcBonus({
        baseAmount: newBase,
        evaluationScore: newEval,
        lateCount: r.summary?.late_count ?? 0,
        absentDays: r.summary?.absent_days ?? 0,
        lateDeductionRate: lateRate / 100,
        absentDeductionRate: absentRate / 100,
      })
      return { ...r, evaluation: newEval, baseAmount: newBase, result }
    }))
  }

  const handleSave = async () => {
    setSaving(true)
    for (const row of rows) {
      await supabase.from('bonus_evaluations').upsert({
        user_id: row.profile.id,
        period,
        evaluation_score: row.evaluation,
        base_amount: row.baseAmount,
        late_deduction_rate: lateRate / 100,
        absent_deduction_rate: absentRate / 100,
        calculated_amount: row.result?.finalAmount ?? 0,
        created_by: user?.id,
      }, { onConflict: 'user_id,period' })
    }
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const totalBonus = rows.reduce((s, r) => s + (r.result?.finalAmount ?? 0), 0)

  if (loading || !profile) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-4xl animate-pulse">🏥</div>
    </div>
  )

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">💰 ボーナス試算</h1>
            <p className="text-xs text-gray-400 mt-0.5">基本給・評価・遅刻・欠勤をもとに試算します</p>
          </div>
          <div className="flex gap-2 items-center">
            {saved && <span className="text-xs text-emerald-600">✅ 保存しました</span>}
            <button onClick={handleSave} disabled={saving} className="btn-primary text-sm">
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>

        {/* 期間・控除率設定 */}
        <div className="card grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="col-span-2">
            <label className="label">賞与期間</label>
            <select className="select" value={period} onChange={e => setPeriod(e.target.value)}>
              {PERIODS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">遅刻1回あたりの控除率</label>
            <div className="flex items-center gap-2">
              <input type="number" className="input" min={0} max={10} step={0.5}
                value={lateRate}
                onChange={e => setLateRate(Number(e.target.value))} />
              <span className="text-sm text-gray-500">%</span>
            </div>
          </div>
          <div>
            <label className="label">欠勤1日あたりの控除率</label>
            <div className="flex items-center gap-2">
              <input type="number" className="input" min={0} max={10} step={0.5}
                value={absentRate}
                onChange={e => setAbsentRate(Number(e.target.value))} />
              <span className="text-sm text-gray-500">%</span>
            </div>
          </div>
        </div>

        {/* 試算テーブル */}
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-max">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="table-th">氏名</th>
                  <th className="table-th">遅刻</th>
                  <th className="table-th">欠勤</th>
                  <th className="table-th">ベース額</th>
                  <th className="table-th">評価（/10）</th>
                  <th className="table-th">評価後基準</th>
                  <th className="table-th">遅刻控除</th>
                  <th className="table-th">欠勤控除</th>
                  <th className="table-th font-bold text-clinic-700">支給額</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((row, i) => (
                  <tr key={row.profile.id} className="hover:bg-gray-50">
                    <td className="table-td font-medium">
                      <div>{row.profile.name}</div>
                      <div className="text-xs text-gray-400">
                        基本給 ¥{(row.profile.base_salary ?? 0).toLocaleString()}
                      </div>
                    </td>
                    <td className="table-td">
                      <span className={row.summary?.late_count ? 'text-amber-600 font-medium' : 'text-gray-400'}>
                        {row.summary?.late_count ?? 0}回
                      </span>
                    </td>
                    <td className="table-td">
                      <span className={row.summary?.absent_days ? 'text-red-500 font-medium' : 'text-gray-400'}>
                        {row.summary?.absent_days ?? 0}日
                      </span>
                    </td>
                    <td className="table-td">
                      <input
                        type="number"
                        className="input w-28 text-sm"
                        min={0}
                        value={row.baseAmount}
                        onChange={e => updateRow(i, 'baseAmount', Number(e.target.value))}
                      />
                    </td>
                    <td className="table-td">
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          className="input w-16 text-sm text-center"
                          min={0} max={10} step={0.5}
                          value={row.evaluation}
                          onChange={e => updateRow(i, 'evaluation', Number(e.target.value))}
                        />
                        <span className="text-xs text-gray-400">/ 10</span>
                      </div>
                    </td>
                    <td className="table-td text-gray-600">
                      ¥{(row.result?.baseAmount ?? 0).toLocaleString()}
                    </td>
                    <td className="table-td text-amber-600">
                      {row.result?.lateDeduction ? `-¥${row.result.lateDeduction.toLocaleString()}` : '—'}
                    </td>
                    <td className="table-td text-red-500">
                      {row.result?.absentDeduction ? `-¥${row.result.absentDeduction.toLocaleString()}` : '—'}
                    </td>
                    <td className="table-td">
                      <span className="text-base font-bold text-clinic-700">
                        ¥{(row.result?.finalAmount ?? 0).toLocaleString()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 border-t border-gray-200">
                <tr>
                  <td colSpan={8} className="table-td text-right font-medium text-gray-600">合計支給額</td>
                  <td className="table-td font-bold text-lg text-clinic-700">
                    ¥{totalBonus.toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* 評価倍率の説明 */}
        <div className="card bg-blue-50 border-blue-100 text-xs text-blue-700 space-y-1">
          <div className="font-semibold">評価倍率の計算式</div>
          <div>評価点数 ÷ 10 × 2 = 倍率（0点=0倍・5点=1倍・10点=2倍）</div>
          <div>例: 評価7点 × ベース30万円 → 基準額42万円、遅刻2回(1%×2) = -8,400円控除</div>
        </div>
      </div>
    </Layout>
  )
}
