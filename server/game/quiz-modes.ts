// Source of truth for quiz modes; initDb() seeds new entries into game_modes. categories: null = caller's active set, array = static pool.

export interface QuizMode {
  id: string;
  label: string;
  categories: string[] | null;
  // Derived stable Set ref for pickRandomQuestion's enabled-pool cache; null = pulls from global active-cats.
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
  { id: 'howhigh', label: 'HowHigh?', categories: null },
  // Procedurally generated math/calculus quiz — no question-bank categories.
  { id: 'mathquiz', label: 'MathQ', categories: [] },
  // CentoGrapher — single-question geography "select all related to the country".
  { id: 'centographer', label: 'CentoGrapher', categories: [] },
];

export const QUIZ_MODES: QuizMode[] = _MODES.map((m) => ({
  ...m,
  categoriesSet: m.categories ? new Set(m.categories) : null,
}));

export const QUIZ_MODES_BY_ID: Record<string, QuizMode> = Object.fromEntries(
  QUIZ_MODES.map((m) => [m.id, m]),
);
