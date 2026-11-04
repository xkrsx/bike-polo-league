import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { isDuplicateMatch, type DuplicateCandidate } from "../lib/duplicate-match";
import { bufferToJpeg, cropRefSheetQuadrants } from "../lib/ref-sheet-image";
import { classifyPlayerName } from "../lib/player-match";
import { splitRefSheetQuadrants, type SheetWord } from "../lib/ref-sheet-layout";
import {
  extractFilledSheets,
  isFilledRefSheet,
  parseRefSheetCards,
  parseRefSheetOcr,
  readableSheetName,
} from "../lib/ref-sheet-ocr";
import { annotateRefSheet, matchFilledSheets } from "../lib/ref-sheet-match";
import { imageTypeForUpload } from "../lib/ref-sheet-storage";
import {
  buildVisionRequest,
  normalizeVisionCards,
  parseVisionPayload,
  VISION_SYSTEM_PROMPT,
} from "../lib/ref-sheet-vision";

const oneCard = `
REF: Anna ASST: Ben MATCH NO: 12
TEAM NAME: Sharks
CAPT
Anna ●●●○○○○○○○ ☑ 30s ☐ 1m ☐ EXP
Ben ○○○○○○○○○○
Cara ●○○○○○○○○○ 1m
4
TEAM NAME: Jets
CAPT
Dan ●●○○○○○○○○ EXP
Eve ○○○○○○○○○○ ☐ 30s ☐ 1m ☐ EXP
Finn ●●●●○○○○○○ 30s 30s
2
`;

const cards = parseRefSheetCards(oneCard);
assert.equal(cards.length, 1);
assert.deepEqual(cards[0]?.referees, ["Anna", "Ben"]);
assert.deepEqual(cards[0]?.skipped.sort(), ["captain marks", "match number", "team names"]);
assert.equal(cards[0]?.teamA[0]?.name, "Anna");
assert.equal(cards[0]?.teamA[0]?.goals, 3);
assert.equal(cards[0]?.teamA[0]?.penalties.thirtySeconds, 1);
assert.equal(cards[0]?.teamA[0]?.penalties.oneMinute, false);
assert.equal(cards[0]?.teamA[0]?.fouls, 1);
assert.equal(cards[0]?.teamA[1]?.goals, 0);
assert.equal(cards[0]?.teamA[1]?.fouls, 0);
assert.equal(cards[0]?.teamA[2]?.name, "Cara");
assert.equal(cards[0]?.teamA[2]?.goals, 1);
assert.equal(cards[0]?.teamA[2]?.penalties.oneMinute, true);
assert.equal(cards[0]?.scoreTeamA, 4);
assert.equal(cards[0]?.teamB[0]?.name, "Dan");
assert.equal(cards[0]?.teamB[0]?.goals, 2);
assert.equal(cards[0]?.teamB[0]?.penalties.expulsion, true);
assert.equal(cards[0]?.teamB[1]?.fouls, 0);
assert.equal(cards[0]?.teamB[2]?.name, "Finn");
assert.equal(cards[0]?.teamB[2]?.goals, 4);
assert.equal(cards[0]?.teamB[2]?.penalties.thirtySeconds, 2);
assert.equal(cards[0]?.teamB[2]?.fouls, 2);
assert.equal(cards[0]?.scoreTeamB, 2);
assert.equal(cards[0]?.notes.length, 0);
assert.equal(parseRefSheetCards(`${oneCard}\nGus`)[0]?.teamB.length, 3);
assert.equal(parseRefSheetCards(`${oneCard}\nGus`)[0]?.notes.join(" "), "");
assert.equal(readableSheetName("Anna"), "Anna");
assert.equal(readableSheetName("ALEX"), "ALEX");
assert.equal(readableSheetName("HAYA"), "HAYA");
assert.equal(readableSheetName("MAYA"), "MAYA");
assert.equal(readableSheetName("KUBA"), "KUBA");
assert.equal(readableSheetName("NOVA"), "NOVA");
assert.equal(readableSheetName("KUBAS"), "KUBAS");
assert.equal(readableSheetName("X"), null);
assert.equal(readableSheetName("ALEX X"), null);
assert.equal(readableSheetName("Ed Lu"), "Ed Lu");
assert.equal(readableSheetName("le Se"), null);
assert.equal(readableSheetName("CU RS CA"), null);
for (const printed of [
  "TEAM NAME:",
  "PENALTIES",
  "GOALS",
  "MATCH NO.",
  "CAPT",
  "SCORE",
  "NAME/NUMBER",
  "30s",
  "1m",
  "EXP",
  "REF",
  "ASST",
]) {
  assert.equal(readableSheetName(printed), null, printed);
}
assert.equal(readableSheetName("To Ta was left off. Each side uses three players."), null);

const twoCards = `${oneCard}
REF: Mia ASST: Noah MATCH NO: 2
TEAM NAME: Owls
Mo ○○○○○○○○○○
Pat ●●○○○○○○○○
Quin
3
TEAM NAME: Foxes
Ray
Sue ●○○○○○○○○○
Tess
1
`;

const many = parseRefSheetCards(twoCards);
assert.equal(many.length, 2);
assert.deepEqual(many[1]?.referees, ["Mia", "Noah"]);
assert.equal(many[1]?.teamA[0]?.name, "Mo");
assert.equal(many[1]?.teamA[1]?.goals, 2);
assert.equal(many[1]?.scoreTeamA, 3);
assert.equal(many[1]?.scoreTeamB, 1);
assert.equal(many[1]?.teamA.length, 3);

assert.equal(
  parseRefSheetCards("ST 0 3s 3s tw be ST 0 3s 3s tw Bp").length,
  0,
);
assert.equal(parseRefSheetCards("Sam 12\n●●○○○○○○○○").length, 1);

const blank = `
REF ASST MATCH NO
TEAM NAME
CAPT NAME/NUMBER GOALS PENALTIES SCORE
☐ 30s ☐ 1m ☐ EXP
`;
assert.equal(parseRefSheetCards(blank).length, 0);
assert.equal(isFilledRefSheet(parseRefSheetOcr(blank)), false);
assert.match(parseRefSheetOcr(twoCards).notes.join(" "), /1 more filled match/);

function word(text: string, x: number, y: number): SheetWord {
  return { text, x0: x, y0: y, x1: x + 40, y1: y + 12 };
}

function cluster(label: string, x: number, y: number): SheetWord[] {
  return [
    word("REF", x, y),
    word(label, x + 80, y),
    word("ASST", x, y + 20),
    word("TEAM", x, y + 60),
    word("NAME", x + 50, y + 60),
    word("GOALS", x, y + 90),
    word("PENALTIES", x + 80, y + 90),
    word("SCORE", x + 160, y + 90),
    word("CAPT", x, y + 120),
    word(label, x + 40, y + 150),
  ];
}

const quadrants = splitRefSheetQuadrants([
  ...cluster("Anna", 40, 40),
  ...cluster("Mia", 640, 40),
  ...cluster("Owen", 40, 640),
  ...cluster("Ruth", 640, 640),
]);
assert.equal(quadrants?.length, 4);
assert.deepEqual(
  quadrants?.map((quadrant) => quadrant.region),
  ["top-left", "bottom-left", "top-right", "bottom-right"],
);
assert.match(quadrants?.[0]?.text ?? "", /Anna/);
assert.match(quadrants?.[3]?.text ?? "", /Ruth/);
assert.equal(
  splitRefSheetQuadrants([
    word("REF", 10, 10),
    word("Anna", 80, 10),
    word("GOALS", 20, 40),
    word("SCORE", 20, 70),
  ]),
  null,
);

const located = extractFilledSheets("ignored", [
  ...cluster("Anna", 40, 40),
  ...cluster("Mia", 640, 40),
  word("REF", 40, 640),
  word("ASST", 40, 660),
  word("TEAM", 40, 700),
  word("NAME", 90, 700),
  word("GOALS", 40, 740),
  word("SCORE", 40, 780),
  word("CAPT", 40, 820),
  word("REF", 640, 640),
  word("ASST", 640, 660),
  word("TEAM", 640, 700),
  word("NAME", 690, 700),
  word("GOALS", 640, 740),
  word("SCORE", 640, 780),
  word("CAPT", 640, 820),
]);
assert.equal(located.length, 2);
assert.equal(located[0]?.region, "top-left");
assert.equal(located[1]?.region, "top-right");

const ordered = extractFilledSheets("", [
  ...cluster("Anna", 40, 40),
  ...cluster("Mia", 640, 40),
  ...cluster("Owen", 40, 640),
  ...cluster("Ruth", 640, 640),
]);
assert.deepEqual(
  ordered.map((card) => card.region),
  ["top-left", "bottom-left", "top-right", "bottom-right"],
);

const players = [
  { id: "anna", name: "Anna Lee" },
  { id: "sam-a", name: "Sam A" },
  { id: "sam-b", name: "Sam B" },
  { id: "ben", name: "Ben" },
];
assert.equal(classifyPlayerName("Ben", players).confidence, "high");
assert.equal(classifyPlayerName("Ben", players).player?.id, "ben");
assert.equal(classifyPlayerName("Anna", players).confidence, "high");
assert.equal(classifyPlayerName("Anna", players).player?.id, "anna");
assert.equal(classifyPlayerName("Benn", players).confidence, "high");
assert.equal(classifyPlayerName("Benn", players).player?.id, "ben");
assert.equal(classifyPlayerName("Benn", players).suggestions.length, 0);
assert.equal(classifyPlayerName("Sam", players).confidence, "low");
assert.equal(classifyPlayerName("Sam", players).suggestions.length, 2);
assert.equal(classifyPlayerName("Zed", players).confidence, "none");
const quinnNames = [
  { id: "quinn", name: "Quinn" },
  { id: "nova", name: "Nova Quinn" },
  { id: "adler", name: "Quinn Adler" },
];
const quinnClass = classifyPlayerName("QUINN", quinnNames);
assert.equal(quinnClass.confidence, "low");
assert.equal(quinnClass.player, null);
assert.deepEqual(
  quinnClass.suggestions.map((player) => player.name),
  ["Nova Quinn", "Quinn Adler"],
);

const matched = matchFilledSheets(oneCard, [], players);
assert.equal(matched.length, 1);
assert.equal(matched[0]?.referees[0]?.playerId, "anna");
assert.equal(matched[0]?.referees[0]?.confidence, "high");
assert.equal(matched[0]?.referees[1]?.playerId, "ben");
assert.equal(matched[0]?.referees[1]?.confidence, "high");
assert.equal(matched[0]?.teamA[0]?.playerId, "anna");
assert.equal(matched[0]?.teamA[0]?.confidence, "high");
assert.equal(matched[0]?.teamB[0]?.confidence, "none");

const boxed = `
REF: Ada
TEAM NAME: Red
Ada ●●●●●●●●●● [x] 30s [ ] 1min [x] EXP
SCORE [9]
TEAM NAME: Blue
Bea ☑ ☑ ☐ ☑
[2]
`;
const boxedCards = parseRefSheetCards(boxed);
assert.equal(boxedCards.length, 1);
assert.equal(boxedCards[0]?.teamA[0]?.name, "Ada");
assert.equal(boxedCards[0]?.teamA[0]?.goals, 9);
assert.equal(boxedCards[0]?.teamA[0]?.penalties.thirtySeconds, 1);
assert.equal(boxedCards[0]?.teamA[0]?.penalties.oneMinute, false);
assert.equal(boxedCards[0]?.teamA[0]?.penalties.expulsion, true);
assert.equal(boxedCards[0]?.teamA[0]?.fouls, 2);
assert.equal(boxedCards[0]?.scoreTeamA, 9);
assert.equal(boxedCards[0]?.teamB[0]?.name, "Bea");
assert.equal(boxedCards[0]?.teamB[0]?.penalties.thirtySeconds, 2);
assert.equal(boxedCards[0]?.teamB[0]?.penalties.oneMinute, false);
assert.equal(boxedCards[0]?.teamB[0]?.penalties.expulsion, true);
assert.equal(boxedCards[0]?.teamB[0]?.fouls, 3);
assert.equal(boxedCards[0]?.scoreTeamB, 2);
assert.ok(boxedCards[0]?.skipped.includes("team names"));

const saved: DuplicateCandidate = {
  scoreTeamA: 4,
  scoreTeamB: 2,
  refereeId: "anna",
  assistantId: "ben",
  players: [
    { playerId: "a", team: "TEAM_A", goals: 3 },
    { playerId: "b", team: "TEAM_A", goals: 1 },
    { playerId: "c", team: "TEAM_A", goals: 0 },
    { playerId: "d", team: "TEAM_B", goals: 2 },
    { playerId: "e", team: "TEAM_B", goals: 0 },
    { playerId: "f", team: "TEAM_B", goals: 0 },
  ],
};
assert.equal(isDuplicateMatch(saved, { ...saved, players: [...saved.players].reverse() }), true);
assert.equal(
  isDuplicateMatch(saved, { ...saved, refereeId: "ben", assistantId: "anna" }),
  true,
);
assert.equal(
  isDuplicateMatch(saved, { ...saved, refereeId: null, assistantId: null }),
  true,
);
assert.equal(
  isDuplicateMatch({ ...saved, refereeId: null, assistantId: null }, saved),
  false,
);
assert.equal(isDuplicateMatch(saved, { ...saved, scoreTeamB: 1 }), false);
assert.equal(
  isDuplicateMatch(saved, {
    ...saved,
    players: saved.players.map((player) =>
      player.playerId === "a" ? { ...player, goals: 2 } : player,
    ),
  }),
  false,
);
assert.equal(
  isDuplicateMatch(saved, {
    ...saved,
    players: saved.players.map((player) => ({
      ...player,
      team: player.team === "TEAM_A" ? "TEAM_B" : "TEAM_A",
    })),
  }),
  false,
);

const vision = buildVisionRequest(Buffer.from("jpeg"));
const imagePart = vision.messages[0].content[1];
assert.equal(vision.model, "claude-sonnet-5-5");
assert.equal(imagePart.type, "image");
assert.equal(imagePart.mediaType, "image/jpeg");
assert.ok(Buffer.isBuffer(imagePart.image));
assert.equal(vision.system, VISION_SYSTEM_PROMPT);
assert.match(vision.system, /HANDLE PARTIAL \/ EMPTY CARDS/);
assert.match(vision.system, /right-side column/);
assert.match(vision.system, /ALLOW MISSING FIELDS/);
assert.match(vision.system, /PLAYER NAME MATCHING & ROSTER RESOLUTION/);
assert.match(vision.system, /exact canonical name from the known roster/);
assert.match(vision.system, /Nova Quinn/);
assert.match(vision.system, /never repeating the raw ambiguous token alone/);
assert.match(vision.system, /matchedAs is "MAYA"/);
assert.match(vision.messages[0].content[0].text, /"matchedAs": "MAYA"/);
assert.match(vision.system, /suggestions/);
assert.match(vision.messages[0].content[0].text, /"suggestions": \["Nova Quinn", "Quinn Adler"\]/);
assert.match(vision.system, /count filled\/shaded circles in the 9-circle row/);
assert.match(vision.system, /CROSSED-OUT MARKS/);
assert.match(vision.system, /Could not read this ref sheet/);
assert.match(vision.system, /all 4 slots\/games/);
assert.match(vision.messages[0].content[0].text, /"score": 2/);
assert.match(vision.messages[0].content[0].text, /Active player roster: none provided/);
const rostered = buildVisionRequest(Buffer.from("jpeg"), undefined, ["Kuba", "Alex Example", "Kuba"]);
assert.match(rostered.messages[0].content[0].text, /Alex Example\nKuba/);
assert.doesNotMatch(rostered.messages[0].content[0].text, /Kuba\nKuba/);
assert.doesNotMatch(vision.system, /was left off/);
assert.deepEqual(parseVisionPayload('To Ta was left off.\n{"games":[]}'), { games: [] });
const visionCards = normalizeVisionCards({
  cards: [
    {
      region: "top-right",
      referees: ["Ruth", "12"],
      teamA: [
        { name: "Ruth", goals: 12, thirtySeconds: 3, oneMinute: true, expulsion: false },
      ],
      teamB: [],
      scoreTeamA: 2,
      scoreTeamB: null,
    },
    {
      region: "bottom-left",
      referees: [],
      teamA: [],
      teamB: [],
      scoreTeamA: null,
      scoreTeamB: null,
    },
    {
      region: "top-left",
      referees: ["Anna", "Ben"],
      teamA: [{ name: "Anna", goals: 3, thirtySeconds: 1, oneMinute: false, expulsion: false }],
      teamB: [{ name: "Dan", goals: 1, thirtySeconds: 0, oneMinute: false, expulsion: true }],
      scoreTeamA: 4,
      scoreTeamB: 2,
    },
  ],
});
assert.deepEqual(
  visionCards.map((card) => card.region),
  ["top-left", "top-right"],
);
assert.equal(visionCards[1]?.sheet.teamA[0]?.goals, 9);
assert.equal(visionCards[1]?.sheet.teamA[0]?.penalties.thirtySeconds, 2);
assert.equal(visionCards[1]?.sheet.teamA[0]?.fouls, 3);
assert.deepEqual(visionCards[1]?.sheet.referees, ["Ruth"]);
assert.deepEqual(visionCards[0]?.sheet.referees, ["Anna", "Ben"]);
assert.equal(visionCards[0]?.sheet.teamB[0]?.fouls, 1);
assert.deepEqual(visionCards[0]?.sheet.notes, []);

const visionGames = normalizeVisionCards(
  {
    games: [
      {
        referees: ["Anna", "12"],
        team1: {
          players: [
            { name: "Anna", goals: 3, penalties: 1 },
            { name: "le Se", goals: 2, penalties: 0 },
            { name: "CU RS CA", goals: 1, penalties: 4 },
          ],
          score: 4,
        },
        team2: {
          players: [{ name: "Dan", goals: 11, penalties: 2 }],
          score: 2,
        },
      },
    ],
  },
  "bottom-left",
);
assert.equal(visionGames.length, 1);
assert.equal(visionGames[0]?.region, "bottom-left");
assert.deepEqual(
  visionGames[0]?.sheet.teamA.map((player) => player.name),
  ["Anna"],
);
assert.equal(visionGames[0]?.sheet.teamA[0]?.fouls, 1);
assert.equal(visionGames[0]?.sheet.teamA[0]?.goals, 3);
assert.equal(visionGames[0]?.sheet.teamB[0]?.name, "Dan");
assert.equal(visionGames[0]?.sheet.teamB[0]?.goals, 9);
assert.equal(visionGames[0]?.sheet.teamB[0]?.fouls, 2);
assert.equal(visionGames[0]?.sheet.scoreTeamA, 4);
assert.equal(visionGames[0]?.sheet.scoreTeamB, 2);
assert.deepEqual(visionGames[0]?.sheet.referees, ["Anna"]);
assert.deepEqual(visionGames[0]?.sheet.notes, []);

const boxedNotSummed = normalizeVisionCards(
  {
    games: [
      {
        referees: ["Anna"],
        team1: {
          players: [
            { name: "Anna", goals: 3, penalties: 0 },
            { name: "Ben", goals: 1, penalties: 0 },
            { name: "GOALS", goals: 2, penalties: 0 },
            { name: "TEAM NAME", goals: 0, penalties: 0 },
          ],
          score: 2,
        },
        team2: {
          players: [{ name: "Dan", goals: 0, penalties: 0 }],
          score: 2,
        },
      },
    ],
  },
  "top-left",
);
assert.equal(boxedNotSummed[0]?.sheet.scoreTeamA, 2);
assert.equal(boxedNotSummed[0]?.sheet.scoreTeamB, 2);
assert.deepEqual(
  boxedNotSummed[0]?.sheet.teamA.map((player) => player.name),
  ["Anna", "Ben"],
);

const missingBox = normalizeVisionCards({
  games: [
    {
      referees: [],
      team1: { players: [{ name: "Anna", goals: 4, penalties: 0 }], score: null },
      team2: { players: [{ name: "Dan", goals: 0, penalties: 0 }], score: null },
    },
  ],
});
assert.equal(missingBox[0]?.sheet.scoreTeamA, null);
assert.equal(missingBox[0]?.sheet.scoreTeamB, null);

const partialColumn = normalizeVisionCards({
  games: [
    {
      referees: [null, ""],
      team1: {
        players: [{ name: "Anna", goals: 2, penalties: null }],
        score: 2,
      },
      team2: { players: [], score: null },
    },
    {
      referees: [],
      team1: {
        players: [{ name: "", goals: null, penalties: null }],
        score: null,
      },
      team2: null,
    },
    null,
    {
      referees: null,
      team1: null,
      team2: null,
    },
  ],
});
assert.deepEqual(
  partialColumn.map((card) => card.region),
  ["top-left"],
);
assert.deepEqual(partialColumn[0]?.sheet.referees, []);
assert.equal(partialColumn[0]?.sheet.teamA[0]?.name, "Anna");
assert.equal(partialColumn[0]?.sheet.scoreTeamA, 2);

const ambiguousSheet = normalizeVisionCards({
  games: [
    {
      referees: [
        { name: null, written: "QUINN", suggestions: ["Nova Quinn", "Quinn Adler"] },
        "Ben",
      ],
      team1: {
        players: [
          {
            name: null,
            written: "QUINN",
            suggestions: ["Nova Quinn", "Quinn Adler"],
            goals: 1,
            penalties: 0,
          },
          { name: "Ben", suggestions: [], goals: 0, penalties: 0 },
        ],
        score: 2,
      },
      team2: {
        players: [{ name: "Anna Lee", suggestions: [], goals: 2, penalties: 0 }],
        score: 1,
      },
    },
    null,
    { referees: [], team1: null, team2: null },
    { referees: null, team1: { players: [], score: null }, team2: null },
  ],
});
assert.deepEqual(
  ambiguousSheet.map((card) => card.region),
  ["top-left"],
);
assert.equal(ambiguousSheet[0]?.sheet.teamA[0]?.name, "QUINN");
assert.deepEqual(ambiguousSheet[0]?.sheet.teamA[0]?.suggestions, ["Nova Quinn", "Quinn Adler"]);
assert.deepEqual(ambiguousSheet[0]?.sheet.teamA[1]?.suggestions, []);
assert.deepEqual(ambiguousSheet[0]?.sheet.referees, ["QUINN", "Ben"]);
const quinnRoster = [
  { id: "nova", name: "Nova Quinn" },
  { id: "adler", name: "Quinn Adler" },
  { id: "ben", name: "Ben" },
  { id: "anna", name: "Anna Lee" },
];
const quinnGame = annotateRefSheet("top-left", ambiguousSheet[0]!.sheet, quinnRoster);
assert.equal(quinnGame.teamA[0]?.playerId, null);
assert.equal(quinnGame.teamA[0]?.name, null);
assert.equal(quinnGame.teamA[0]?.matchedAs, null);
assert.equal(quinnGame.teamA[0]?.confidence, "low");
assert.deepEqual(
  quinnGame.teamA[0]?.suggestions.map((player) => player.name),
  ["Nova Quinn", "Quinn Adler"],
);
assert.equal(quinnGame.teamA[1]?.playerId, "ben");
assert.equal(quinnGame.teamA[1]?.name, "Ben");
assert.equal(quinnGame.teamA[1]?.matchedAs, "Ben");
assert.deepEqual(quinnGame.teamA[1]?.suggestions, []);
assert.equal(quinnGame.teamB[0]?.playerId, "anna");
assert.equal(quinnGame.teamB[0]?.suggestions.length, 0);
assert.equal(quinnGame.referees[0]?.playerId, null);
assert.deepEqual(
  quinnGame.referees[0]?.suggestions.map((player) => player.name),
  ["Nova Quinn", "Quinn Adler"],
);
assert.equal(quinnGame.referees[1]?.playerId, "ben");

const mayaSheet = normalizeVisionCards({
  games: [
    {
      referees: [],
      team1: {
        players: [
          {
            name: "Maya Ortiz",
            written: "MAYA",
            matchedAs: "MAYA",
            suggestions: [],
            goals: 2,
            penalties: 0,
          },
        ],
        score: 2,
      },
      team2: { players: [], score: null },
    },
  ],
});
const mayaGame = annotateRefSheet("top-left", mayaSheet[0]!.sheet, [
  { id: "maya", name: "Maya Ortiz" },
]);
assert.equal(mayaGame.teamA[0]?.name, "Maya Ortiz");
assert.equal(mayaGame.teamA[0]?.matchedAs, "MAYA");
assert.equal(mayaGame.teamA[0]?.playerId, "maya");
assert.deepEqual(mayaGame.teamA[0]?.suggestions, []);

const rawTokenOnly = normalizeVisionCards({
  games: [
    {
      referees: [{ name: null, written: "QUINN", suggestions: ["QUINN"] }],
      team1: {
        players: [
          { name: null, written: "QUINN", suggestions: ["QUINN"], goals: 1, penalties: 0 },
        ],
        score: 1,
      },
      team2: { players: [], score: null },
    },
  ],
});
const expandedQuinn = annotateRefSheet("top-left", rawTokenOnly[0]!.sheet, quinnRoster);
assert.deepEqual(
  expandedQuinn.teamA[0]?.suggestions.map((player) => player.name),
  ["Nova Quinn", "Quinn Adler"],
);
assert.equal(
  expandedQuinn.teamA[0]?.suggestions.some((player) => player.name === "QUINN"),
  false,
);
assert.deepEqual(
  expandedQuinn.referees[0]?.suggestions.map((player) => player.name),
  ["Nova Quinn", "Quinn Adler"],
);
const withExactQuinn = annotateRefSheet("top-left", rawTokenOnly[0]!.sheet, [
  { id: "quinn", name: "Quinn" },
  ...quinnRoster,
]);
assert.equal(withExactQuinn.teamA[0]?.name, null);
assert.equal(withExactQuinn.teamA[0]?.playerId, null);
assert.equal(withExactQuinn.teamA[0]?.matchedAs, null);
assert.deepEqual(
  withExactQuinn.teamA[0]?.suggestions.map((player) => player.name),
  ["Nova Quinn", "Quinn Adler"],
);

assert.equal(imageTypeForUpload({ type: "image/heic", name: "sheet.HEIC" }), "image/heic");
assert.equal(imageTypeForUpload({ type: "image/heif", name: "sheet.heif" }), "image/heif");
assert.equal(imageTypeForUpload({ type: "", name: "sheet.HEIC" }), "image/heic");
assert.equal(
  imageTypeForUpload({ type: "application/octet-stream", name: "a.heif" }),
  "image/heif",
);
assert.equal(imageTypeForUpload({ type: "image/png", name: "a.png" }), "image/png");
assert.equal(imageTypeForUpload({ type: "image/jpeg", name: "a.jpg" }), "image/jpeg");
assert.equal(imageTypeForUpload({ type: "text/plain", name: "a.heic" }), null);

async function checkJpegConversion(): Promise<void> {
  const png = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "#ffffff" },
  })
    .png()
    .toBuffer();
  const jpeg = await bufferToJpeg(png, "image/png");
  assert.equal(jpeg[0], 0xff);
  assert.equal(jpeg[1], 0xd8);

  const width = 400;
  const height = 300;
  const pixels = Buffer.alloc(width * height * 3, 30);
  const gutterX0 = 180;
  const gutterX1 = 220;
  const gutterY0 = 130;
  const gutterY1 = 170;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((x >= gutterX0 && x < gutterX1) || (y >= gutterY0 && y < gutterY1)) {
        const offset = (y * width + x) * 3;
        pixels[offset] = 255;
        pixels[offset + 1] = 255;
        pixels[offset + 2] = 255;
      }
    }
  }

  const sheet = await sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg().toBuffer();
  const crops = await cropRefSheetQuadrants(sheet);
  assert.ok(crops);
  assert.deepEqual(
    crops.map((crop) => crop.region),
    ["top-left", "bottom-left", "top-right", "bottom-right"],
  );

  const solid = await sharp({
    create: { width: 400, height: 300, channels: 3, background: "#222222" },
  })
    .jpeg()
    .toBuffer();
  assert.equal(await cropRefSheetQuadrants(solid), null);

  const template = readFileSync(new URL("../public/ref-sheet-template.jpg", import.meta.url));
  const templateCrops = await cropRefSheetQuadrants(template);
  assert.ok(templateCrops);
  assert.deepEqual(
    templateCrops.map((crop) => crop.region),
    ["top-left", "bottom-left", "top-right", "bottom-right"],
  );
  assert.equal(await cropRefSheetQuadrants(templateCrops[0].jpeg), null);
}

checkJpegConversion()
  .then(() => {
    console.log("ref sheet parser ok");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
