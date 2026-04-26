// Quiz mode definitions. Source of truth for the mode list.
// To add a new mode:
// 1. Add an entry here (and a matching client-side entry where needed).
// 2. On next server start, initDb() seeds it into the game_modes table.
// categories: null = pulls from caller's active set; array = static filtered pool.

export interface QuizMode {
  id: string;
  label: string;
  categories: string[] | null;
  // Derived: stable Set ref used by pickRandomQuestion's enabled-pool cache.
  // null when the mode pulls from the global active-cats set instead.
  categoriesSet: Set<string> | null;
}

interface QuizModeInput {
  id: string;
  label: string;
  categories: string[] | null;
}

const _MODES: QuizModeInput[] = [
  { id: 'triviandom', label: 'Triviandom', categories: null },
  { id: 'skipnot', label: 'SkipNoT', categories: null },
];

export const QUIZ_MODES: QuizMode[] = _MODES.map((m) => ({
  ...m,
  categoriesSet: m.categories ? new Set(m.categories) : null,
}));

export const QUIZ_MODES_BY_ID: Record<string, QuizMode> = Object.fromEntries(
  QUIZ_MODES.map((m) => [m.id, m]),
);
