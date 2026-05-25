import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type Role = 'admin' | 'leader' | 'staff'

export type Department = {
  id: string
  name: string
  description: string | null
  created_at: string
}

export type Profile = {
  id: string
  email: string
  name: string
  role: Role
  department_id: string | null
  employment_type: 'full_time' | 'part_time'
  annual_leave_days: number
  used_leave_days: number
  created_at: string
  updated_at: string
  departments?: Department
}

// シフトパターン（ブロック複数持ち）
export type ShiftPatternBlock = {
  id: string
  shift_pattern_id: string
  sort_order: number
  label: string | null   // '午前', '午後' など
  start_time: string     // 'HH:MM'
  end_time: string       // 'HH:MM'
  created_at: string
}

export type ShiftPattern = {
  id: string
  name: string
  color: string
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
  shift_pattern_blocks?: ShiftPatternBlock[]
}

export type ShiftAssignment = {
  id: string
  user_id: string
  shift_pattern_id: string | null
  date: string
  custom_start_time: string | null
  custom_end_time: string | null
  note: string | null
  assigned_by: string | null
  created_at: string
  updated_at: string
  profiles?: Profile
  shift_patterns?: ShiftPattern & { shift_pattern_blocks?: ShiftPatternBlock[] }
}

export type ClockOutReason = 'normal' | 'early_finish' | 'early_leave'
export type EarlyFinishStatus = 'not_required' | 'pending' | 'approved' | 'rejected'

export type AttendanceRecord = {
  id: string
  user_id: string
  date: string
  clock_in: string | null
  clock_out: string | null
  break_minutes: number
  status: 'present' | 'absent' | 'late' | 'early_leave' | 'holiday' | 'paid_leave' | 'sick_leave'
  note: string | null
  // 変形労働時間制
  clock_out_reason: ClockOutReason
  early_finish_status: EarlyFinishStatus
  early_finish_reviewed_by: string | null
  early_finish_reviewed_at: string | null
  scheduled_minutes: number
  actual_minutes: number
  overtime_minutes: number
  deduction_minutes: number
  late_minutes: number
  early_leave_minutes: number
  created_at: string
  updated_at: string
  profiles?: Profile
}

export type LeaveRequest = {
  id: string
  user_id: string
  leave_type: 'paid_leave' | 'sick_leave' | 'special_leave'
  start_date: string
  end_date: string
  days_count: number
  reason: string | null
  status: 'pending' | 'approved' | 'rejected'
  admin_note: string | null
  reviewed_by: string | null
  created_at: string
  updated_at: string
  profiles?: Profile
}

export type Announcement = {
  id: string
  title: string
  content: string
  is_pinned: boolean
  created_by: string | null
  created_at: string
}

export type MonthlySummary = {
  id: string
  user_id: string
  year_month: string
  scheduled_days: number
  actual_days: number
  absent_days: number
  late_count: number
  late_total_minutes: number
  early_leave_count: number
  early_leave_total_minutes: number
  overtime_total_minutes: number
  deduction_total_minutes: number
  paid_leave_days: number
  created_at: string
  updated_at: string
  profiles?: Profile
}
