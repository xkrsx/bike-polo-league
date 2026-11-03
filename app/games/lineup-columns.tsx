export interface LineupPlayer {
  id: string;
  name: string;
  goals: number;
  ownGoals: number;
  isRookie: boolean;
}

interface ScoringLine {
  key: string;
  text: string;
  isRookie: boolean;
}

function scoringLines(players: LineupPlayer[]): ScoringLine[] {
  const lines: ScoringLine[] = [];

  for (const player of players) {
    if (player.goals > 0) {
      lines.push({
        key: `${player.id}-goals`,
        text: `${player.name} +${player.goals}`,
        isRookie: player.isRookie,
      });
    }

    if (player.ownGoals > 0) {
      lines.push({
        key: `${player.id}-own-goals`,
        text: `${player.name} +${player.ownGoals} OG`,
        isRookie: player.isRookie,
      });
    }
  }

  return lines;
}

function RookieBadge({ onDark }: { onDark: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${
        onDark
          ? "bg-amber-100 text-amber-800"
          : "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300"
      }`}
    >
      Rookie
    </span>
  );
}

function NameList({
  lines,
  align,
  emphasis,
  onDark,
}: {
  lines: ScoringLine[];
  align: "left" | "right";
  emphasis?: boolean;
  onDark: boolean;
}) {
  const badgeFirst = align === "right";

  return (
    <ul
      className={`flex flex-col gap-0.5 ${align === "right" ? "items-end" : "items-start"} ${
        emphasis ? "font-medium" : ""
      }`}
    >
      {lines.map((line) => (
        <li key={line.key} className="flex items-center gap-1.5">
          {badgeFirst && line.isRookie ? <RookieBadge onDark={onDark} /> : null}
          <span>{line.text}</span>
          {!badgeFirst && line.isRookie ? <RookieBadge onDark={onDark} /> : null}
        </li>
      ))}
    </ul>
  );
}

export function LineupColumns({
  left,
  right,
  onDark = false,
}: {
  left: LineupPlayer[];
  right: LineupPlayer[];
  onDark?: boolean;
}) {
  const leftScorers = scoringLines(left);
  const rightScorers = scoringLines(right);
  const showScorers = leftScorers.length > 0 || rightScorers.length > 0;
  const leftNames = left.map((player) => ({
    key: player.id,
    text: player.name,
    isRookie: player.isRookie,
  }));
  const rightNames = right.map((player) => ({
    key: player.id,
    text: player.name,
    isRookie: player.isRookie,
  }));

  if (!showScorers && leftNames.length === 0 && rightNames.length === 0) {
    return null;
  }

  return (
    <div
      className={`mx-auto grid w-fit grid-cols-2 gap-x-6 gap-y-3 text-sm ${
        onDark ? "text-zinc-50" : "text-zinc-950 dark:text-zinc-50"
      }`}
    >
      {showScorers ? (
        <>
          <NameList lines={leftScorers} align="right" emphasis onDark={onDark} />
          <NameList lines={rightScorers} align="left" emphasis onDark={onDark} />
        </>
      ) : null}
      <NameList lines={leftNames} align="right" onDark={onDark} />
      <NameList lines={rightNames} align="left" onDark={onDark} />
    </div>
  );
}
