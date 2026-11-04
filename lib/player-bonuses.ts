export const COSTUME_BONUS_POINTS = 5;
export const MAX_BONUS_LABEL_LENGTH = 80;
export const MIN_CUSTOM_BONUS_VALUE = -999;
export const MAX_CUSTOM_BONUS_VALUE = 999;

export const PODIUM_OPTIONS = [
  { points: 0, label: "None (0 points)" },
  { points: 15, label: "1st Place (15 points)" },
  { points: 10, label: "2nd Place (10 points)" },
  { points: 5, label: "3rd Place (5 points)" },
] as const;

export interface StoredPlayerBonuses {
  extraPoints: number;
  costumeBonus: boolean;
  customBonusLabel: string;
  customBonusValue: number;
}

export interface PlayerBonusFormValues {
  costumeBonus: boolean;
  customBonusEnabled: boolean;
  customBonusLabel: string;
  customBonusValue: number;
}

export function isPodiumPoints(value: number): boolean {
  return PODIUM_OPTIONS.some((option) => option.points === value);
}

export function sumExtraPoints(costumeBonus: boolean, customBonusValue: number): number {
  return (costumeBonus ? COSTUME_BONUS_POINTS : 0) + customBonusValue;
}

export function playerBonusFormValues(
  player: StoredPlayerBonuses,
): PlayerBonusFormValues {
  const hasCustom =
    player.customBonusValue !== 0 || player.customBonusLabel.trim().length > 0;

  if (player.costumeBonus || hasCustom) {
    return {
      costumeBonus: player.costumeBonus,
      customBonusEnabled: hasCustom,
      customBonusLabel: player.customBonusLabel,
      customBonusValue: player.customBonusValue,
    };
  }

  if (player.extraPoints !== 0) {
    return {
      costumeBonus: false,
      customBonusEnabled: true,
      customBonusLabel: "Extra points",
      customBonusValue: player.extraPoints,
    };
  }

  return {
    costumeBonus: false,
    customBonusEnabled: false,
    customBonusLabel: "",
    customBonusValue: 0,
  };
}

export function playerDeleteBlockReason(
  name: string,
  gamesPlayed: number,
  gamesRefereed: number,
): string | null {
  if (gamesPlayed === 0 && gamesRefereed === 0) {
    return null;
  }

  const reasons: string[] = [];

  if (gamesPlayed > 0) {
    reasons.push(
      gamesPlayed === 1 ? "played in 1 game" : `played in ${gamesPlayed} games`,
    );
  }

  if (gamesRefereed > 0) {
    reasons.push(
      gamesRefereed === 1 ? "refereed 1 game" : `refereed ${gamesRefereed} games`,
    );
  }

  return `${name} has ${reasons.join(" and ")}. Merge them into another player instead of deleting.`;
}
