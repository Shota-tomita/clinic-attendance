// pages/admin/timecard-import.tsx
// タイムカードPDF取り込み画面
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/lib/auth'
import { supabase, Profile } from '@/lib/supabase'
import { getCurrentMonth } from '@/lib/utils'
import { format, subMonths, parseISO } from 'date-fns'

// ===== 氏名正規化（異体字・スペース対応） =====
const CHAR_MAP: Record<string, string> = {
  '髙': '高', '﨑': '崎', '邊': '邉', '斎': '斉', '齋': '斉', '齊': '斉',
  '澤': '沢', '濱': '浜', '國': '国', '眞': '真', '祐': '裕',
}
function normalizeName(name: string): string {
  let n = (name ?? '').replace(/[\s　]/g, '')
  for (const [from, to] of Object.entries(CHAR_MAP)) n = n.split(from).join(to)
  return n
}
function matchProfile(cardName: string, profiles: Profile[]): Profile | null {
  const target = normalizeName(cardName)
  // 完全一致
  let hit = profiles.find(p => normalizeName(p.name) === target)
  if (hit) return hit
  // 部分一致（姓のみ等）
  hit = profiles.find(p => {
    const pn = normalizeName(p.name)
    return pn.includes(target) || target.includes(pn)
  })
  return hit ?? null
}

// ===== 型 =====
type OcrDay = {
  day: number
  am_in: string | null; am_out: string | null
  pm_in: string | null; pm_out: string | null
  status: string; confidence?: string; note?: string
}
type OcrCard = { name: string; affiliation?: string; side?: string; days: OcrDay[] }
type MergedCard = {
  key: string
  name: string
  affiliation?: string
  matchedProfile: Profile | null
  days: OcrDay[]
}

export default function TimecardImportPage() {
  const { user, profile, loading, isAdmin } = useAuth()
  const router = useRouter()

  const [month, setMonth] = useState(getCurrentMonth())
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState('')
  const [cards, setCards] = useState<MergedCard[]>([])
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
    if (!loading && profile && !isAdmin) router.replace('/dashboard')
  }, [user, profile, loading])

  useEffect(() => {
    supabase.from('profiles').select('*').then(({ data }) => setProfiles(data ?? []))
  }, [])

  // ===== PDF→JPEG変換（pdfjs-dist使用） =====
  const pdfToImages = async (file: File): Promise<string[]> => {
    const pdfjsLib = await import('pdfjs-dist')
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`

    const buf = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise
    const images: string[] = []

    for (let i = 1; i <= pdf.numPages; i++) {
      setProgress(`PDF変換中 ${i}/${pdf.numPages}ページ...`)
      const page = await pdf.getPage(i)
      const viewport = page.getViewport({ scale: 2.0 })
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      const ctx = canvas.getContext('2d')!
      await page.render({ canvasContext: ctx, viewport }).promise
      // JPEG圧縮（品質0.82、~500KB/枚目安）
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82)
      images.push(dataUrl.split(',')[1])
    }
    return images
  }

  // ===== OCR実行（2ページずつバッチ＝1人分の表裏） =====
  const runOcr = async (images: string[]) => {
    const allCards: OcrCard[] = []
    const BATCH = 2
    for (let i = 0; i < images.length; i += BATCH) {
      setProgress(`AI読み取り中 ${Math.min(i + BATCH, images.length)}/${images.length}ページ...`)
      const batch = images.slice(i, i + BATCH)
      const resp = await fetch('/api/timecard-ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: batch, month }),
      })
      const data = await resp.json()
      if (data.error) {
        console.error('OCRエラー:', data.error)
        continue
      }
      allCards.push(...(data.cards ?? []))
    }
    return allCards
  }

  // ===== カード統合（同一人物の表裏をマージ） =====
  const mergeCards = (ocrCards: OcrCard[]): MergedCard[] => {
    const map = new Map<string, MergedCard>()
    for (const c of ocrCards) {
      const key = normalizeName(c.name)
      if (!map.has(key)) {
        map.set(key, {
          key, name: c.name, affiliation: c.affiliation,
          matchedProfile: matchProfile(c.name, profiles),
          days: [],
        })
      }
      const merged = map.get(key)!
      for (const d of c.days) {
        // 同じ日が既にあれば上書きしない（先勝ち）
        if (!merged.days.some(x => x.day === d.day)) merged.days.push(d)
      }
    }
    map.forEach(m => m.days.sort((a, b) => a.day - b.day))
    return Array.from(map.values())
  }

  const handleFile = async (files: FileList | null) => {
    if (!files?.length) return
    setProcessing(true)
    setCards([])
    setImportResult('')
    try {
      let allImages: string[] = []
      for (const f of Array.from(files)) {
        const imgs = await pdfToImages(f)
        allImages = allImages.concat(imgs)
      }
      const ocrCards = await runOcr(allImages)
      setCards(mergeCards(ocrCards))
      setProgress('')
    } catch (e: any) {
      setProgress(`エラー: ${e.message}`)
    }
    setProcessing(false)
  }

  // ===== セル編集 =====
  const updateDay = (cardIdx: number, dayIdx: number, field: keyof OcrDay, value: string) => {
    setCards(prev => {
      const next = [...prev]
      const days = [...next[cardIdx].days]
      days[dayIdx] = { ...days[dayIdx], [field]: value || null }
      next[cardIdx] = { ...next[cardIdx], days }
      return next
    })
  }
  const setCardProfile = (cardIdx: number, profileId: string) => {
    setCards(prev => {
      const next = [...prev]
      next[cardIdx] = { ...next[cardIdx], matchedProfile: profiles.find(p => p.id === profileId) ?? null }
      return next
    })
  }
  const removeDay = (cardIdx: number, dayIdx: number) => {
    setCards(prev => {
      const next = [...prev]
      next[cardIdx] = { ...next[cardIdx], days: next[cardIdx].days.filter((_, i) => i !== dayIdx) }
      return next
    })
  }

  // ===== インポート実行 =====
  const handleImport = async () => {
    const ready = cards.filter(c => c.matchedProfile && c.days.length > 0)
    if (ready.length === 0) { alert('インポート対象がありません'); return }
    if (!confirm(`${ready.length}名分をインポートします。同月の既存データは上書き（削除→挿入）されます。よろしいですか？`)) return

    setImporting(true)
    let ok = 0, fail = 0
    const [y, m] = month.split('-')
    const lastDay = new Date(Number(y), Number(m), 0).getDate()

    for (const c of ready) {
      const uid = c.matchedProfile!.id
      try {
        // 既存削除
        await supabase.from('attendance_records').delete()
          .eq('user_id', uid)
          .gte('date', `${month}-01`)
          .lte('date', `${month}-${String(lastDay).padStart(2, '0')}`)

        const toTs = (day: number, t: string | null) => {
          if (!t) return null
          const [h, mi] = t.split(':')
          return `${month}-${String(day).padStart(2, '0')} ${h.padStart(2, '0')}:${mi}:00+09:00`
        }
        const rows = c.days.map(d => ({
          user_id: uid,
          date: `${month}-${String(d.day).padStart(2, '0')}`,
          am_clock_in: toTs(d.day, d.am_in),
          am_clock_out: toTs(d.day, d.am_out),
          pm_clock_in: toTs(d.day, d.pm_in),
          pm_clock_out: toTs(d.day, d.pm_out),
          status: d.status || 'present',
        }))
        const { error } = await supabase.from('attendance_records').insert(rows)
        if (error) throw error
        ok++
      } catch (e) {
        console.error(c.name, e)
        fail++
      }
    }
    setImporting(false)
    setImportResult(`✅ ${ok}名成功${fail > 0 ? ` / ❌ ${fail}名失敗（コンソール確認）` : ''}`)
  }

  if (loading || !profile) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-4xl animate-pulse">🏥</div>
    </div>
  )

  return (
    <Layout>
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-gray-900">📇 タイムカード取り込み</h1>

        {/* 設定 */}
        <div className="card space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <label className="label">対象年月</label>
              <input type="month" className="input" value={month} onChange={e => setMonth(e.target.value)} />
            </div>
            <div className="flex-1">
              <label className="label">タイムカードPDF（複数可）</label>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf"
                multiple
                disabled={processing}
                onChange={e => handleFile(e.target.files)}
                className="block w-full text-sm text-gray-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-clinic-600 file:text-white file:text-sm file:font-medium hover:file:bg-clinic-700"
              />
            </div>
          </div>
          <p className="text-xs text-gray-400">
            スキャンPDFをアップロードすると、AIが打刻を自動読み取りします。読み取り後にプレビューで修正できます。
          </p>
          {progress && (
            <div className="text-sm text-clinic-600 font-medium bg-clinic-50 rounded-lg px-3 py-2 animate-pulse">
              {progress}
            </div>
          )}
        </div>

        {/* プレビュー */}
        {cards.map((card, ci) => (
          <div key={card.key} className="card space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <span className="font-semibold text-gray-800">{card.name}</span>
                <span className="text-xs text-gray-400">{card.affiliation}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">紐付け:</span>
                <select
                  className="select text-sm py-1"
                  value={card.matchedProfile?.id ?? ''}
                  onChange={e => setCardProfile(ci, e.target.value)}
                >
                  <option value="">— 未選択 —</option>
                  {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {card.matchedProfile
                  ? <span className="text-xs text-emerald-600 font-medium">✓</span>
                  : <span className="text-xs text-red-500 font-medium">要選択</span>}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-2 py-1 text-left">日</th>
                    <th className="px-2 py-1">AM出</th>
                    <th className="px-2 py-1">AM退</th>
                    <th className="px-2 py-1">PM出</th>
                    <th className="px-2 py-1">PM退</th>
                    <th className="px-2 py-1">状態</th>
                    <th className="px-2 py-1">メモ</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {card.days.map((d, di) => (
                    <tr key={d.day} className={d.confidence === 'low' ? 'bg-amber-50' : ''}>
                      <td className="px-2 py-1 font-medium">{d.day}日</td>
                      {(['am_in', 'am_out', 'pm_in', 'pm_out'] as const).map(f => (
                        <td key={f} className="px-1 py-0.5">
                          <input
                            className="w-16 text-center border border-gray-200 rounded px-1 py-0.5 text-xs"
                            value={d[f] ?? ''}
                            onChange={e => updateDay(ci, di, f, e.target.value)}
                            placeholder="—"
                          />
                        </td>
                      ))}
                      <td className="px-1 py-0.5">
                        <select
                          className="text-xs border border-gray-200 rounded px-1 py-0.5"
                          value={d.status}
                          onChange={e => updateDay(ci, di, 'status', e.target.value)}
                        >
                          <option value="present">出勤</option>
                          <option value="paid_leave">有給</option>
                          <option value="absent">欠勤</option>
                          <option value="substitute_holiday">代休</option>
                        </select>
                      </td>
                      <td className="px-2 py-1 text-gray-400">
                        {d.confidence === 'low' && '⚠️ '}{d.note}
                      </td>
                      <td className="px-1">
                        <button onClick={() => removeDay(ci, di)} className="text-red-300 hover:text-red-500">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {/* インポートボタン */}
        {cards.length > 0 && (
          <div className="card flex items-center justify-between flex-wrap gap-3">
            <div className="text-sm text-gray-600">
              {cards.length}名読み取り / 紐付け済み {cards.filter(c => c.matchedProfile).length}名
              <span className="text-xs text-gray-400 ml-2">⚠️ = AI読み取り信頼度低（要確認）</span>
            </div>
            <button
              onClick={handleImport}
              disabled={importing || cards.filter(c => c.matchedProfile).length === 0}
              className="btn-primary"
            >
              {importing ? 'インポート中...' : `${cards.filter(c => c.matchedProfile).length}名分をインポート`}
            </button>
          </div>
        )}
        {importResult && (
          <div className="card text-sm font-medium text-gray-700">{importResult}</div>
        )}
      </div>
    </Layout>
  )
}
