import { customAlphabet } from "nanoid";

const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const makeId = customAlphabet(alphabet, 6);

export function generatePublicPlayerId() {
  return `CZ-${makeId()}`;
}
