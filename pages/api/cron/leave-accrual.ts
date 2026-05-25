import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { calcGrantDays, executeLeaveAccrual } from '@/lib/payroll'
import { notifyTemplates, notifyStaff } from '@/lib/notify'
import { differenceInMonths, format } from 'date-fns'

// サービスロールキーを使用（RLSをバイパス）
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Vercel Cron または 手動実行のみ許可
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const today = new Date()
  const todayStr = format(today, 'yyyy-MM-dd')
  const results: any[] = []

  try {
    // 全スタッフを取得
    const { data: staffList } = await supabaseAdmin
      .from('profiles')
      .select('id, name, hire_date, weekly_scheduled_days')
      .not('hire_date', 'is', null)

    for (const staff of staffList ?? []) {
      const hireDate = new Date(staff.hire_date)
      const monthsOfService = differenceInMonths(today, hireDate)

      // 付与タイミングの日付と一致するか確認
      const accrualMonths = [6, 18, 30, 42, 54, 66, 78]
      const isAccrualDay = accrualMonths.some(m => {
        const accrualDate = new Date(hireDate)
        accrualDate.setMonth(accrualDate.getMonth() + m)
        return format(accrualDate, 'yyyy-MM-dd') === todayStr
      })

      if (!isAccrualDay) continue

      // 既に今日付与済みか確認
      const { data: existing } = await supabaseAdmin
        .from('leave_accrual_history')
        .select('id')
        .eq('user_id', staff.id)
        .eq('accrual_date', todayStr)
        .single()

      if (existing) continue

      // 付与実行
      const result = await executeLeaveAccrual(staff.id)
      if (result?.success) {
        results.push({ userId: staff.id, name: staff.name, ...result })

        // 通知送信
        const tmpl = notifyTemplates.leaveAccrual(staff.name, result.granted, result.newBalance)
        await notifyStaff({
          userId: staff.id,
          title: tmpl.title,
          message: tmpl.message,
          type: 'leave_accrual',
        })
      }
    }

    return res.status(200).json({ processed: results.length, results })
  } catch (e) {
    return res.status(500).json({ error: String(e) })
  }
}
