# Sraz Multiplayer

Srazique multiplayer mode.

___Must be identical to desktop app!!!___

## How to play

- Each turn, move a peg to an adjacent tile and answer a question matching that tile's category.
- **Combat** — move onto an enemy peg to attack. Answer Q1 to win; Q2 to rank up your peg. Higher rank also wins combat even if Q2 is missed.
- **Flag tiles** — answer 3 questions correctly to capture a corner flag. Capture all flags to win.
- **Ranks** — Kmet → Vojnik → Vitez. Threshold: 3 correct answers on small boards (≤8), 5 on large.

## Stack

- **Server** — Node.js (ESM), Express, Socket.io
- **Client** — Single-page vanilla JS + HTML/CSS, served as static files

## Development

Install dependencies and start both server and client with hot reload:

```sh
npm install
npm run dev
```

The server runs on port 3000 and the client is a static `index.html` — open it directly in a browser or serve it from any static file server pointing at `client/`.

## Production (Docker)

```sh
docker compose up -d
```

The server binds to `127.0.0.1:3001` and expects a reverse proxy (e.g. nginx) to handle TLS and forward traffic to it. The client `index.html` must be served separately (e.g. as a static site) and will connect to the server via WebSocket.

The encrypted question bank (`questions.enc`) is mounted read-only into the container.

## Linting

```sh
npm run lint        # check
npm run lint:fix    # auto-fix
```

ESLint covers both the Node.js server (`server/**/*.js`) and the inline browser script in the client HTML (`client/**/*.html`).

## Settings

| Setting | Options | Default |
|---|---|---|
| Players | 2 / 3 / 4 | 4 |
| Board size | 5×5 / 7×7 / 9×9 | 7×7 |
| Question timer | 15s / 30s / 45s | 30s |
| Start as Vitez | on / off | off |
| Categories | any subset of 10 | all |
