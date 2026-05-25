import type { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const { to, subject, html, userId, type, referenceId } = req.body
  const apiKey = process.env.RESEND_API_KEY

  if (!apiKey) {
    return res.status(500).json({ error: 'RESEND_API_KEY not configured' })
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL ?? 'noreply@clinic.jp',
        to,
        subject,
        html,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      return res.status(500).json({ error })
    }

    return res.status(200).json({ success: true })
  } catch (e) {
    return res.status(500).json({ error: String(e) })
  }
}
