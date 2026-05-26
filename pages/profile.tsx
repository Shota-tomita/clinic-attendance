import { useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

export default function ProfilePage() {
  const { user, profile, loading } = useAuth()
  const router = useRouter()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-4xl animate-pulse">🏥</div>
    </div>
  )

  if (!user) { router.replace('/login'); return null }

  const handleChangePassword = async () => {
    setError('')
    setMessage('')

    if (!newPassword) { setError('新しいパスワードを入力してください'); return }
    if (newPassword.length < 8) { setError('パスワードは8文字以上にしてください'); return }
    if (newPassword !== confirmPassword) { setError('新しいパスワードが一致しません'); return }

    setSaving(true)

    // まず現在のパスワードで再認証
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email!,
      password: currentPassword,
    })

    if (signInError) {
      setError('現在のパスワードが違います')
      setSaving(false)
      return
    }

    // パスワードを更新
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    })

    setSaving(false)

    if (updateError) {
      setError('パスワードの更新に失敗しました: ' + updateError.message)
    } else {
      setMessage('✅ パスワードを変更しました')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    }
  }

  return (
    <Layout>
      <div className="max-w-md mx-auto space-y-5">
        <h1 className="text-xl font-semibold text-gray-900">👤 マイプロフィール</h1>

        {/* 基本情報 */}
        <div className="card space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">基本情報</h2>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">氏名</span>
              <span className="text-sm font-medium text-gray-800">{profile?.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">メールアドレス</span>
              <span className="text-sm font-medium text-gray-800">{user.email}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">ロール</span>
              <span className="text-sm font-medium text-gray-800">
                {profile?.role === 'admin' ? '院長' : profile?.role === 'leader' ? 'リーダー' : 'スタッフ'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">有給残日数</span>
              <span className="text-sm font-medium text-clinic-600">
                {(profile?.annual_leave_days ?? 0) - (profile?.used_leave_days ?? 0)}日
              </span>
            </div>
          </div>
        </div>

        {/* パスワード変更 */}
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">🔐 パスワード変更</h2>

          <div>
            <label className="label">現在のパスワード</label>
            <input
              type="password"
              className="input"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <div>
            <label className="label">新しいパスワード（8文字以上）</label>
            <input
              type="password"
              className="input"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <div>
            <label className="label">新しいパスワード（確認）</label>
            <input
              type="password"
              className="input"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>
          )}
          {message && (
            <div className="text-sm text-emerald-600 bg-emerald-50 rounded-lg px-3 py-2">{message}</div>
          )}

          <button
            onClick={handleChangePassword}
            disabled={saving}
            className="btn-primary w-full"
          >
            {saving ? '変更中...' : 'パスワードを変更する'}
          </button>
        </div>
      </div>
    </Layout>
  )
}
