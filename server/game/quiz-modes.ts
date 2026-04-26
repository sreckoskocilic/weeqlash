// Quiz mode definitions. To add a new mode:
// 1. Add an entry here.
// 2. Add a matching entry to QUIZ_MODES in client/index.html.
// categories: null = all questions; array of category keys = filtered pool.

export interface QuizMode {
  id: string;
  label: string;
  categories: string[] | null;
  table: string;
}

export const QUIZ_MODES: QuizMode[] = [
  {
    id: 'triviandom',
    label: 'Triviandom',
    categories: null,
    table: 'leaderboard',
  },
];

export const QUIZ_MODES_BY_ID: Record<string, QuizMode> = Object.fromEntries(
  QUIZ_MODES.map((m) => [m.id, m]),
);
