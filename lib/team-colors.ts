export interface TeamTone {
  dot: string;
  text: string;
  onDark: string;
}

export const teamA: TeamTone = {
  dot: "bg-red-500",
  text: "text-red-600 dark:text-red-400",
  onDark: "text-red-400",
};

export const teamB: TeamTone = {
  dot: "bg-blue-500",
  text: "text-blue-600 dark:text-blue-400",
  onDark: "text-blue-400",
};
