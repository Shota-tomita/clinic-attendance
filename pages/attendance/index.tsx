import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { format, differenceInMinutes, parseISO } from 'date-fns'
import { ja } from 'date-fns/locale'

type ShiftBlock = {
  sort_order: number
  start_time: string
  end_time: string
}

export default function AttendancePage() {
  const { user, profile, loading } = useAuth()
  const router = useRouter()
  const [today, setToday] = useState('')
  const [record, setRecord] = useState<any>(null)
  const [shiftBlocks, setShiftBlocks] = useState<ShiftBlock[]>([])
  const [saving, setSaving] = useState(false)
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [user, loading])

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (user) {
      const t = format(new Date(), 'yyyy-MM-dd')
      setToday(t)
      fetchRecord(t)
      fetchShift(t)
    }
  }, [user])

  const fetchRecord = async (date: string) => {
    const { data } = await supabase
      .from('attendance_records')
      .select('*')
      .eq('user_id', user!.id)
      .eq('date', date)
      .single()
    setRecord(data ?? null)
  }

  const fetchShift = async (date: string) => {
    const { data } = await supabase
      .from('shift_assignments')
      .select('shift_patterns(shift_pattern_blocks(*))')
      .eq('user_id', user!.id)
      .eq('date', date)
      .single()
    if (data?.shift_patterns) {
      const blocks = (data.shift_patterns as any).shift_pattern_blocks ?? []
      setShiftBlocks(blocks.sort((a: ShiftBlock, b: ShiftBlock) => a.sort_order - b.sort_order))
    }
  }

  const hasAmShift = shiftBlocks.length === 0 || shiftBlocks.some(b => b.sort_order === 0)
  const hasPmShift = shiftBlocks.length === 0 || shiftBlocks.some(b => b.sort_order === 1)

  // 早上がりかどうか判定（退勤時）
  const calcEarlyMinutes = (clockOutISO: string, isAm: boolean): number => {
    const block = shiftBlocks.find(b => b.sort_order === (isAm ? 0 : shiftBlocks.length - 1))
    if (!block) return 0
    const [eh, em] = block.end_time.split(':').map(Number)
    const scheduledEnd = new Date(`${today}T${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}:00`)
    const diff = differenceInMinutes(scheduledEnd, parseISO(clockOutISO))
    return Math.max(diff, 0)
  }

  // 次のアクションを判定
  const getPhase = (): 'am_in' | 'am_out' | 'pm_in' | 'pm_out' | 'done' => {
    if (!record || (!record.am_clock_in && !record.am_leave)) return 'am_in'
    if (record.am_clock_in && !record.am_clock_out && hasAmShift && hasPmShift) return 'am_out'
    if ((record.am_clock_out || record.am_leave) && !record.pm_clock_in && hasPmShift) return 'pm_in'
    if (record.pm_clock_in && !record.pm_clock_out) return 'pm_out'
    if (record.am_clock_in && !record.am_clock_out && !hasPmShift) return 'pm_out'
    return 'done'
  }

  const phase = getPhase()

  const handleClock = async (isEarlyLeave: boolean = false) => {
    if (saving) return
    setSaving(true)
    const nowISO = new Date().toISOString()

    if (phase === 'am_in') {
      if (!record) {
        const { data } = await supabase.from('attendance_records').insert({
          user_id: user!.id,
          date: today,
          am_clock_in: nowISO,
          clock_in: nowISO,
          status: 'present',
          clock_out_reason: 'normal',
          early_finish_status: 'not_required',
        }).select().single()
        setRecord(data)
      } else {
        await supabase.from('attendance_records').update({
          am_clock_in: nowISO, clock_in: nowISO
        }).eq('id', record.id)
        fetchRecord(today)
      }
    } else if (phase === 'am_out' || phase === 'pm_out') {
      const isAm = phase === 'am_out'
      const update: any = {}

      if (isEarlyLeave) {
        // 早退
        if (isAm) {
          update.am_clock_out = nowISO
        } else {
          update.pm_clock_out = nowISO
          update.clock_out = nowISO
        }
        update.status = 'early_leave'
        update.clock_out_reason = 'early_leave'
        update.early_finish_status = 'not_required'
      } else {
        // 退勤（早上がりフロー）
        if (isAm) {
          update.am_clock_out = nowISO
        } else {
          update.pm_clock_out = nowISO
          update.clock_out = nowISO
        }
        update.clock_out_reason = 'normal'

        // 早上がり判定
        const earlyMin = calcEarlyMinutes(nowISO, isAm)
        if (earlyMin >= 30) {
          update.early_finish_status = 'pending'
          update.status = 'present'
        } else if (earlyMin > 0) {
          // 30分未満 → 3日後自動承認（pending扱いだが短時間）
          update.early_finish_status = 'pending'
          update.status = 'present'
        } else {
          update.early_finish_status = 'not_required'
          update.status = 'present'
        }
      }

      await supabase.from('attendance_records').update(update).eq('id', record.id)
      fetchRecord(today)
    } else if (phase === 'pm_in') {
      await supabase.from('attendance_records').update({
        pm_clock_in: nowISO
      }).eq('id', record.id)
      fetchRecord(today)
    }

    setSaving(false)
  }

  const formatTimeStr = (iso: string | null) => {
    if (!iso) return '--:--'
    return format(new Date(iso), 'HH:mm')
  }

  if (loading || !profile) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-4xl animate-pulse">🏥</div>
    </div>
  )

  const isClockOut = phase === 'am_out' || phase === 'pm_out'

  return (
    <Layout>
      <div className="max-w-sm mx-auto space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">⏱️ 出退勤打刻</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {format(now, 'yyyy年M月d日(EEE)', { locale: ja })}
          </p>
        </div>

        {/* 現在時刻 */}
        <div className="card text-center py-6">
          <div className="text-5xl font-bold text-gray-800 tabular-nums">
            {format(now, 'HH:mm:ss')}
          </div>
        </div>

        {/* シフト情報 */}
        {shiftBlocks.length > 0 && (
          <div className="card bg-clinic-50 border-clinic-100 space-y-1.5">
            <div className="text-xs font-medium text-clinic-700">本日のシフト</div>
            {shiftBlocks.map(b => (
              <div key={b.sort_order} className="flex items-center gap-2 text-sm">
                <span className="text-clinic-500 text-xs">{b.sort_order === 0 ? '午前' : '午後'}</span>
                <span className="font-medium text-clinic-800">
                  {b.start_time.slice(0, 5)} 〜 {b.end_time.slice(0, 5)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* 打刻状況 */}
        <div className="card space-y-3">
          <div className="text-sm font-medium text-gray-700">本日の打刻状況</div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: '午前出勤', value: record?.am_clock_in, color: 'text-emerald-600' },
              { label: '午前退勤', value: record?.am_clock_out, color: 'text-amber-600' },
              { label: '午後出勤', value: record?.pm_clock_in, color: 'text-emerald-600' },
              { label: '午後退勤', value: record?.pm_clock_out, color: 'text-red-500' },
            ].map(item => (
              <div key={item.label} className="bg-gray-50 rounded-xl p-3 text-center">
                <div className="text-xs text-gray-400 mb-1">{item.label}</div>
                <div className={`text-base font-bold ${item.value ? item.color : 'text-gray-300'}`}>
                  {formatTimeStr(item.value ?? null)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 打刻ボタン */}
        {phase === 'done' ? (
          <div className="card text-center py-4 text-clinic-600 font-medium">
            本日の打刻は完了しています ✅
          </div>
        ) : phase === 'pm_in' ? (
          <button onClick={() => handleClock(false)} disabled={saving}
            className="w-full py-5 rounded-2xl text-white text-xl font-bold shadow-lg bg-emerald-500 active:scale-95 transition-all">
            {saving ? '打刻中...' : '午後出勤'}
          </button>
        ) : phase === 'am_in' ? (
          <button onClick={() => handleClock(false)} disabled={saving}
            className="w-full py-5 rounded-2xl text-white text-xl font-bold shadow-lg bg-emerald-500 active:scale-95 transition-all">
            {saving ? '打刻中...' : '出勤'}
          </button>
        ) : isClockOut ? (
          <div className="space-y-3">
            <button onClick={() => handleClock(false)} disabled={saving}
              className="w-full py-4 rounded-2xl text-white text-lg font-bold shadow-lg bg-red-500 active:scale-95 transition-all">
              {saving ? '打刻中...' : phase === 'am_out' ? '午前退勤' : '退勤'}
            </button>
            <button onClick={() => handleClock(true)} disabled={saving}
              className="w-full py-4 rounded-2xl text-white text-lg font-bold shadow-lg bg-orange-400 active:scale-95 transition-all">
              {saving ? '打刻中...' : phase === 'am_out' ? '午前早退' : '早退'}
            </button>
          </div>
        ) : null}
      </div>
    </Layout>
  )
}
