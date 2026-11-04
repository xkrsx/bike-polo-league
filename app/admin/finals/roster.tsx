import { FINALS_TEAM_DOT, type FinalsTeamView } from "@/lib/finals";

export function FinalsTeams({
  teams,
  generated,
}: {
  teams: FinalsTeamView[];
  generated: boolean;
}) {
  if (teams.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
          {generated ? "Locked teams" : "Snake draft preview"}
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {generated
            ? "These four teams stay the same for every playoff game."
            : "Preview from the current leaderboard. Generate to lock these teams."}
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {teams.map((team) => (
          <li
            key={team.number}
            className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
          >
            <h3 className="flex items-center gap-2 font-semibold text-zinc-950 dark:text-zinc-50">
              <span
                aria-hidden="true"
                className={`size-2.5 rounded-full ${FINALS_TEAM_DOT[team.number] ?? "bg-zinc-400"}`}
              />
              Team {team.number}
            </h3>
            <ol className="mt-3 flex flex-col gap-2">
              {team.players.map((player) => (
                <li
                  key={player.id}
                  className="flex items-baseline justify-between gap-3 text-sm"
                >
                  <span className="min-w-0 font-medium text-zinc-950 dark:text-zinc-50">
                    <span className="break-words">{player.name}</span>
                    {player.isRookie ? (
                      <span className="ml-2 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold tracking-wide text-amber-800 uppercase dark:bg-amber-400/15 dark:text-amber-300">
                        Rookie
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 tabular-nums text-zinc-500">#{player.rank}</span>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ul>
    </section>
  );
}
