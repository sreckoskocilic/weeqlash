# Weeqlash Multiplayer

A multiplayer brawliseum whilst seeking for wisdom and knowledge.

To win some answers find you must!!!

Never overrandom, juxtaposers outh!!!

Play at **https://brawl.weeqlash.icu** — create an account or banish yourself to nothingness, learn your 0s.

## Getting In

- Open the site. The landing screen is split: **Brawl** setup on the left, **Triviandom / Qlashique** on the right.
- **Register** an account (email + password) or **log in** from the top-left tabs. An account is needed to land on leaderboards; anonymous play works for casual rounds.
- To play with friends: whoever creates the game shares the **5-character room code** — the other side pastes it into the matching `Join game` box for that mode.

There are three modes. Pick your poison.

---

## 1. Weeqlash Brawl — the main event

Deploy your pegs across a board of knowledge tiles. Answer trivia. Crush your opponents with the sheer brute force of knowing things they don't. Every tile has a category. Every move demands an answer. Every wrong answer is a small gift you hand your enemy with both trembling hands.

### Setup

- **Board size**: 4×4, 5×5, 6×6, 7×7, 8×8 (default) or 10×10.
- **Question timer** (under `Settings`): 15 / 30 / 45 seconds per question.
- **Categories** (under `Settings`): toggle any subset of categories on or off before creating the room.
- Hit **Create game** → a 5-char room code appears in the lobby. Share it. Wait for humans.

### Turn Structure

Each turn grants you a **pool of 3 moves** — spend them however you like across your pegs. Advance, flank, sacrifice, overcorrect. The board doesn't care about your feelings.

- Move a peg to an adjacent tile → answer a question in that tile's category
- Answer correctly → hold the tile, keep the momentum, feel briefly invincible
- Answer wrong → move wasted, dignity optional

### Combat

Walk a peg onto an enemy-occupied tile and the gloves come off. You get up to **3 questions**.

- Each correct answer deals **1 HP damage** to the defender
- First miss ends the fight — your peg stays put, their peg keeps whatever HP it had left. Both parties go home disappointed
- Drain the defender to **0 HP** to eliminate them and claim their tile
- Combat always burns your remaining move tokens. Choose your battles

Each peg starts with **3 HP** and never heals. Lose all three and the peg is gone. Permanently. Pour one out.

### Capture the Flags

Four corners. Four flags. One throne.

- Each corner flag needs **3 correct answers** to capture
- Capture all four → you win, your legacy is secured, your enemies are invited to reflect

---

## 2. Qlashique — 1v1 trivia duel ⚔

A head-to-head knife fight over a single question queue. No board, no pegs, no mercy. Each duelist starts with **30 HP**. First to 0 is dust.

### Before the bell

- Either player clicks **⚔ QLASHIQUE** to open a room and shares the code; the other pastes it into the `Qlashique` join input. Game starts as soon as both players are in.

### How a turn works

You get a batch of questions under a timer that **starts at 5 seconds and grows by 3 each turn** (cap 25). Your running **score** for the turn goes up +1 per correct answer and down −1 per miss. When you end the turn:

| Score | What happens                                                  |
| ----- | ------------------------------------------------------------- |
| `< 0` | **Self-damage** — you take `abs(score)` HP. Humbling.         |
| `= 0` | Nothing happens. Next duelist's turn.                         |
| `= 1` | **Automatic attack** for 1 damage.                            |
| `≥ 2` | **Choose**: `attack` (deal `score` damage) or `heal` (+2 HP). |

### Instant win

Clear **10+ correct answers in a single turn with zero misses** (perfect streak ≥ 10) and you win on the spot. Flawless victory. Insufferable bragging rights.

---

## 3. Triviandom — solo arena

_No opponents? No problem. Just you, your clicking finger, and the void._

Triviandom is the single-player arena for those who have no one to blame but themselves. Answer as many questions as you can, as fast as you can. Your score and your time both go on the board — under **DEM QWIZZACKS**, where the real ones live.

Hunt for that second digit. You know the one.

- **Start Triviandom** — the full question pool.

The leaderboard is visible from the landing screen via `Show Triviandom Leaderboard`.

---

## Screenshots

![Board 5x5](screenshots/board.png)
![Correct Answer](screenshots/question.png)
![Wrong Answer](screenshots/answer.png)
