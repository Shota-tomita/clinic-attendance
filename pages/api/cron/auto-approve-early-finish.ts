import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // 3日以上前の承認待ち早上がりを自動承認
  const threeDaysAgo = new Date()
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
  const cutoff = threeDaysAgo.toISOString().split('T')[0]

  const { data: pending } = await supabase
    .from('attendance_records')
    .select('id')
    .eq('early_finish_status', 'pending')
    .lte('date', cutoff)

  let approved = 0
  for (const record of pending ?? []) {
    await supabase.from('attendance_records').update({
      early_finish_status: 'approved',
      early_finish_reviewed_at: new Date().toISOString(),
    }).eq('id', record.id)
    approved++
  }

  return res.status(200).json({ approved, message: `${approved}件を自動承認しました` })
}
