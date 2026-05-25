import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/lib/auth'
import { supabase, ShiftPattern, ShiftPatternBlock } from '@/lib/supabase'
import { calcScheduledMinutes, formatMinutes, blocksToTimeRange } from '@/lib/utils'

const PRESET_COLORS = [
  '#2f9162','#0ea5e9','#f59e0b','#ef4444',
  '#8b5cf6','#ec4899','#14b8a6','#f97316',
]

type BlockForm = {
  label: string
  start_time: string
  end_time: string
}

const emptyBlock = (): BlockForm => ({ label: '', start_time: '09:00', end_time: '18:00' })

const DEFAULT_BLOCKS: BlockForm[] = [
  { label: '午前', start_time: '08:30', end_time: '13:30' },
  { label: '午後', start_time: '15:00', end_time: '18:30' },
]

type PatternWithBlocks = ShiftPattern & { shift_pattern_blocks: ShiftPatternBlock[] }

export default function ShiftPatternsPage() {
  const { user, profile, loading, isAdmin } = useAuth()
  const router = useRouter()
  const [patterns, setPatterns] = useState<PatternWithBlocks[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<PatternWithBlocks | null>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState(PRESET_COLORS[0])
  const [blocks, setBlocks] = useState<BlockForm[]>(DEFAULT_BLOCKS)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [user, loading])

  useEffect(() => {
    if (!loading && profile && !isAdmin) router.replace('/dashboard')
  }, [loading, profile, isAdmin])

  useEffect(() => { fetchPatterns() }, [])

  const fetchPatterns = async () => {
    const { data } = await supabase
      .from('shift_patterns')
      .select('*, shift_pattern_blocks(*)')
      .order('name')
    if (data) {
      setPatterns(data.map(p => ({
        ...p,
        shift_pattern_blocks: (p.shift_pattern_blocks ?? []).sort(
          (a: ShiftPatternBlock, b: ShiftPatternBlock) => a.sort_order - b.sort_order
        )
      })))
    }
  }

  const openCreate = () => {
    setEditing(null)
    setName('')
    setColor(PRESET_COLORS[0])
    setBlocks(DEFAULT_BLOCKS)
    setError('')
    setShowForm(true)
  }

  const openEdit = (p: PatternWithBlocks) => {
    setEditing(p)
    setName(p.name)
    setColor(p.color)
    setBlocks(p.shift_pattern_blocks.map(b => ({
      label: b.label ?? '',
      start_time: b.start_time.slice(0, 5),
      end_time: b.end_time.slice(0, 5),
    })))
    setError('')
    setShowForm(true)
  }

  const addBlock = () => setBlocks(bs => [...bs, emptyBlock()])
  const removeBlock = (i: number) => setBlocks(bs => bs.filter((_, idx) => idx !== i))
  const updateBlock = (i: number, field: keyof BlockForm, val: string) =>
    setBlocks(bs => bs.map((b, idx) => idx === i ? { ...b, [field]: val } : b))

  const blockScheduledMinutes = (b: BlockForm) => {
    const [sh, sm] = b.start_time.split(':').map(Number)
    const [eh, em] = b.end_time.split(':').map(Number)
    return (eh * 60 + em) - (sh * 60 + sm)
  }

  const totalScheduled = blocks.reduce((s, b) => s + Math.max(blockScheduledMinutes(b), 0), 0)

  const validate = () => {
    if (!name.trim()) return 'パターン名を入力してください'
    if (blocks.length === 0) return 'ブロックを1つ以上追加してください'
    for (const b of blocks) {
      const mins = blockScheduledMinutes(b)
      if (mins <= 0) return '終了時刻は開始時刻より後に設定してください'
    }
    return null
  }

  const handleSave = async () => {
    const err = validate()
    if (err) { setError(err); return }
    setSaving(true)
    setError('')

    let patternId: string
    if (editing) {
      await supabase.from('shift_patterns').update({ name, color }).eq('id', editing.id)
      // ブロックを全削除して再挿入
      await supabase.from('shift_pattern_blocks').delete().eq('shift_pattern_id', editing.id)
      patternId = editing.id
    } else {
      const { data, error: e } = await supabase
        .from('shift_patterns')
        .insert({ name, color, created_by: user?.id })
        .select()
        .single()
      if (e || !data) { setError(e?.message ?? 'エラー'); setSaving(false); return }
      patternId = data.id
    }

    // ブロックを挿入
    const blockRows = blocks.map((b, i) => ({
      shift_pattern_id: patternId,
      sort_order: i,
      label: b.label || null,
      start_time: b.start_time,
      end_time: b.end_time,
    }))
    const { error: be } = await supabase.from('shift_pattern_blocks').insert(blockRows)
    if (be) { setError(be.message); setSaving(false); return }

    setSaving(false)
    setShowForm(false)
    fetchPatterns()
  }

  const toggleActive = async (p: PatternWithBlocks) => {
    await supabase.from('shift_patterns').update({ is_active: !p.is_active }).eq('id', p.id)
    fetchPatterns()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このシフトパターンを削除しますか？')) return
    await supabase.from('shift_patterns').delete().eq('id', id)
    fetchPatterns()
  }

  if (loading || !profile) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-4xl animate-pulse">🏥</div>
    </div>
  )

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">🗂️ シフトパターン管理</h1>
            <p className="text-xs text-gray-400 mt-0.5">院長のみ作成・編集できます</p>
          </div>
          <button onClick={openCreate} className="btn-primary text-sm">＋ 新規パターン</button>
        </div>

        <div className="space-y-3">
          {patterns.length === 0 && (
            <div className="card text-center py-12 text-gray-400 text-sm">
              シフトパターンがまだありません
            </div>
          )}
          {patterns.map(p => {
            const mins = calcScheduledMinutes(p.shift_pattern_blocks ?? [])
            return (
              <div key={p.id} className={`card ${!p.is_active ? 'opacity-50' : ''}`}>
                <div className="flex items-start gap-4">
                  {/* Color badge */}
                  <div
                    className="w-11 h-11 rounded-xl flex-shrink-0 flex items-center justify-center text-white font-bold shadow"
                    style={{ backgroundColor: p.color }}
                  >
                    {p.name[0]}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-800">{p.name}</span>
                      {!p.is_active && <span className="badge bg-gray-100 text-gray-500">無効</span>}
                      <span className="text-xs text-gray-400">
                        所定 <span className="text-clinic-600 font-medium">{formatMinutes(mins)}</span>
                      </span>
                    </div>

                    {/* Blocks */}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(p.shift_pattern_blocks ?? []).map((b, i) => (
                        <div key={b.id} className="flex items-center gap-1.5 bg-gray-50 rounded-lg px-2.5 py-1.5">
                          {b.label && (
                            <span
                              className="text-[10px] font-bold px-1.5 py-0.5 rounded text-white"
                              style={{ backgroundColor: p.color }}
                            >
                              {b.label}
                            </span>
                          )}
                          <span className="text-xs font-medium text-gray-700">
                            {b.start_time.slice(0, 5)} 〜 {b.end_time.slice(0, 5)}
                          </span>
                          <span className="text-[10px] text-gray-400">
                            ({formatMinutes(
                              (Number(b.end_time.split(':')[0]) * 60 + Number(b.end_time.split(':')[1])) -
                              (Number(b.start_time.split(':')[0]) * 60 + Number(b.start_time.split(':')[1]))
                            )})
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button onClick={() => toggleActive(p)} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded hover:bg-gray-100">
                      {p.is_active ? '無効化' : '有効化'}
                    </button>
                    <button onClick={() => openEdit(p)} className="btn-secondary text-xs px-3 py-1.5">編集</button>
                    <button onClick={() => handleDelete(p.id)} className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50">削除</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Create / Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/40 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-5 my-8">
            <h2 className="font-semibold text-gray-800 text-base">
              {editing ? 'シフトパターン編集' : '新規シフトパターン'}
            </h2>

            {/* Pattern name */}
            <div>
              <label className="label">パターン名 <span className="text-red-400">*</span></label>
              <input
                className="input"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="例: 日勤A、早番、遅番..."
              />
            </div>

            {/* Color */}
            <div>
              <label className="label">表示色</label>
              <div className="flex gap-2 flex-wrap">
                {PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={`w-8 h-8 rounded-full transition-transform
                      ${color === c ? 'scale-125 ring-2 ring-offset-2 ring-gray-400' : 'hover:scale-110'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>

            {/* Time blocks */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="label mb-0">勤務時間帯 <span className="text-red-400">*</span></label>
                <button onClick={addBlock} className="text-xs text-clinic-600 hover:text-clinic-800 font-medium">
                  ＋ 時間帯を追加
                </button>
              </div>

              <div className="space-y-3">
                {blocks.map((b, i) => (
                  <div key={i} className="bg-gray-50 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-5 h-5 rounded-full text-[10px] text-white font-bold flex items-center justify-center"
                          style={{ backgroundColor: color }}
                        >
                          {i + 1}
                        </div>
                        <span className="text-xs font-medium text-gray-600">ブロック {i + 1}</span>
                      </div>
                      {blocks.length > 1 && (
                        <button onClick={() => removeBlock(i)} className="text-xs text-red-400 hover:text-red-600">
                          削除
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="label">ラベル（任意）</label>
                        <input
                          className="input"
                          value={b.label}
                          onChange={e => updateBlock(i, 'label', e.target.value)}
                          placeholder="午前"
                        />
                      </div>
                      <div>
                        <label className="label">開始</label>
                        <input
                          type="time"
                          className="input"
                          value={b.start_time}
                          onChange={e => updateBlock(i, 'start_time', e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="label">終了</label>
                        <input
                          type="time"
                          className="input"
                          value={b.end_time}
                          onChange={e => updateBlock(i, 'end_time', e.target.value)}
                        />
                      </div>
                    </div>

                    {blockScheduledMinutes(b) > 0 && (
                      <div className="text-xs text-gray-400">
                        → {formatMinutes(blockScheduledMinutes(b))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Total preview */}
            <div className="bg-clinic-50 rounded-xl p-3 flex items-center gap-3">
              <div
                className="text-sm font-bold text-white px-3 py-1.5 rounded-lg"
                style={{ backgroundColor: color }}
              >
                {name || 'プレビュー'}
              </div>
              <div className="text-sm text-gray-600">
                所定合計: <span className="font-semibold text-clinic-700">{formatMinutes(totalScheduled)}</span>
              </div>
              {blocks.length > 1 && (
                <div className="text-xs text-gray-400">
                  ({blocks.map((b, i) => `${b.label || `B${i+1}`} ${b.start_time.slice(0,5)}〜${b.end_time.slice(0,5)}`).join(' / ')})
                </div>
              )}
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex gap-3 pt-1">
              <button onClick={() => setShowForm(false)} className="btn-secondary flex-1">キャンセル</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
