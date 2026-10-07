export type RankName = "Peasant" | "Farmer" | "Squire" | "Knight" | "Apprentice" | "Nobleman" | "Master" | "Hero" | "Conqueror";
export type PuzzleStatus = "OWNED" | "READY_TO_SOLVE" | "SUBMISSION_PENDING" | "APPROVED" | "REJECTED" | "COMPLETED";
export type SubmissionStatus = "DRAFT" | "UPLOADING" | "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "RESUBMISSION_REQUIRED";
export type MissionCategory = "DAILY" | "WEEKLY" | "SPRINT" | "SEASON" | "EVENT" | "ACHIEVEMENT";
export type ApiMissionStatus = "IN_PROGRESS" | "CLAIMABLE" | "CLAIMED";
export type MissionStatus = "LOCKED" | "ACTIVE" | "COMPLETED" | "EXPIRED" | ApiMissionStatus;
export type MissionPeriodType = "DAILY" | "WEEKLY" | "LIFETIME" | "FIXED";
export type ApiMissionRewardType = "SYNAPSE_POINTS" | "XP";
export type RewardType = "Synapse Points" | "XP" | "Badge" | "Frame" | "Coupon" | "Item";
export type StoreState = "BUY" | "OWNED" | "EQUIPPED" | "SOLD_OUT" | "COMING_SOON";
export type Rarity = "common" | "rare" | "epic" | "legendary";

export interface Player {
  internalId: string;
  publicPlayerId: string;
  displayName: string;
  avatar: string;
  avatarSource?: "DEFAULT" | "CUSTOM_UPLOAD" | "INVENTORY_AVATAR";
  customAvatarAvailable?: boolean;
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

export type AuthenticatedPlayerIdentity = Pick<Player, "internalId" | "publicPlayerId" | "displayName" | "avatar" | "country" | "state">;

export interface Puzzle {
  id: string;
  name: string;
  sku?: string;
  runCode?: string;
  pieceCount?: number;
  sizeLabel?: string;
  levelId: number;
  image: string;
  description: string;
}

export interface PlayerPuzzle extends Puzzle {
  playerPuzzleId?: string;
  status: PuzzleStatus;
  personalBest?: string;
  leaderboardRank?: number;
  latestSubmissionStatus?: SubmissionStatus;
}

export interface Submission {
  id: string;
  playerPuzzleId?: string;
  puzzleId: string;
  puzzleName: string;
  levelId: number;
  completionTime: string;
  completionTimeMs?: number;
  status: SubmissionStatus;
  createdAt: string;
  reviewNote?: string;
  videoUploadId?: string;
}

export interface SignedVideoUpload {
  videoUploadId: string;
  uploadUrl: string;
  expiresAt: string;
  fields: { apiKey: string; timestamp: number; publicId: string; signature: string };
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

export type LeaderboardCategory = "MAIN_LEVEL" | "SIDE_QUEST";

export interface LeaderboardPuzzle {
  puzzleId: string;
  puzzleName: string;
  runCode?: string;
  levelId: number;
  category: LeaderboardCategory;
}

export interface LeaderboardCatalogItem extends LeaderboardPuzzle {
  displayOrder: number;
}

export interface LeaderboardCatalog {
  mainLevels: LeaderboardCatalogItem[];
  sideQuests: LeaderboardCatalogItem[];
}

export interface LeaderboardRow {
  rank: number;
  publicPlayerId: string;
  displayName: string;
  bestTimeMs: number;
  bestTime: string;
  isCurrentPlayer: boolean;
}

export interface LeaderboardResponse {
  puzzle: LeaderboardPuzzle;
  entries: LeaderboardRow[];
  currentPlayerEntry: LeaderboardRow | null;
}

export interface PublicPlayerProfile {
  publicPlayerId: string;
  displayName: string;
  progressionRank: string;
  approvedPuzzlesSolved: number;
  avatarUrl: string | null;
  equippedFrame: string | null;
  displayedBadges: string[];
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
export type ApiRewardType = "FRAME" | "BADGE" | "AVATAR" | "RENAME_CARD" | "COUPON" | "SYNAPSE_POINTS" | "XP" | "COSMETIC";
export type EquipmentSlot = "FRAME" | "AVATAR" | "BADGE_1" | "BADGE_2" | "BADGE_3";
export interface InventoryItem { id: string; rewardDefinitionId?: string; code?: string; rewardType?: ApiRewardType; name: string; description?: string; imageUrl?: string | null; category: "Frames" | "Badges" | "Avatars" | "Rename Cards" | "Coupons" | "Special"; state: "Owned" | "Equipped" | "Consumable" | "Used" | "Expired" | "Locked"; rarity: Rarity; quantity?: number; firstAcquiredAt?: string; equippedSlots?: EquipmentSlot[] }
export interface InventoryResponse { items: Array<{ inventoryItemId: string; rewardDefinitionId: string; code: string; rewardType: ApiRewardType; name: string; description: string; imageUrl: string | null; rarity: string | null; quantity: number; firstAcquiredAt: string; equippedSlots: EquipmentSlot[] }>; equipment: Partial<Record<EquipmentSlot, string>> }
export interface RenameDisplayNameResult { inventoryConsumptionId: string; publicPlayerId: string; previousDisplayName: string; displayName: string; inventoryItemId: string; remainingQuantity: number; consumedAt: string; idempotent: boolean; inventory: InventoryResponse }
export interface StoreItem { id: string; rewardType?: ApiRewardType; name: string; type: "Frame" | "Badge" | "Avatar" | "Utility" | "Coupon"; cost: number; state: StoreState; rarity: Rarity; description: string; imageUrl?: string | null; ownedQuantity?: number; canPurchase?: boolean; remainingPurchases?: number | null }
export interface ApiStoreCatalogItem { listingId: string; rewardDefinitionId: string; code: string; rewardType: ApiRewardType; name: string; description: string; imageUrl: string | null; rarity: string | null; priceSynapsePoints: number; featured: boolean; displayOrder: number; purchaseLimit: number | null; ownedQuantity: number; alreadyOwned: boolean; purchaseCount: number; remainingPurchases: number | null; canPurchase: boolean }
export interface StorePurchaseResult { purchaseId: string; listingId: string; reward: { rewardDefinitionId: string; code: string; rewardType: ApiStoreCatalogItem["rewardType"]; name: string; imageUrl: string | null; rarity: string | null }; priceSynapsePoints: number; balanceAfter: number; purchasedAt: string; idempotent: boolean }
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
  periodType?: MissionPeriodType;
  periodKey?: string;
  startAt: string | null;
  endAt: string | null;
  timeRemaining: string;
  claimable: boolean;
}
export interface ApiMissionDto {
  missionId: string;
  title: string;
  description: string;
  category: MissionCategory;
  periodType: MissionPeriodType;
  periodKey: string;
  status: ApiMissionStatus;
  progress: MissionProgress;
  claimable: boolean;
  startsAt: string | null;
  endsAt: string | null;
  rewards: Array<{ type: ApiMissionRewardType; amount: number; label: string }>;
}
export interface MissionClaimResult {
  missionClaimId: string;
  missionId: string;
  periodKey: string;
  status: "CLAIMED";
  claimedAt: string;
  idempotent: boolean;
  awarded: { synapsePoints: number; xp: number };
  playerState: { synapsePoints: number; xp: number; progressionLevel: number; rankName: string };
}
export interface Friend { player: Player; since: string }
export interface FriendRequest { id: string; player: Player; direction: "INCOMING" | "OUTGOING"; createdAt: string }
export interface Notification { id: string; type: string; title: string; body: string; read: boolean; createdAt: string }
export interface ActivityEvent { id: string; type: string; title: string; detail: string; createdAt: string; category: "Puzzles" | "Competitive" | "Rewards" | "Economy" | "Social" }
export interface Season { seasonId: string; name: string; artwork: string; startAt: string; endAt: string; status: "UPCOMING" | "ACTIVE" | "ENDED"; playerRank: number; rewards: MissionReward[]; missions: Mission[] }
export interface RewardWheelSegment { wheelSegmentIndex: number; label: string; rewardType: ApiRewardType; rewardValue: number; imageUrl: string | null; rarity: string | null; displayMetadata: Record<string, unknown> }
export interface RewardWheelStatus { available: boolean; wheel: null | { code: string; name: string; cycleSeconds: number; cycleStartedAt: string | null; cycleEndsAt: string | null; spinsUsed: number; maxSpinsPerCycle: number; spinsRemaining: number; nextSpinNumber: number | null; nextSpinCostSynapsePoints: number | null; nextSpinIsFree: boolean; canAffordNextSpin: boolean; canSpin: boolean; unavailableReason: string | null; segments: RewardWheelSegment[] } }
export interface RewardWheelResult { spinId?: string; rewardId: string; rewardDefinitionId?: string; rewardType: RewardType | ApiRewardType; rewardLabel: string; rewardValue: number; resultingBalance: number; wheelSegmentIndex: number; spunAt?: string; spinNumber?: number | null; chargedSynapsePoints?: number; cycleStartedAt?: string | null; cycleEndsAt?: string | null; idempotent?: boolean }
