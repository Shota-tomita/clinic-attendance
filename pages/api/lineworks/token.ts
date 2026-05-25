import type { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const { client_id, service_account, private_key } = req.body

  try {
    // JWTを生成してLINE WORKSのトークンエンドポイントに送信
    // 注意: Node.js環境でのJWT生成にはjsonwebtokenが必要
    // package.jsonに "jsonwebtoken": "^9.0.0" を追加してください

    const jwt = require('jsonwebtoken')

    const now = Math.floor(Date.now() / 1000)
    const payload = {
      iss: client_id,
      sub: service_account,
      iat: now,
      exp: now + 3600,
    }

    const assertion = jwt.sign(payload, private_key, { algorithm: 'RS256' })

    const tokenRes = await fetch('https://auth.worksmobile.com/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        assertion,
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        client_id,
        client_secret: '',
        scope: 'bot',
      }),
    })

    if (!tokenRes.ok) {
      return res.status(500).json({ error: 'Token fetch failed' })
    }

    const data = await tokenRes.json()
    return res.status(200).json({ access_token: data.access_token })
  } catch (e) {
    return res.status(500).json({ error: String(e) })
  }
}
