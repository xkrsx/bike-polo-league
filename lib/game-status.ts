export const GAME_PENDING = "PENDING";
export const GAME_APPROVED = "APPROVED";
export const GAME_REJECTED = "REJECTED";

export const GAME_STATUSES = [GAME_PENDING, GAME_APPROVED, GAME_REJECTED] as const;

export type GameStatus = (typeof GAME_STATUSES)[number];

export function isGameStatus(value: string): value is GameStatus {
  return (GAME_STATUSES as readonly string[]).includes(value);
}

export function gameStatusLabel(status: string): string {
  switch (status) {
    case GAME_APPROVED:
      return "Approved";
    case GAME_REJECTED:
      return "Rejected";
    default:
      return "Pending";
  }
}
