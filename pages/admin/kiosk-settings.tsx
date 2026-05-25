import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

export default function KioskSettingsPage() {
  const { user, profile, loading, isAdmin } = useAuth()
  const router = useRouter()
  const [allowedIps, setAllowedIps] = useState<string[]>([])
  const [newIp, setNewIp] = useState('')
  const [saving, setSaving] = useState(false)
  const [settingsId, setSettingsId] = useState<string | null>(null)
  const [currentIp, setCurrentIp] = useState<string>('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!loading) {
      if (!user) router.replace('/login')
      else if (!isAdmin) router.replace('/dashboard')
    }
  }, [user, loading, isAdmin])

  useEffect(() => {
    if (isAdmin) {
      fetchSettings()
      fetchCurrentIp()
    }
  }, [isAdmin])

  const fetchCurrentIp = async () => {
    try {
      const res = await fetch('https://api.ipify.org?format=json')
      const { ip } = await res.json()
      setCurrentIp(ip)
    } catch {}
  }

  const fetchSettings = async () => {
    const { data } = await supabase
      .from('kiosk_settings')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (data) {
      setSettingsId(data.id)
      setAllowedIps(data.allowed_ips ?? [])
    } else {
      // レコードがなければ作成
      const { data: created } = await supabase
        .from('kiosk_settings')
        .insert({ pin_code: '000000', allowed_ips: [] })
        .select()
        .single()
      if (created) {
        setSettingsId(created.id)
        setAllowedIps([])
      }
    }
  }

  const saveIps = async (ips: string[]) => {
    if (!settingsId) return
    setSaving(true)
    await supabase.from('kiosk_settings')
      .update({ allowed_ips: ips })
      .eq('id', settingsId)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const addIp = async () => {
    const ip = newIp.trim()
    if (!ip || allowedIps.includes(ip)) return
    const updated = [...allowedIps, ip]
    setAllowedIps(updated)
    setNewIp('')
    await saveIps(updated)
  }

  const addCurrentIp = async () => {
    if (!currentIp || allowedIps.includes(currentIp)) return
    const updated = [...allowedIps, currentIp]
    setAllowedIps(updated)
    await saveIps(updated)
  }

  const removeIp = async (ip: string) => {
    if (!confirm(`${ip} を削除しますか？`)) return
    const updated = allowedIps.filter(i => i !== ip)
    setAllowedIps(updated)
    await saveIps(updated)
  }

  const copyKioskUrl = () => {
    const url = `${window.location.origin}/kiosk`
    navigator.clipboard.writeText(url)
  }

  if (loading || !profile) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-4xl animate-pulse">🏥</div>
    </div>
  )

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">🖥️ キオスク打刻設定</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            院内WiFiの固定IPを登録するだけで設定完了です
          </p>
        </div>

        {/* 仕組みの説明 */}
        <div className="card bg-clinic-50 border-clinic-100 space-y-2">
          <h2 className="text-sm font-semibold text-clinic-800">仕組み</h2>
          <div className="space-y-1.5 text-xs text-clinic-700">
            <div className="flex items-start gap-2">
              <span className="text-clinic-500 mt-0.5">①</span>
              <span>院内WiFiの固定IPをこのページで登録する（初回1回のみ）</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-clinic-500 mt-0.5">②</span>
              <span>院内PCのブラウザで <code className="bg-white px-1 rounded">/kiosk</code> を開いてブックマーク登録</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-clinic-500 mt-0.5">③</span>
              <span>以降は何もしなくていい。スタッフが自分のID・パスワードで打刻するだけ</span>
            </div>
          </div>
        </div>

        {/* IP管理 */}
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">許可IPアドレス（院内WiFi）</h2>
            {saved && <span className="text-xs text-emerald-600">✅ 保存しました</span>}
          </div>

          {/* 現在のIP */}
          {currentIp && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-blue-500 font-medium mb-0.5">この端末のIPアドレス</div>
                  <div className="font-mono text-sm font-semibold text-blue-800">{currentIp}</div>
                  {allowedIps.includes(currentIp) ? (
                    <div className="text-xs text-emerald-600 mt-0.5">✅ 登録済み</div>
                  ) : (
                    <div className="text-xs text-gray-500 mt-0.5">未登録</div>
                  )}
                </div>
                {!allowedIps.includes(currentIp) && (
                  <button
                    onClick={addCurrentIp}
                    disabled={saving}
                    className="btn-primary text-sm px-4"
                  >
                    このIPを登録
                  </button>
                )}
              </div>
              <p className="text-xs text-blue-400 mt-2">
                💡 院内PCでこのページを開いて「このIPを登録」を押すのが一番簡単です
              </p>
            </div>
          )}

          {/* 登録済みIP一覧 */}
          {allowedIps.length === 0 ? (
            <div className="text-center py-6 text-gray-400 text-sm bg-gray-50 rounded-xl">
              <div className="text-2xl mb-2">⚠️</div>
              IPが未登録のため、どこからでも打刻できる状態です<br/>
              <span className="text-xs">院内PCからこのページを開いてIPを登録してください</span>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-xs text-gray-500 font-medium">登録済み ({allowedIps.length}件)</div>
              {allowedIps.map(ip => (
                <div key={ip} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-500 text-sm">✅</span>
                    <span className="font-mono text-sm text-gray-700">{ip}</span>
                    {ip === currentIp && (
                      <span className="badge bg-blue-100 text-blue-600 text-[10px]">この端末</span>
                    )}
                  </div>
                  <button
                    onClick={() => removeIp(ip)}
                    className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50"
                  >
                    削除
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 手動追加 */}
          <div>
            <div className="text-xs text-gray-500 mb-1.5">IPアドレスを手動で追加</div>
            <div className="flex gap-2">
              <input
                className="input flex-1 font-mono text-sm"
                value={newIp}
                onChange={e => setNewIp(e.target.value)}
                placeholder="例: 203.0.113.10"
                onKeyDown={e => e.key === 'Enter' && addIp()}
              />
              <button onClick={addIp} disabled={saving || !newIp.trim()} className="btn-secondary text-sm px-4">
                追加
              </button>
            </div>
          </div>
        </div>

        {/* キオスクURL */}
        <div className="card space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">院内PCへの設定手順</h2>
          <ol className="space-y-2 text-sm text-gray-600">
            {[
              '院内PCのブラウザで下記URLを開く',
              'ブックマークに登録（またはホームページに設定）',
              '完了。以降スタッフが自分のIDとパスワードで打刻できます',
            ].map((s, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-clinic-100 text-clinic-700 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  {i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
          <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-4 py-3">
            <code className="text-sm text-gray-700 flex-1 truncate">
              {typeof window !== 'undefined' ? `${window.location.origin}/kiosk` : '/kiosk'}
            </code>
            <button onClick={copyKioskUrl} className="btn-secondary text-xs px-3 py-1.5 flex-shrink-0">
              コピー
            </button>
          </div>
        </div>
      </div>
    </Layout>
  )
}
