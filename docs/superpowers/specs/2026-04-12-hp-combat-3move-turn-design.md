# Design: HP-Based Combat & 3-Move Turn System

**Date:** 2026-04-12  
**Status:** Approved  

## Overview

Replace the rank/extra-moves system with a simpler HP-based model. Every peg starts with 3 HP. Combat is a question streak — each correct answer deals 1 damage, first miss ends the fight. Each player gets 3 move tokens per turn to spend freely across any of their pegs.

## Section 1 — Peg Data Model

**Remove** from peg object:
- `rank` (was 0/1/2 — Kmet/Vojnik/Vitez)
- `correct` (was correct-answer counter toward rank-up)

**Add** to peg object:
- `hp: 3` — set at game creation, never increases, 0 = eliminated

**Delete** from `engine.js`:
- `getRankUpThreshold()`
- `rankUp()`
- `rankDown()`
- `pushPegAway()`
- `RANK_NAMES`, `RANK_BADGE` (client)

**Remove** from `createGame` settings:
- `maxRankStart` option (obsolete)

Peg object shape:
```js
{ id, playerId, row, col, hp }
```

## Section 2 — Turn Move Pool

`movesRemaining` becomes a per-turn pool of **3**, reset at the start of every player's turn in `resetTurnState`. It is no longer derived from peg rank.

Rules:
- Each answer attempt on a **normal move** costs 1 token (regardless of correct/wrong)
- Initiating **combat** costs all remaining tokens — turn always ends after combat
- When `movesRemaining` reaches 0, turn advances automatically
- **Any** peg belonging to the current player can be moved at any point during the turn — the `pegsToMove` per-peg restriction is removed

`selectPeg` no longer sets `movesRemaining` (it is set once per turn in `resetTurnState`).

## Section 3 — Combat Resolution

### Planning
`planTurnQuestions` for `moveType === 'combat'` pre-selects **3 question IDs** (matching max defender HP).

### Resolution in `applyTurn`
Process submitted answers sequentially:

```
for each answer submitted:
  if correct → defPeg.hp--; emit combat_hit { defPegId, hp }
  if wrong   → stop processing; combat ends
  if defPeg.hp === 0 → eliminate defender; attacker moves in; emit peg_eliminated + peg_moved; break
```

- **Attacker misses before HP reaches 0:** defender survives with reduced HP, attacker stays put
- **Defender reaches 0 HP:** eliminated, attacker moves into tile
- **Either outcome:** turn ends, remaining move tokens consumed

### Events
| Event | When |
|---|---|
| `combat_hit` | Each correct answer; includes `defPegId`, remaining `hp` |
| `peg_eliminated` | Defender HP reaches 0 |
| `peg_moved` | Attacker moves into tile after elimination |

### Removed behavior
- No `rankDown` on defender
- No `pushPegAway` — defender never moves on a lost combat
- No `peg_pushed` or `rank_down` events

## Section 4 — Client Changes

### Remove
- `RANK_NAMES`, `RANK_BADGE` constants
- `rankUpPegs`, `rankDownPegs` sets and all usages
- `rank-up`, `rank-down` CSS keyframe animations
- `.peg-rank-badge` DOM element and CSS
- `btn-max-rank` setup button
- `peg.rank` from tooltip and tile rendering logic
- "Ranks" section from help text

### Add
- HP indicator on each peg (e.g. small text showing `3`, `2`, `1`)
- `combat_hit` socket event handler — updates defender's displayed HP in real time
- Combat label: `⚔ COMBAT (Q1/3)`, `(Q2/3)`, `(Q3/3)` — stops early on miss

### Change
- Turn UI: show move token pool counting down (`3 moves left`, `2 moves left`, …)
- Peg tooltip: `{player name} — HP: {hp}` instead of rank name
- Peg selection: any peg selectable at any point during turn (remove `pegsToMove` guard on client)
- Help text: describe HP system and 3-move turn pool

## Section 5 — Tests

### Remove
- All assertions on `peg.rank`, `peg.correct`, `maxRankStart`
- All assertions on `peg_pushed`, `rank_down` events
- `pushPegAway` behavior tests

### Update
- Normal move tests: `movesRemaining` starts at 3, decrements on each attempt
- Combat tests: defender HP decrements per correct answer, eliminated at 0

### Add
| Scenario | Expected outcome |
|---|---|
| Attacker misses Q1 | Combat ends, defender HP unchanged, turn ends |
| Attacker hits Q1+Q2, misses Q3 | Defender at 1 HP, survives, attacker stays, turn ends |
| Attacker hits Q1+Q2+Q3 | Defender eliminated, attacker moves in, turn ends |
| Player spends all 3 tokens on normal moves | Turn advances |
| Player moves same peg 3 times | Allowed — no per-peg restriction |
