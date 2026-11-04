export interface PlayerCandidate {
  id: string;
  name: string;
  isRookie?: boolean;
}

export type PlayerResolution =
  | { kind: "exact"; player: PlayerCandidate }
  | {
      kind: "similar";
      player: PlayerCandidate;
      reason: "nickname" | "typo";
    }
  | { kind: "ambiguous"; players: PlayerCandidate[] }
  | { kind: "none" };

interface MatchStrength {
  score: number;
  kind: "exact" | "nickname" | "typo";
}

const AMBIGUOUS_MARGIN = 0.02;

export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanDisplayName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function levenshtein(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  if (left.length === 0) {
    return right.length;
  }

  if (right.length === 0) {
    return left.length;
  }

  const previous = new Array<number>(right.length + 1);
  const current = new Array<number>(right.length + 1);

  for (let column = 0; column <= right.length; column += 1) {
    previous[column] = column;
  }

  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row;

    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + cost,
      );
    }

    for (let column = 0; column <= right.length; column += 1) {
      previous[column] = current[column] ?? 0;
    }
  }

  return previous[right.length] ?? 0;
}

function isTypo(query: string, candidate: string): boolean {
  if (!query || !candidate || query === candidate) {
    return false;
  }

  const shortest = Math.min(query.length, candidate.length);

  if (shortest < 3) {
    return false;
  }

  const distance = levenshtein(query, candidate);
  const longest = Math.max(query.length, candidate.length);
  const similarity = 1 - distance / longest;

  if (distance === 1) {
    return similarity >= 0.75;
  }

  return distance === 2 && longest >= 8 && similarity >= 0.8;
}

function matchStrength(query: string, candidateName: string): MatchStrength | null {
  const candidate = normalizeName(candidateName);

  if (!query || !candidate) {
    return null;
  }

  if (query === candidate) {
    return { score: 1, kind: "exact" };
  }

  const tokens = candidate.split(" ").filter(Boolean);
  const singleToken = !query.includes(" ");

  if (
    singleToken &&
    query.length >= 3 &&
    tokens.some((token) => token === query)
  ) {
    return { score: 0.93, kind: "nickname" };
  }

  const targets = singleToken ? [candidate, ...tokens] : [candidate];
  let bestSimilarity = 0;
  let typo = false;

  for (const target of targets) {
    if (!isTypo(query, target)) {
      continue;
    }

    typo = true;
    const distance = levenshtein(query, target);
    const similarity = 1 - distance / Math.max(query.length, target.length);
    bestSimilarity = Math.max(bestSimilarity, similarity);
  }

  if (!typo) {
    return null;
  }

  return { score: 0.8 + bestSimilarity * 0.08, kind: "typo" };
}

interface RankedPlayer {
  player: PlayerCandidate;
  match: MatchStrength;
}

function rankPlayers(query: string, players: PlayerCandidate[]): RankedPlayer[] {
  const ranked: RankedPlayer[] = [];

  for (const player of players) {
    const match = matchStrength(query, player.name);

    if (match) {
      ranked.push({ player, match });
    }
  }

  ranked.sort(
    (left, right) =>
      right.match.score - left.match.score ||
      left.player.name.localeCompare(right.player.name),
  );

  return ranked;
}

function longerRosterNames(query: string, players: PlayerCandidate[]): PlayerCandidate[] {
  if (query.length < 3) {
    return [];
  }

  return players.filter((player) => {
    const name = normalizeName(player.name);

    if (!name || name === query) {
      return false;
    }

    const parts = name.split(" ").filter(Boolean);

    return parts.some((part) => part === query || part.startsWith(query)) || name.includes(query);
  });
}

function closeContenders(ranked: RankedPlayer[]): RankedPlayer[] {
  const best = ranked[0];

  if (!best) {
    return [];
  }

  return ranked.filter(
    (entry) => best.match.score - entry.match.score <= AMBIGUOUS_MARGIN,
  );
}

export function resolvePlayerName(
  query: string,
  players: PlayerCandidate[],
): PlayerResolution {
  const normalized = normalizeName(query);

  if (!normalized) {
    return { kind: "none" };
  }

  const ranked = rankPlayers(normalized, players);
  const best = ranked[0];
  const longer = longerRosterNames(normalized, players);

  if (longer.length > 1) {
    return { kind: "ambiguous", players: longer.slice(0, 8) };
  }

  if (!best) {
    return longer.length === 1
      ? { kind: "similar", player: longer[0], reason: "nickname" }
      : { kind: "none" };
  }

  if (best.match.kind === "exact" && longer.length === 0) {
    return { kind: "exact", player: best.player };
  }

  if (longer.length === 1) {
    return { kind: "similar", player: longer[0], reason: "nickname" };
  }

  const contenders = closeContenders(ranked);

  if (contenders.length > 1) {
    return {
      kind: "ambiguous",
      players: contenders.map((entry) => entry.player),
    };
  }

  return {
    kind: "similar",
    player: best.player,
    reason: best.match.kind === "nickname" ? "nickname" : "typo",
  };
}

export interface ClassifiedPlayerName {
  confidence: "high" | "low" | "none";
  player: PlayerCandidate | null;
  suggestions: PlayerCandidate[];
}

function looseSuggestion(
  query: string,
  players: PlayerCandidate[],
): PlayerCandidate | null {
  let best: { player: PlayerCandidate; score: number } | null = null;

  for (const player of players) {
    const name = normalizeName(player.name);

    if (!name || name === query) {
      continue;
    }

    const tokens = name.split(" ").filter(Boolean);
    let score = 0;

    if (
      query.length >= 4 &&
      (name.startsWith(query) || tokens.some((token) => token.startsWith(query)))
    ) {
      score = 0.72;
    } else if (query.length >= 4) {
      const distance = levenshtein(query, name);
      const similarity = 1 - distance / Math.max(query.length, name.length);

      if (distance > 0 && distance <= 3 && similarity >= 0.55) {
        score = similarity * 0.7;
      }
    }

    if (score <= 0) {
      continue;
    }

    if (
      !best ||
      score > best.score ||
      (score === best.score && player.name.localeCompare(best.player.name) < 0)
    ) {
      best = { player, score };
    }
  }

  return best?.player ?? null;
}

/**
 * Exact and unambiguous close matches are pre-selected.
 * Ambiguous names stay unselected and are offered as "Did you mean".
 * A weaker hint that is not a close match is also only a suggestion.
 */
export function classifyPlayerName(
  query: string,
  players: PlayerCandidate[],
): ClassifiedPlayerName {
  const normalized = normalizeName(query);

  if (!normalized) {
    return { confidence: "none", player: null, suggestions: [] };
  }

  const ranked = rankPlayers(normalized, players);
  const best = ranked[0];
  const longer = longerRosterNames(normalized, players);

  if (longer.length > 1) {
    return {
      confidence: "low",
      player: null,
      suggestions: longer.slice(0, 8),
    };
  }

  if (longer.length === 1 && (!best || best.match.kind !== "typo" || best.player.id === longer[0].id)) {
    return { confidence: "high", player: longer[0], suggestions: [] };
  }

  if (!best) {
    const loose = looseSuggestion(normalized, players);

    return loose
      ? { confidence: "low", player: null, suggestions: [loose] }
      : { confidence: "none", player: null, suggestions: [] };
  }

  const contenders = closeContenders(ranked);

  if (contenders.length > 1) {
    return {
      confidence: "low",
      player: null,
      suggestions: contenders.slice(0, 3).map((entry) => entry.player),
    };
  }

  return { confidence: "high", player: best.player, suggestions: [] };
}

export function playerCorrections(
  query: string,
  players: PlayerCandidate[],
): PlayerCandidate[] {
  const resolution = resolvePlayerName(query, players);

  if (resolution.kind === "ambiguous") {
    return resolution.players.slice(0, 3);
  }

  if (resolution.kind !== "similar") {
    return [];
  }

  const normalizedQuery = normalizeName(query);
  const completingExistingName =
    resolution.reason === "typo" &&
    normalizeName(resolution.player.name).startsWith(normalizedQuery);

  if (completingExistingName) {
    return [];
  }

  return [resolution.player];
}

export function searchPlayers(
  query: string,
  players: PlayerCandidate[],
): PlayerCandidate[] {
  const normalized = normalizeName(query);

  if (!normalized) {
    return [];
  }

  const ranked: Array<{ player: PlayerCandidate; score: number }> = [];

  for (const player of players) {
    const name = normalizeName(player.name);

    if (!name) {
      continue;
    }

    const tokens = name.split(" ").filter(Boolean);
    let score = 0;

    if (name === normalized) {
      score = 1;
    } else if (name.startsWith(normalized)) {
      score = 0.97;
    } else if (tokens.some((token) => token.startsWith(normalized))) {
      score = 0.95;
    } else if (name.includes(normalized)) {
      score = 0.9;
    }

    const strength = matchStrength(normalized, player.name);

    if (strength && strength.kind !== "exact") {
      score = Math.max(score, strength.score);
    }

    if (score > 0) {
      ranked.push({ player, score });
    }
  }

  ranked.sort(
    (left, right) =>
      right.score - left.score ||
      left.player.name.localeCompare(right.player.name),
  );

  return ranked.slice(0, 6).map((entry) => entry.player);
}
