# Trinity Desktop Overlay

The avatar walks around on your screen: a transparent, frameless,
always-on-top, click-through Electron window running the web app in
`?platform=overlay` mode.

## First-time setup

pnpm blocks dependency build scripts by default, so Electron's binary isn't
downloaded automatically. Approve it once:

```bash
cd Trinity-Avatar
pnpm approve-builds   # select "electron"
pnpm install
```

## Run (dev)

```bash
# terminal 1 — web app + orchestrator
cd Trinity-Avatar && pnpm dev

# terminal 2 — the overlay shell
pnpm --filter @trinity-avatar/desktop-overlay start
```

## Run against a build

```bash
pnpm --filter @trinity-avatar/web build
pnpm --filter @trinity-avatar/desktop-overlay start:built
```

## Controls

| Action | How |
|---|---|
| Talk to Trinity (mic/chat) | Tray → "Make interactive", or `Ctrl/Cmd+Shift+T` |
| Back to click-through | Same toggle |
| Quit | Tray → Quit |

While click-through, every mouse event passes to the windows underneath —
the avatar is pure ambience, pacing along the bottom of your display.
Voice conversations still work in interactive mode; barge-in included.
