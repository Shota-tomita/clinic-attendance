import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'

type ShiftBlock = {
  sort_order: number
  label: string
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

  const hasAmShift = shiftBlocks.some(b => b.sort_order === 0)
  const hasPmShift = shiftBlocks.some(b => b.sort_order === 1)

  const getNextAction = (): { label: string; type: string | null; color: string } => {
    if (!record) {
      return { label: '出勤', type: 'am_in', color: 'bg-emerald-500' }
    }
    if (!record.am_clock_in && !record.am_leave) {
      return { label: '出勤', type: 'am_in', color: 'bg-emerald-500' }
    }
    if (record.am_clock_in && !record.am_clock_out && hasAmShift && hasPmShift) {
      return { label: '午前退勤', type: 'am_out', color: 'bg-amber-500' }
    }
    if ((record.am_clock_out || record.am_leave) && !record.pm_clock_in && hasPmShift) {
      return { label: '午後出勤', type: 'pm_in', color: 'bg-emerald-500' }
    }
    if (record.pm_clock_in && !record.pm_clock_out) {
      return { label: '退勤', type: 'pm_out', color: 'bg-red-500' }
    }
    if (record.am_clock_in && !record.am_clock_out && !hasPmShift) {
      return { label: '退勤', type: 'am_out', color: 'bg-red-500' }
    }
    return { label: '打刻済み', type: null, color: 'bg-gray-400' }
  }

  const handleClock = async () => {
    if (saving) return
    const action = getNextAction()
    if (!action.type) return

    setSaving(true)
    const nowISO = new Date().toISOString()

    if (!record) {
      const { data } = await supabase.from('attendance_records').insert({
        user_id: user!.id,
        date: today,
        am_clock_in: action.type === 'am_in' ? nowISO : null,
        clock_in: action.type === 'am_in' ? nowISO : null,
        status: 'present',
        clock_out_reason: 'normal',
        early_finish_status: 'not_required',
      }).select().single()
      setRecord(data)
    } else {
      const update: any = {}
      if (action.type === 'am_in') { update.am_clock_in = nowISO; update.clock_in = nowISO }
      if (action.type === 'am_out') update.am_clock_out = nowISO
      if (action.type === 'pm_in') update.pm_clock_in = nowISO
      if (action.type === 'pm_out') { update.pm_clock_out = nowISO; update.clock_out = nowISO }
      await supabase.from('attendance_records').update(update).eq('id', record.id)
      fetchRecord(today)
    }
    setSaving(false)
  }

  const formatTime = (iso: string | null) => {
    if (!iso) return '--:--'
    return format(new Date(iso), 'HH:mm')
  }

  const nextAction = getNextAction()

  if (loading || !profile) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-4xl animate-pulse">🏥</div>
    </div>
  )

  return (
    <Layout>
      <div className="max-w-sm mx-auto space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">⏱️ 出退勤打刻</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {format(now, 'yyyy年M月d日(EEE)', { locale: ja })}
          </p>
        </div>

        <div className="card text-center py-6">
          <div className="text-5xl font-bold text-gray-800 tabular-nums">
            {format(now, 'HH:mm:ss')}
          </div>
        </div>

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

        <div className="card space-y-3">
          <div className="text-sm font-medium text-gray-700">本日の打刻状況</div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: '午前出勤', value: record?.am_clock_in, color: 'text-emerald-600' },
              { label: '午前退勤', value: record?.am_clock_out, color: 'text-amber-600', leave: record?.am_leave },
              { label: '午後出勤', value: record?.pm_clock_in, color: 'text-emerald-600', leave: record?.pm_leave },
              { label: '午後退勤', value: record?.pm_clock_out, color: 'text-red-500', leave: record?.pm_leave },
            ].map(item => (
              <div key={item.label} className="bg-gray-50 rounded-xl p-3 text-center">
                <div className="text-xs text-gray-400 mb-1">{item.label}</div>
                <div className={`text-base font-bold ${item.value ? item.color : 'text-gray-300'}`}>
                  {item.leave ? '有給' : formatTime(item.value ?? null)}
                </div>
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={handleClock}
          disabled={saving || !nextAction.type}
          className={`w-full py-5 rounded-2xl text-white text-xl font-bold shadow-lg transition-all
            ${nextAction.type ? `${nextAction.color} active:scale-95` : 'bg-gray-300'}`}
        >
          {saving ? '打刻中...' : nextAction.label}
        </button>

        {nextAction.type && (
          <p className="text-xs text-center text-gray-400">
            {nextAction.type === 'am_in' && '午前の勤務を開始します'}
            {nextAction.type === 'am_out' && '午前の勤務を終了します（昼休み）'}
            {nextAction.type === 'pm_in' && '午後の勤務を開始します'}
            {nextAction.type === 'pm_out' && '本日の勤務を終了します'}
          </p>
        )}
      </div>
    </Layout>
  )
}
