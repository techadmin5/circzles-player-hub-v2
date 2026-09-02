export type RankName = "Peasant" | "Farmer" | "Squire" | "Knight" | "Apprentice" | "Nobleman" | "Master" | "Hero" | "Conqueror";
export type PuzzleStatus = "OWNED" | "READY_TO_SOLVE" | "SUBMISSION_PENDING" | "APPROVED" | "REJECTED" | "COMPLETED";
export type SubmissionStatus = "DRAFT" | "UPLOADING" | "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "RESUBMISSION_REQUIRED";
export type MissionCategory = "DAILY" | "WEEKLY" | "SPRINT" | "SEASON" | "EVENT" | "ACHIEVEMENT";
export type MissionStatus = "LOCKED" | "ACTIVE" | "COMPLETED" | "CLAIMABLE" | "CLAIMED" | "EXPIRED";
export type RewardType = "Synapse Points" | "XP" | "Badge" | "Frame" | "Coupon" | "Item";
export type StoreState = "BUY" | "OWNED" | "EQUIPPED" | "SOLD_OUT" | "COMING_SOON";
export type Rarity = "common" | "rare" | "epic" | "legendary";

export interface Player {
  internalId: string;
  publicPlayerId: string;
  displayName: string;
  avatar: string;
  country: string;
  state: string;
  progressionLevel: number;
  rank: RankName;
  xp: number;
  xpNeeded: number;
  synapsePoints: number;
  streak: number;
  equippedFrame: string;
  badgeShowcase: string[];
}

export interface PlayerProfile extends Player {
  stats: Record<"ownedPuzzles" | "completed" | "approvedAttempts" | "personalBests" | "podiums" | "seasonRank" | "longestStreak", number>;
  isFriend?: boolean;
}

export interface Puzzle {
  id: string;
  name: string;
  sku: string;
  levelId: number;
  image: string;
  description: string;
}

export interface PlayerPuzzle extends Puzzle {
  status: PuzzleStatus;
  personalBest?: string;
  leaderboardRank?: number;
  latestSubmissionStatus?: SubmissionStatus;
}

export interface Submission {
  id: string;
  puzzleId: string;
  puzzleName: string;
  levelId: number;
  completionTime: string;
  status: SubmissionStatus;
  createdAt: string;
  reviewNote?: string;
}

export interface LeaderboardFilter {
  mode: "GLOBAL" | "COUNTRY" | "STATE" | "FRIENDS";
  puzzleId?: string;
  levelId?: number;
  seasonId?: string;
  period: "ALL_TIME" | "SEASON";
}

export interface LeaderboardEntry {
  rank: number;
  player: Pick<Player, "publicPlayerId" | "displayName" | "avatar" | "rank">;
  time: string;
  puzzle: string;
  levelId: number;
  region: string;
  isCurrentPlayer?: boolean;
}

export interface ProgressionLevel {
  progressionLevel: number;
  rank: RankName;
  xpRequired: number;
  rewards: string[];
}

export interface Wallet { synapsePoints: number }
export interface PointTransaction { id: string; amount: number; reason: string; createdAt: string }
export interface XpTransaction { id: string; amount: number; reason: string; createdAt: string }
export interface InventoryItem { id: string; name: string; category: "Frames" | "Badges" | "Rename Cards" | "Coupons" | "Special"; state: "Owned" | "Equipped" | "Consumable" | "Used" | "Expired" | "Locked"; rarity: Rarity }
export interface StoreItem { id: string; name: string; type: "Frame" | "Badge" | "Utility" | "Coupon"; cost: number; state: StoreState; rarity: Rarity; description: string }
export interface Coupon { id: string; code: string; discount: string; source: string; createdAt: string; expiry: string; status: "ACTIVE" | "USED" | "EXPIRED" }
export interface MissionReward { type: RewardType; label: string; value?: number }
export interface MissionProgress { current: number; target: number }
export interface Mission {
  missionId: string;
  title: string;
  description: string;
  category: MissionCategory;
  status: MissionStatus;
  progress: MissionProgress;
  rewards: MissionReward[];
  startAt: string;
  endAt: string;
  timeRemaining: string;
  claimable: boolean;
}
export interface Friend { player: Player; since: string }
export interface FriendRequest { id: string; player: Player; direction: "INCOMING" | "OUTGOING"; createdAt: string }
export interface Notification { id: string; type: string; title: string; body: string; read: boolean; createdAt: string }
export interface ActivityEvent { id: string; type: string; title: string; detail: string; createdAt: string; category: "Puzzles" | "Competitive" | "Rewards" | "Economy" | "Social" }
export interface Season { seasonId: string; name: string; artwork: string; startAt: string; endAt: string; status: "UPCOMING" | "ACTIVE" | "ENDED"; playerRank: number; rewards: MissionReward[]; missions: Mission[] }
export interface RewardWheelResult { rewardId: string; rewardType: RewardType; rewardLabel: string; rewardValue: number; resultingBalance: number; wheelSegmentIndex: number }
