// pages/api/timecard-ocr.ts
// タイムカード画像をClaude APIで構造化データに変換
import type { NextApiRequest, NextApiResponse } from 'next'

export const config = {
  api: { bodyParser: { sizeLimit: '4mb' } },
}

const SYSTEM_PROMPT = `あなたはアマノAカード（タイムカード）読み取りの専門家です。
日本の眼科クリニックのタイムカードスキャン画像から打刻データを正確に抽出します。

## カードのレイアウト
- 表面（青系）= 1日〜15日、裏面（赤系）= 16日〜31日
- ヘッダー: NO. / 氏名 / 所属 / 「R8年6月分」等の年月表記
- 表の列構成（左から）: 日付 | 定時出 | 時間内退 | 時間内出 | 定時退 | 時間外 | 小計
- 打刻の印字形式: 曜日文字＋時刻（例「月 8:41」「火13:12」「±13:29」※±は土曜）

## 読み取りルール（重要）
1. 手書きの修正・追記は印字より優先する（二重線で消された印字は無視）
2. 「有休」「有給」と書かれた日 → status: "paid_leave"（打刻はnull）
3. 「欠勤」と書かれた日 → status: "absent"
4. 「代休」→ status: "substitute_holiday"
5. 空欄の日は出力しない
6. 打刻が2つだけの日 → am_in, am_out に入れる（列位置が右寄り＝午後のみの場合は pm_in, pm_out）
7. 打刻が4つの日 → 左から am_in, am_out, pm_in, pm_out
8. 打刻が3つの日 → 列位置から判断（時間内退が空なら am_in, pm_in, pm_out）
9. 画像が上下逆・横向きの場合も回転して読み取る
10. 判読困難・手書きが曖昧な箇所は confidence: "low" を付け、note に理由を書く
11. 時刻は必ず "H:MM" または "HH:MM" 形式で出力
12. 「遅延証明あり」等のメモは note に記載

## 出力形式
JSONのみを出力（マークダウン記法・説明文は一切不要）:
{
  "cards": [
    {
      "name": "氏名（手書きのまま）",
      "affiliation": "所属（城山コンタクト/富田眼科クリニック等）",
      "side": "front" または "back",
      "days": [
        {
          "day": 1,
          "am_in": "8:41", "am_out": "13:12",
          "pm_in": "15:11", "pm_out": "18:38",
          "status": "present",
          "confidence": "high",
          "note": ""
        }
      ]
    }
  ]
}
打刻がないフィールドは null。statusは present/paid_leave/absent/substitute_holiday のいずれか。`

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY 未設定' })

  const { images, month } = req.body as { images: string[]; month: string }
  if (!images?.length) return res.status(400).json({ error: '画像がありません' })

  try {
    const content: any[] = images.map(b64 => ({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: b64 },
    }))
    content.push({
      type: 'text',
      text: `対象年月: ${month}。上記のタイムカード画像をすべて読み取り、指定のJSON形式で出力してください。`,
    })

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content }],
      }),
    })

    if (!resp.ok) {
      const err = await resp.text()
      return res.status(502).json({ error: `Claude API error: ${err.slice(0, 500)}` })
    }

    const data = await resp.json()
    const text = (data.content ?? [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n')

    // JSON抽出（```json フェンス対策）
    const clean = text.replace(/```json|```/g, '').trim()
    const jsonStart = clean.indexOf('{')
    const jsonEnd = clean.lastIndexOf('}')
    if (jsonStart === -1 || jsonEnd === -1) {
      return res.status(500).json({ error: 'JSON解析失敗', raw: clean.slice(0, 1000) })
    }
    const parsed = JSON.parse(clean.slice(jsonStart, jsonEnd + 1))
    return res.status(200).json(parsed)
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
}
