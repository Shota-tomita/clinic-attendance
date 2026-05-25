import { supabase } from './supabase'

// ─── LINE WORKS通知 ────────────────────────────────────

type LWNotifyParams = {
  userId: string        // 受信者のプロフィールID
  title: string
  message: string
  type: string
  referenceId?: string
}

/**
 * LINE WORKSにBot メッセージを送信
 * フリープランのAPIを使用（60req/min制限あり）
 */
export async function sendLineWorksMessage(params: LWNotifyParams): Promise<boolean> {
  try {
    // LINE WORKS設定を取得
    const { data: settings } = await supabase
      .from('lineworks_settings')
      .select('*')
      .single()

    if (!settings?.is_enabled || !settings.bot_id) return false

    // スタッフのLINE WORKSユーザーIDを取得
    const { data: profile } = await supabase
      .from('profiles')
      .select('lineworks_user_id, email, name')
      .eq('id', params.userId)
      .single()

    if (!profile?.lineworks_user_id) return false

    // アクセストークンを取得（JWT認証）
    const token = await getLWAccessToken(settings)
    if (!token) return false

    // メッセージ送信
    const res = await fetch(
      `https://www.worksapis.com/v1.0/bots/${settings.bot_id}/users/${profile.lineworks_user_id}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: {
            type: 'text',
            text: `【クリニック勤怠管理】\n${params.title}\n\n${params.message}`,
          }
        }),
      }
    )

    const success = res.ok
    // 通知ログを保存
    await supabase.from('notification_logs').insert({
      user_id: params.userId,
      channel: 'lineworks',
      type: params.type,
      reference_id: params.referenceId ?? null,
      title: params.title,
      body: params.message,
      status: success ? 'sent' : 'failed',
    })

    return success
  } catch (e) {
    console.error('LINE WORKS notification error:', e)
    return false
  }
}

// LINE WORKSアクセストークン取得（JWT方式）
async function getLWAccessToken(settings: any): Promise<string | null> {
  try {
    // JWT生成はサーバーサイドで行う必要があるため
    // Next.js APIルートを経由する
    const res = await fetch('/api/lineworks/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: settings.client_id,
        service_account: settings.service_account,
        private_key: settings.private_key,
      }),
    })
    if (!res.ok) return null
    const { access_token } = await res.json()
    return access_token
  } catch {
    return null
  }
}

// ─── メール通知（Resend）─────────────────────────────

type EmailParams = {
  userId: string
  to: string
  subject: string
  html: string
  type: string
  referenceId?: string
}

export async function sendEmail(params: EmailParams): Promise<boolean> {
  try {
    const res = await fetch('/api/notify/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    return res.ok
  } catch {
    return false
  }
}

// ─── 通知テンプレート ─────────────────────────────────

export const notifyTemplates = {
  shiftConfirmed: (staffName: string, yearMonth: string) => ({
    title: 'シフトが確定しました',
    message: `${staffName} さんの ${yearMonth} のシフトが確定しました。\nアプリからご確認ください。`,
  }),

  leaveApproved: (staffName: string, startDate: string, endDate: string) => ({
    title: '休暇申請が承認されました',
    message: `${staffName} さんの ${startDate}〜${endDate} の休暇申請が承認されました。`,
  }),

  leaveRejected: (staffName: string, startDate: string) => ({
    title: '休暇申請が却下されました',
    message: `${startDate} の休暇申請が却下されました。詳細はアプリでご確認ください。`,
  }),

  specialLeaveTurn: (staffName: string, date: string, expiresAt: string) => ({
    title: '特別有給の順番が回ってきました',
    message: `${staffName} さん、${date} の特別有給（連休前後）の順番が回ってきました。\n${expiresAt} までに回答してください。\nアプリの「休暇申請」からご確認ください。`,
  }),

  leaveAccrual: (staffName: string, granted: number, balance: number) => ({
    title: '有給が付与されました',
    message: `${staffName} さんに有給が ${granted}日 付与されました。\n現在の残日数: ${balance}日`,
  }),

  earlyFinishPending: (staffName: string, date: string) => ({
    title: '早上がり承認リクエスト',
    message: `${staffName} さんの ${date} の早上がりが承認待ちです。\nアプリの「勤怠履歴」から承認してください。`,
  }),
}

// ─── 一括通知（シフト確定など）────────────────────────

export async function notifyStaff(params: {
  userId: string
  title: string
  message: string
  type: string
  referenceId?: string
}): Promise<void> {
  // LINE WORKSが有効なら優先
  const lwSent = await sendLineWorksMessage(params)

  // LINE WORKSが使えない場合はメール
  if (!lwSent) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('email, name')
      .eq('id', params.userId)
      .single()

    if (profile?.email) {
      await sendEmail({
        userId: params.userId,
        to: profile.email,
        subject: `【クリニック勤怠管理】${params.title}`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1f7450;">🏥 クリニック勤怠管理</h2>
            <h3>${params.title}</h3>
            <p style="white-space: pre-line;">${params.message}</p>
            <hr/>
            <p style="color: #888; font-size: 12px;">このメールはシステムから自動送信されています。</p>
          </div>
        `,
        type: params.type,
        referenceId: params.referenceId,
      })
    }
  }
}
