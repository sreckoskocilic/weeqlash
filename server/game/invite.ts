import { getRoom } from './rooms.ts';
import { getChallengeByCode, getUsernameById } from './howhigh-store.ts';

type InviteGame = 'brawl' | 'qlashique' | 'qlashword' | 'howhigh';

export interface Invite {
  game: InviteGame;
  host: string;
  title: string;
  description: string;
}

const GAME_NAMES: Record<InviteGame, string> = {
  brawl: 'Weeqlash Brawl',
  qlashique: 'Qlashique',
  qlashword: 'Qlashword',
  howhigh: 'HowHigh?',
};

function invite(game: InviteGame, host: string, description: string): Invite {
  return { game, host, title: `${host} invites you to ${GAME_NAMES[game]}`, description };
}

export function findInvite(code: string): Invite | null {
  const room = getRoom(code);
  if (room) {
    if (room.started || room.players.length >= room.settings.playerCount) {
      return null;
    }
    const game = room.mode === 'qlashique' || room.mode === 'qlashword' ? room.mode : 'brawl';
    const host = room.players[0]?.name || 'A friend';
    return invite(game, host, `Room ${room.code} is waiting for you. Open the link and hit JOIN.`);
  }
  const challenge = /^[A-Z0-9]{5}$/i.test(code)
    ? getChallengeByCode(code.toUpperCase())
    : undefined;
  if (challenge?.status === 'waiting') {
    const host = getUsernameById(challenge.player1_id) || 'A friend';
    return invite(
      'howhigh',
      host,
      `Score to beat: ${challenge.p1_score}. Same 10 questions, same dice. Open the link and hit JOIN.`,
    );
  }
  return null;
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

function setMeta(html: string, attr: string, key: string, value: string): string {
  const re = new RegExp(`(<meta\\s+${attr}="${key}"\\s+content=")[^"]*(")`);
  // Replacer function: a `$` in a player name must not act as a replacement pattern.
  return html.replace(re, (_m, open: string, close: string) => open + escapeHtml(value) + close);
}

export function withInviteMeta(html: string, inv: Invite): string {
  let out = setMeta(html, 'property', 'og:title', inv.title);
  out = setMeta(out, 'property', 'og:description', inv.description);
  out = setMeta(out, 'name', 'twitter:title', inv.title);
  out = setMeta(out, 'name', 'twitter:description', inv.description);
  const tags =
    `<meta name="wq-invite-game" content="${inv.game}" />\n` +
    `    <meta name="wq-invite-host" content="${escapeHtml(inv.host)}" />\n  </head>`;
  return out.replace('</head>', () => tags);
}
