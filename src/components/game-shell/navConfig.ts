import { Activity, Award, Bell, CalendarRange, Home, Package, Puzzle, ScrollText, Settings, ShoppingBag, Swords, Ticket, Trophy, User, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const PRIMARY_NAV: NavItem[] = [
  { href: "/hub", label: "Player Hub", icon: Home },
  { href: "/puzzles", label: "My CircZles", icon: Puzzle },
  { href: "/submissions", label: "Submissions", icon: ScrollText },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { href: "/missions", label: "Missions", icon: Swords },
  { href: "/rewards", label: "Rewards", icon: ShoppingBag },
  { href: "/inventory", label: "Inventory", icon: Package },
  { href: "/coupons", label: "Coupons", icon: Ticket },
  { href: "/seasons", label: "Seasons", icon: CalendarRange },
  { href: "/achievements", label: "Achievements", icon: Award },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/friends", label: "Friends", icon: Users },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/profile", label: "Profile", icon: User },
];

export const SETTINGS_ITEM: NavItem = { href: "/settings", label: "Settings", icon: Settings };

/** Mobile bottom bar: 5 primary destinations + a "More" trigger. */
export const MOBILE_PRIMARY: NavItem[] = [
  PRIMARY_NAV[0], // Hub
  PRIMARY_NAV[1], // Puzzles
  PRIMARY_NAV[3], // Leaderboard
  PRIMARY_NAV[4], // Missions
  PRIMARY_NAV[13], // Profile
];

const mobilePrimaryHrefs = new Set(MOBILE_PRIMARY.map((i) => i.href));

/** Everything not on the mobile bottom bar goes into the More sheet, plus Settings. */
export const MORE_NAV: NavItem[] = [
  ...PRIMARY_NAV.filter((i) => !mobilePrimaryHrefs.has(i.href)),
  SETTINGS_ITEM,
];
