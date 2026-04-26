// Quiz mode definitions. Source of truth for the mode list.
// To add a new mode:
// 1. Add an entry here (and a matching client-side entry where needed).
// 2. On next server start, initDb() seeds it into the game_modes table.
// categories: null = pulls from caller's active set; array = static filtered pool.

export interface QuizMode {
  id: string;
  label: string;
  categories: string[] | null;
}

export const QUIZ_MODES: QuizMode[] = [
  {
    id: 'triviandom',
    label: 'Triviandom',
    categories: null,
  },
  {
    id: 'skipnot',
    label: 'SkipNoT',
    categories: null,
  },
];

export const QUIZ_MODES_BY_ID: Record<string, QuizMode> = Object.fromEntries(
  QUIZ_MODES.map((m) => [m.id, m]),
);
