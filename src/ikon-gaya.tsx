// Ikon menu per gaya. Neo (komik) memakai glyph yang lebih tebal dan ramah, jadi BENTUKNYA berbeda dari Formal dan Cyber yang memakai glyph garis asli.
// Formal (Linear) tetap glyph garis asli dengan goresan hairline (diatur di CSS). Ikon yang tidak ada di daftar dipakai apa adanya.
import {
  Activity, AlarmClockCheck, Archive, BadgeCheck, BatteryCharging, Bike, Building2, CalendarCheck, CalendarDays, CalendarHeart, CalendarRange, CircleCheckBig,
  ClipboardCheck, ClipboardList, CloudUpload, FileUp, History, KeyRound, LayoutDashboard, LayoutGrid, ListChecks, MessageCircleMore, Receipt, ScrollText,
  Send, ShoppingBag, Sparkles, Store, TrendingUp, UserCheck, UserCog, UserPlus, Users, UsersRound, type LucideIcon,
} from 'lucide-react'
import { useGayaAktif } from './lib'

const NEO = new Map<LucideIcon, LucideIcon>([
  [LayoutDashboard, LayoutGrid],
  [Users, UsersRound],
  [CalendarDays, CalendarRange],
  [CalendarCheck, CalendarHeart],
  [ListChecks, Archive],
  [ClipboardCheck, CircleCheckBig],
  [ClipboardList, BadgeCheck],
  [Receipt, ShoppingBag],
  [UserCheck, AlarmClockCheck],
  [Send, MessageCircleMore],
  [Building2, Store],
  [Bike, BatteryCharging],
  [UserPlus, Sparkles],
  [FileUp, CloudUpload],
  [UserCog, KeyRound],
  [History, ScrollText],
  [TrendingUp, Activity],
])

export function IkonMenu({ Icon, size = 18, className }: { Icon: LucideIcon; size?: number; className?: string }) {
  const gaya = useGayaAktif()
  const Pakai = gaya === 'neo' ? (NEO.get(Icon) ?? Icon) : Icon
  return <Pakai size={size} className={className} />
}
