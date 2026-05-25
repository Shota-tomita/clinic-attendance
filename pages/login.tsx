import { useState } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '@/lib/auth'

export default function LoginPage() {
  const { signIn } = useAuth()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await signIn(email, password)
    setLoading(false)
    if (error) {
      setError('メールアドレスまたはパスワードが違います')
    } else {
      router.push('/dashboard')
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-clinic-50 to-emerald-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🏥</div>
          <h1 className="font-display text-2xl font-semibold text-clinic-800">クリニック勤怠管理</h1>
          <p className="text-sm text-gray-500 mt-1">スタッフポータル</p>
        </div>

        {/* Card */}
        <div className="card">
          <h2 className="text-base font-semibold text-gray-800 mb-5">ログイン</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">メールアドレス</label>
              <input
                type="email"
                className="input"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="example@clinic.jp"
                required
              />
            </div>
            <div>
              <label className="label">パスワード</label>
              <input
                type="password"
                className="input"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
            {error && (
              <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
            )}
            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? 'ログイン中...' : 'ログイン'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          アカウントは院長に発行を依頼してください
        </p>
      </div>
    </div>
  )
}
