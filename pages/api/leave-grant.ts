// pages/api/leave-grant.ts
// 有給付与処理APIエンドポイント
// スタッフ管理画面ロード時・または手動実行時に呼び出す

import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { processLeaveGrants, calcNextGrantDate, calcTenureMonths, calcGrantDays } from '@/lib/leaveGrant'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { updated, error } = await processLeaveGrants(supabase)
  if (error) return res.status(500).json({ error })

  return res.status(200).json({ updated })
}
