import { ReactNode, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useAuth } from '@/lib/auth'

type NavItem = {
  href: string
  label: string
  icon: string
  roles: ('admin' | 'leader' | 'staff')[]
  section?: string
}

const navItems: NavItem[] = [
  // 全員
  { href: '/dashboard',          label: 'ダッシュボード',       icon: '🏠', roles: ['admin','leader','staff'] },
  { href: '/attendance',         label: '出退勤打刻',           icon: '⏱️', roles: ['admin','leader','staff'] },
  { href: '/attendance/history', label: '勤怠履歴',             icon: '📋', roles: ['admin','leader','staff'] },
  { href: '/shift',              label: 'シフト管理',           icon: '📅', roles: ['admin','leader','staff'] },
  { href: '/leave',              label: '休暇申請',             icon: '🌿', roles: ['admin','leader','staff'] },
  { href: '/announcements',      label: 'お知らせ',             icon: '📣', roles: ['admin','leader','staff'] },
  // 院長のみ
  { href: '/shift/patterns',     label: 'シフトパターン',       icon: '🗂️', roles: ['admin'], section: '管理' },
  { href: '/staff',              label: 'スタッフ管理',         icon: '👥', roles: ['admin'] },
  { href: '/departments',        label: '部署管理',             icon: '🏢', roles: ['admin'] },
  { href: '/admin/leave-accrual',   label: '有給付与管理',      icon: '📈', roles: ['admin'] },
  { href: '/admin/bonus',           label: 'ボーナス試算',      icon: '💰', roles: ['admin'] },
  { href: '/admin/export',          label: '月次CSV出力',       icon: '📥', roles: ['admin'] },
  { href: '/admin/kiosk-settings',  label: 'キオスク設定',      icon: '🖥️', roles: ['admin'] },
  { href: '/admin/holiday-settings',label: '連休・特別期間設定', icon: '🗓️', roles: ['admin'] },
  { href: '/admin/leave-priority',  label: '有給優先順位',      icon: '📊', roles: ['admin'] },
  { href: '/admin/lineworks-settings', label: 'LINE WORKS設定', icon: '💬', roles: ['admin'] },
]

export default function Layout({ children }: { children: ReactNode }) {
  const { profile, signOut, isAdmin, isLeader } = useAuth()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)

  const userRole = profile?.role ?? 'staff'
  const filteredNav = navItems.filter(item => item.roles.includes(userRole as any))

  const roleLabel = { admin: '院長', leader: 'リーダー', staff: 'スタッフ' }[userRole]
  const roleBadgeColor = {
    admin: 'bg-amber-100 text-amber-700',
    leader: 'bg-blue-100 text-blue-700',
    staff: 'bg-emerald-100 text-emerald-700',
  }[userRole]

  const handleSignOut = async () => {
    await signOut()
    router.push('/login')
  }

  // セクション区切りを挿入しながらレンダリング
  const renderNav = (onClose: () => void) => {
    let lastSection = ''
    return filteredNav.map(item => {
      const isActive = router.pathname === item.href
      const showSection = item.section && item.section !== lastSection
      if (item.section) lastSection = item.section
      return (
        <div key={item.href}>
          {showSection && (
            <div className="px-4 pt-3 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
              {item.section}
            </div>
          )}
          <Link
            href={item.href}
            onClick={onClose}
            className={`sidebar-link ${isActive ? 'active' : ''}`}
          >
            <span className="text-base w-5 text-center">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        </div>
      )
    })
  }

  const SidebarContent = ({ onClose }: { onClose: () => void }) => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🏥</span>
          <div>
            <div className="font-display font-semibold text-clinic-800 text-sm leading-tight">クリニック</div>
            <div className="font-display font-semibold text-clinic-800 text-sm leading-tight">勤怠管理</div>
          </div>
        </div>
      </div>

      {/* User info */}
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-clinic-200 flex items-center justify-center text-clinic-700 font-medium text-sm">
            {profile?.name?.[0] ?? '?'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-gray-800 truncate">{profile?.name}</div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className={`badge ${roleBadgeColor} text-[10px]`}>{roleLabel}</span>
              {profile?.departments && (
                <span className="text-[10px] text-gray-400 truncate">{(profile as any).departments?.name}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
        {renderNav(onClose)}
      </nav>

      {/* Kiosk link */}
      {isAdmin && (
        <div className="px-3 py-2 border-t border-gray-100">
          <Link
            href="/kiosk"
            target="_blank"
            className="sidebar-link text-clinic-600 hover:bg-clinic-50"
          >
            <span className="text-base">🖥️</span>
            <span>打刻端末を開く</span>
            <span className="text-xs text-gray-400 ml-auto">↗</span>
          </Link>
        </div>
      )}

      {/* Sign out */}
      <div className="px-3 py-3 border-t border-gray-100">
        <button
          onClick={handleSignOut}
          className="sidebar-link w-full text-left text-red-500 hover:bg-red-50 hover:text-red-600"
        >
          <span className="text-base">🚪</span>
          <span>ログアウト</span>
        </button>
      </div>
    </div>
  )

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-56 flex-shrink-0 bg-white border-r border-gray-100 flex-col">
        <SidebarContent onClose={() => {}} />
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div className="fixed inset-0 bg-black/30" onClick={() => setMobileOpen(false)} />
          <aside className="relative z-50 w-56 bg-white flex flex-col shadow-xl">
            <SidebarContent onClose={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile top bar */}
        <div className="md:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100">
          <button onClick={() => setMobileOpen(true)} className="text-gray-600 text-xl">☰</button>
          <span className="font-display font-semibold text-clinic-800 text-sm">🏥 クリニック勤怠管理</span>
          <div className="w-8 h-8 rounded-full bg-clinic-200 flex items-center justify-center text-clinic-700 font-medium text-sm">
            {profile?.name?.[0] ?? '?'}
          </div>
        </div>

        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
