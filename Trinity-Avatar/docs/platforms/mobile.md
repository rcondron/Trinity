# Mobile

## Browser (zero install)

The web app is responsive and touch-friendly: open the dev server (or your
deployment) from any modern mobile browser. iOS Safari and Android Chrome
both support the Web Speech + Web Audio paths; the first mic tap unlocks
audio playback (autoplay policy).

## Native app (Capacitor)

See [apps/mobile/README.md](../../apps/mobile/README.md) — a Capacitor
wrapper around the web build (`cap add android|ios`, `cap sync`). Remember
to point the orchestrator/motion URLs at a LAN host in Settings; `localhost`
on a phone is the phone.
