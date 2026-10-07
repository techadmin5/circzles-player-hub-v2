export const DEFAULT_PLAYER_AVATAR = "/brand/avatar.svg";
export const avatarSources = ["DEFAULT", "CUSTOM_UPLOAD", "INVENTORY_AVATAR"] as const;
export type AvatarSource = typeof avatarSources[number];
export function effectiveAvatar(source: string, customUrl?: string | null, inventoryUrl?: string | null) {
  return (source === "CUSTOM_UPLOAD" ? customUrl : source === "INVENTORY_AVATAR" ? inventoryUrl : null) || DEFAULT_PLAYER_AVATAR;
}
