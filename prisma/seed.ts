import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, TeamAssigned } from "@prisma/client";

interface SeedPlayer {
  key: string;
  name: string;
  isRookie: boolean;
}

interface SeedLine {
  playerKey: string;
  teamAssigned: TeamAssigned;
  goals: number;
  fouls: number;
}

interface SeedGame {
  refereeKey: string;
  lines: SeedLine[];
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const roster: SeedPlayer[] = [
  { key: "maya", name: "Maya Ortiz", isRookie: false },
  { key: "alex", name: "Alex Rivera", isRookie: false },
  { key: "sam", name: "Sam Okonkwo", isRookie: false },
  { key: "casey", name: "Casey Nguyen", isRookie: false },
  { key: "jordan", name: "Jordan Hale", isRookie: true },
  { key: "riley", name: "Riley Chen", isRookie: true },
  { key: "noah", name: "Noah Patel", isRookie: true },
];

const games: SeedGame[] = [
  {
    refereeKey: "maya",
    lines: [
      { playerKey: "alex", teamAssigned: TeamAssigned.TEAM_A, goals: 2, fouls: 1 },
      { playerKey: "sam", teamAssigned: TeamAssigned.TEAM_A, goals: 1, fouls: 0 },
      { playerKey: "casey", teamAssigned: TeamAssigned.TEAM_A, goals: 0, fouls: 1 },
      { playerKey: "jordan", teamAssigned: TeamAssigned.TEAM_B, goals: 1, fouls: 2 },
      { playerKey: "riley", teamAssigned: TeamAssigned.TEAM_B, goals: 0, fouls: 0 },
      { playerKey: "noah", teamAssigned: TeamAssigned.TEAM_B, goals: 0, fouls: 1 },
    ],
  },
  {
    refereeKey: "alex",
    lines: [
      { playerKey: "sam", teamAssigned: TeamAssigned.TEAM_A, goals: 2, fouls: 0 },
      { playerKey: "casey", teamAssigned: TeamAssigned.TEAM_A, goals: 1, fouls: 1 },
      { playerKey: "maya", teamAssigned: TeamAssigned.TEAM_A, goals: 0, fouls: 0 },
      { playerKey: "jordan", teamAssigned: TeamAssigned.TEAM_B, goals: 2, fouls: 1 },
      { playerKey: "riley", teamAssigned: TeamAssigned.TEAM_B, goals: 1, fouls: 0 },
      { playerKey: "noah", teamAssigned: TeamAssigned.TEAM_B, goals: 0, fouls: 2 },
    ],
  },
  {
    refereeKey: "sam",
    lines: [
      { playerKey: "alex", teamAssigned: TeamAssigned.TEAM_A, goals: 3, fouls: 0 },
      { playerKey: "maya", teamAssigned: TeamAssigned.TEAM_A, goals: 1, fouls: 1 },
      { playerKey: "casey", teamAssigned: TeamAssigned.TEAM_A, goals: 1, fouls: 0 },
      { playerKey: "jordan", teamAssigned: TeamAssigned.TEAM_B, goals: 1, fouls: 1 },
      { playerKey: "riley", teamAssigned: TeamAssigned.TEAM_B, goals: 1, fouls: 0 },
      { playerKey: "noah", teamAssigned: TeamAssigned.TEAM_B, goals: 0, fouls: 1 },
    ],
  },
];

function teamScore(lines: SeedLine[], team: TeamAssigned): number {
  return lines
    .filter((line) => line.teamAssigned === team)
    .reduce((total, line) => total + line.goals, 0);
}

async function main(): Promise<void> {
  await prisma.gamePlayer.deleteMany();
  await prisma.game.deleteMany();
  await prisma.player.deleteMany();

  const players = new Map<string, string>();

  for (const player of roster) {
    const created = await prisma.player.create({
      data: {
        name: player.name,
        isRookie: player.isRookie,
      },
    });
    players.set(player.key, created.id);
  }

  for (const game of games) {
    const refereeId = players.get(game.refereeKey);

    if (!refereeId) {
      throw new Error(`Unknown referee "${game.refereeKey}"`);
    }

    if (game.lines.some((line) => line.playerKey === game.refereeKey)) {
      throw new Error(`Referee "${game.refereeKey}" is also listed as a player`);
    }

    await prisma.game.create({
      data: {
        scoreTeamA: teamScore(game.lines, TeamAssigned.TEAM_A),
        scoreTeamB: teamScore(game.lines, TeamAssigned.TEAM_B),
        refereeId,
        players: {
          create: game.lines.map((line) => {
            const playerId = players.get(line.playerKey);

            if (!playerId) {
              throw new Error(`Unknown player "${line.playerKey}"`);
            }

            return {
              playerId,
              teamAssigned: line.teamAssigned,
              goals: line.goals,
              fouls: line.fouls,
            };
          }),
        },
      },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
