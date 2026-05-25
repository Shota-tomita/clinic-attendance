import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

export default function LineWorksSettingsPage() {
  const { user, profile, loading, isAdmin } = useAuth()
  const router = useRouter()
  const [form, setForm] = useState({
    bot_id: '', channel_id: '', client_id: '',
    client_secret: '', service_account: '', private_key: '',
    is_enabled: false,
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [settingsId, setSettingsId] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState('')

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
      // handled above
      else if (!isAdmin) router.replace('/dashboard')
    }
  }, [user, loading, isAdmin])

  useEffect(() => { if (isAdmin) fetchSettings() }, [isAdmin])

  const fetchSettings = async () => {
    const { data } = await supabase.from('lineworks_settings').select('*').single()
    if (data) {
      setSettingsId(data.id)
      setForm({
        bot_id: data.bot_id ?? '',
        channel_id: data.channel_id ?? '',
        client_id: data.client_id ?? '',
        client_secret: data.client_secret ?? '',
        service_account: data.service_account ?? '',
        private_key: data.private_key ?? '',
        is_enabled: data.is_enabled ?? false,
      })
    }
  }

  const handleSave = async () => {
    setSaving(true)
    const payload = { ...form, updated_by: user?.id }
    if (settingsId) {
      await supabase.from('lineworks_settings').update(payload).eq('id', settingsId)
    } else {
      const { data } = await supabase.from('lineworks_settings').insert(payload).select().single()
      if (data) setSettingsId(data.id)
    }
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const f = (key: string, val: any) => setForm(prev => ({ ...prev, [key]: val }))

  if (loading || !profile) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-4xl animate-pulse">🏥</div>
    </div>
  )

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">💬 LINE WORKS 設定</h1>
          <p className="text-xs text-gray-400 mt-0.5">通知をLINE WORKSのBotで送信する設定です</p>
        </div>

        {/* 手順 */}
        <div className="card bg-green-50 border-green-100 space-y-2">
          <h2 className="text-sm font-semibold text-green-800">設定手順（フリープランでも可）</h2>
          <ol className="space-y-1.5 text-xs text-green-700">
            {[
              'LINE WORKS Developer Consoleにログイン（https://dev.worksmobile.com）',
              '「Bot」を作成 → Bot IDを取得',
              '「OAuth App」を作成 → Client ID・Client Secretを取得',
              'Service Accountを作成 → Private Keyを取得',
              '各スタッフのLINE WORKSユーザーIDを「スタッフ管理」で登録',
            ].map((s, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="w-4 h-4 rounded-full bg-green-200 text-green-700 text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  {i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
        </div>

        {/* 有効/無効 */}
        <div className="card flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-gray-700">LINE WORKS通知を有効にする</div>
            <div className="text-xs text-gray-400">無効の場合はメール通知にフォールバックします</div>
          </div>
          <button
            onClick={() => f('is_enabled', !form.is_enabled)}
            className={`relative w-12 h-6 rounded-full transition-colors
              ${form.is_enabled ? 'bg-clinic-500' : 'bg-gray-300'}`}
          >
            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform
              ${form.is_enabled ? 'translate-x-6' : 'translate-x-0.5'}`} />
          </button>
        </div>

        {/* 設定フォーム */}
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">API設定</h2>
          {[
            { key: 'bot_id', label: 'Bot ID' },
            { key: 'client_id', label: 'Client ID' },
            { key: 'client_secret', label: 'Client Secret', type: 'password' },
            { key: 'service_account', label: 'Service Account' },
          ].map(({ key, label, type }) => (
            <div key={key}>
              <label className="label">{label}</label>
              <input
                type={type ?? 'text'}
                className="input font-mono text-sm"
                value={(form as any)[key]}
                onChange={e => f(key, e.target.value)}
                placeholder={label}
              />
            </div>
          ))}
          <div>
            <label className="label">Private Key（RSA）</label>
            <textarea
              className="input font-mono text-xs resize-none"
              rows={4}
              value={form.private_key}
              onChange={e => f('private_key', e.target.value)}
              placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;...&#10;-----END RSA PRIVATE KEY-----"
            />
          </div>
        </div>

        {testResult && (
          <div className={`text-sm px-4 py-3 rounded-xl ${
            testResult.includes('✅') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
          }`}>
            {testResult}
          </div>
        )}

        {saved && (
          <div className="text-sm bg-emerald-50 text-emerald-700 px-4 py-2 rounded-xl">
            ✅ 設定を保存しました
          </div>
        )}

        <button onClick={handleSave} disabled={saving} className="btn-primary w-full">
          {saving ? '保存中...' : '設定を保存'}
        </button>
      </div>
    </Layout>
  )
}
