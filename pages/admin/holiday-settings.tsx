import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { detectConsecutiveHolidays, HolidaySettings } from '@/lib/holidays'
import { format } from 'date-fns'

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

export default function HolidaySettingsPage() {
  const { user, profile, loading, isAdmin } = useAuth()
  const router = useRouter()
  const [settings, setSettings] = useState<HolidaySettings>({
    min_consecutive_days: 3,
    buffer_days: 2,
    closed_weekdays: [0, 4],
    include_holidays: true,
  })
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<Array<{ start: string; end: string; days: number; label: string }>>([])
  const [loadingPreview, setLoadingPreview] = useState(false)

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
      // handled above
      else if (!isAdmin) router.replace('/dashboard')
    }
  }, [user, loading, isAdmin])

  useEffect(() => {
    if (isAdmin) fetchSettings()
  }, [isAdmin])

  const fetchSettings = async () => {
    const { data } = await supabase
      .from('holiday_settings')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)
      .single()
    if (data) {
      setSettings({
        min_consecutive_days: data.min_consecutive_days,
        buffer_days: data.buffer_days,
        closed_weekdays: data.closed_weekdays,
        include_holidays: data.include_holidays,
      })
    }
    loadPreview(data ?? settings)
  }

  const loadPreview = async (s: HolidaySettings) => {
    setLoadingPreview(true)
    const year = new Date().getFullYear()
    const blocks = await detectConsecutiveHolidays(year, s)
    setPreview(blocks)
    setLoadingPreview(false)
  }

  const toggleWeekday = (dow: number) => {
    setSettings(s => ({
      ...s,
      closed_weekdays: s.closed_weekdays.includes(dow)
        ? s.closed_weekdays.filter(d => d !== dow)
        : [...s.closed_weekdays, dow].sort(),
    }))
  }

  const handleSave = async () => {
    setSaving(true)
    await supabase.from('holiday_settings').update({
      min_consecutive_days: settings.min_consecutive_days,
      buffer_days: settings.buffer_days,
      closed_weekdays: settings.closed_weekdays,
      include_holidays: settings.include_holidays,
      updated_by: user?.id,
    }).eq('id', (await supabase.from('holiday_settings').select('id').single()).data?.id)
    setSaving(false)
    loadPreview(settings)
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
          <h1 className="text-xl font-semibold text-gray-900">🗓️ 連休・有給特別期間 設定</h1>
          <p className="text-xs text-gray-400 mt-0.5">連休の定義と特別有給フローの発動条件を設定します</p>
        </div>

        <div className="card space-y-5">
          {/* 定休日 */}
          <div>
            <label className="label text-sm mb-2">定休日（曜日）</label>
            <div className="flex gap-2">
              {WEEKDAY_LABELS.map((label, dow) => (
                <button
                  key={dow}
                  onClick={() => toggleWeekday(dow)}
                  className={`w-9 h-9 rounded-lg text-sm font-medium transition-all
                    ${settings.closed_weekdays.includes(dow)
                      ? 'bg-clinic-600 text-white'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* 祝日を含める */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-gray-700">祝日を定休日に含める</div>
              <div className="text-xs text-gray-400">日本の祝日APIから自動取得</div>
            </div>
            <button
              onClick={() => setSettings(s => ({ ...s, include_holidays: !s.include_holidays }))}
              className={`relative w-11 h-6 rounded-full transition-colors
                ${settings.include_holidays ? 'bg-clinic-500' : 'bg-gray-300'}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform
                ${settings.include_holidays ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>

          {/* 連休最小日数 */}
          <div>
            <label className="label">連休と見なす最小日数</label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={2} max={7}
                value={settings.min_consecutive_days}
                onChange={e => setSettings(s => ({ ...s, min_consecutive_days: Number(e.target.value) }))}
                className="flex-1 accent-clinic-600"
              />
              <span className="text-sm font-semibold text-clinic-700 w-8 text-center">
                {settings.min_consecutive_days}日
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              定休日が{settings.min_consecutive_days}日以上連続した場合、連休と判定します
            </p>
          </div>

          {/* 前後バッファ */}
          <div>
            <label className="label">連休前後の特別申請期間</label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={1} max={5}
                value={settings.buffer_days}
                onChange={e => setSettings(s => ({ ...s, buffer_days: Number(e.target.value) }))}
                className="flex-1 accent-clinic-600"
              />
              <span className="text-sm font-semibold text-clinic-700 w-8 text-center">
                ±{settings.buffer_days}日
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              連休の前後{settings.buffer_days}日間が優先順位フローの対象になります
            </p>
          </div>

          <button onClick={handleSave} disabled={saving} className="btn-primary w-full">
            {saving ? '保存中...' : '設定を保存'}
          </button>
        </div>

        {/* Preview */}
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">
              今年の連休プレビュー（{new Date().getFullYear()}年）
            </h2>
            <button onClick={() => loadPreview(settings)} className="text-xs text-clinic-600 hover:text-clinic-800">
              更新
            </button>
          </div>

          {loadingPreview ? (
            <p className="text-sm text-gray-400 text-center py-4">読込中...</p>
          ) : preview.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">該当する連休はありません</p>
          ) : (
            <div className="space-y-2">
              {preview.map((block, i) => (
                <div key={i} className="bg-gray-50 rounded-xl p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="badge bg-clinic-100 text-clinic-700 font-medium">{block.label}</span>
                      <span className="text-sm text-gray-700">{block.start} 〜 {block.end}</span>
                      <span className="text-xs text-gray-400">{block.days}日間</span>
                    </div>
                  </div>
                  <div className="text-xs text-amber-600 mt-1">
                    ⭐ 特別申請期間: 前後±{settings.buffer_days}日
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
