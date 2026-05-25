import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/lib/auth'
import { supabase, Profile } from '@/lib/supabase'

type PriorityEntry = {
  id: string
  user_id: string
  priority_order: number
  last_special_leave_used: string | null
  profiles: Profile
}

type DeptGroup = {
  id: string
  name: string
  max_simultaneous_leave: number
}

export default function LeavePriorityPage() {
  const { user, profile, loading, isAdmin } = useAuth()
  const router = useRouter()
  const [groups, setGroups] = useState<DeptGroup[]>([])
  const [selectedGroup, setSelectedGroup] = useState<string>('')
  const [priorities, setPriorities] = useState<PriorityEntry[]>([])
  const [saving, setSaving] = useState(false)
  const [dragging, setDragging] = useState<number | null>(null)

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
      // handled above
      else if (!isAdmin) router.replace('/dashboard')
    }
  }, [user, loading, isAdmin])

  useEffect(() => {
    if (isAdmin) fetchGroups()
  }, [isAdmin])

  useEffect(() => {
    if (selectedGroup) fetchPriorities()
  }, [selectedGroup])

  const fetchGroups = async () => {
    const { data } = await supabase.from('department_groups').select('*').order('name')
    setGroups(data ?? [])
    if (data && data.length > 0) setSelectedGroup(data[0].id)
  }

  const fetchPriorities = async () => {
    const { data } = await supabase
      .from('leave_priority')
      .select('*, profiles(*, departments(*))')
      .eq('department_group_id', selectedGroup)
      .order('priority_order')
    setPriorities(data ?? [])
  }

  const initPriorities = async () => {
    await supabase.rpc('init_leave_priority', { p_group_id: selectedGroup })
    fetchPriorities()
  }

  const moveUp = (index: number) => {
    if (index === 0) return
    const newList = [...priorities]
    ;[newList[index - 1], newList[index]] = [newList[index], newList[index - 1]]
    setPriorities(newList.map((p, i) => ({ ...p, priority_order: i + 1 })))
  }

  const moveDown = (index: number) => {
    if (index === priorities.length - 1) return
    const newList = [...priorities]
    ;[newList[index], newList[index + 1]] = [newList[index + 1], newList[index]]
    setPriorities(newList.map((p, i) => ({ ...p, priority_order: i + 1 })))
  }

  const savePriorities = async () => {
    setSaving(true)
    for (const p of priorities) {
      await supabase.from('leave_priority')
        .update({ priority_order: p.priority_order })
        .eq('id', p.id)
    }
    setSaving(false)
    fetchPriorities()
  }

  const updateMaxLeave = async (groupId: string, val: number) => {
    await supabase.from('department_groups').update({ max_simultaneous_leave: val }).eq('id', groupId)
    fetchGroups()
  }

  if (loading || !profile) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-4xl animate-pulse">🏥</div>
    </div>
  )

  const currentGroup = groups.find(g => g.id === selectedGroup)

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">📊 有給優先順位管理</h1>
          <p className="text-xs text-gray-400 mt-0.5">連休前後の特別有給フローの優先順位を設定します</p>
        </div>

        {/* Group selector */}
        <div className="card space-y-4">
          <div className="flex gap-2">
            {groups.map(g => (
              <button
                key={g.id}
                onClick={() => setSelectedGroup(g.id)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all
                  ${selectedGroup === g.id
                    ? 'bg-clinic-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                {g.name}
              </button>
            ))}
          </div>

          {currentGroup && (
            <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
              <div>
                <div className="text-sm font-medium text-gray-700">同時有給取得OK人数</div>
                <div className="text-xs text-gray-400">これを超えた場合にリーダー判断</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => updateMaxLeave(currentGroup.id, Math.max(1, currentGroup.max_simultaneous_leave - 1))}
                  className="w-8 h-8 rounded-lg bg-gray-200 text-gray-600 font-bold hover:bg-gray-300"
                >−</button>
                <span className="text-lg font-bold text-clinic-700 w-6 text-center">
                  {currentGroup.max_simultaneous_leave}
                </span>
                <button
                  onClick={() => updateMaxLeave(currentGroup.id, currentGroup.max_simultaneous_leave + 1)}
                  className="w-8 h-8 rounded-lg bg-gray-200 text-gray-600 font-bold hover:bg-gray-300"
                >＋</button>
                <span className="text-sm text-gray-500">人</span>
              </div>
            </div>
          )}
        </div>

        {/* Priority list */}
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">優先順位（上が高い）</h2>
            <div className="flex gap-2">
              <button onClick={initPriorities} className="btn-secondary text-xs px-3 py-1.5">
                入社順にリセット
              </button>
              <button onClick={savePriorities} disabled={saving} className="btn-primary text-xs px-3 py-1.5">
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>

          {priorities.length === 0 ? (
            <div className="text-center py-8 space-y-3">
              <p className="text-sm text-gray-400">優先順位が設定されていません</p>
              <button onClick={initPriorities} className="btn-primary text-sm">
                入社順で初期化する
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {priorities.map((p, i) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3"
                >
                  {/* Rank */}
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0
                    ${i === 0 ? 'bg-amber-100 text-amber-700'
                      : i === 1 ? 'bg-gray-200 text-gray-600'
                      : i === 2 ? 'bg-orange-100 text-orange-600'
                      : 'bg-gray-100 text-gray-500'}`}
                  >
                    {i + 1}
                  </div>

                  {/* Avatar */}
                  <div className="w-8 h-8 rounded-full bg-clinic-100 text-clinic-700 font-bold text-sm flex items-center justify-center flex-shrink-0">
                    {p.profiles.name[0]}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-800">{p.profiles.name}</div>
                    <div className="text-xs text-gray-400">
                      {(p.profiles as any).departments?.name ?? '部署未設定'}
                      {p.last_special_leave_used && (
                        <span className="ml-2 text-amber-500">
                          最終使用: {p.last_special_leave_used}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Move buttons */}
                  <div className="flex flex-col gap-0.5">
                    <button
                      onClick={() => moveUp(i)}
                      disabled={i === 0}
                      className="w-7 h-6 rounded text-gray-400 hover:bg-gray-200 disabled:opacity-20 text-xs"
                    >▲</button>
                    <button
                      onClick={() => moveDown(i)}
                      disabled={i === priorities.length - 1}
                      className="w-7 h-6 rounded text-gray-400 hover:bg-gray-200 disabled:opacity-20 text-xs"
                    >▼</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="text-xs text-gray-400 bg-blue-50 rounded-lg px-3 py-2">
            💡 連休前後に有給を使用したスタッフは自動的に最下位に移動します
          </div>
        </div>
      </div>
    </Layout>
  )
}
