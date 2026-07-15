# Desktop overlay — the avatar walks on your screen

See [apps/desktop-overlay/README.md](../../apps/desktop-overlay/README.md)
for the Electron shell (transparent, always-on-top, click-through window).

`?platform=overlay` is also loadable in a plain browser for development: it
renders the avatar bottom-anchored on a transparent page, auto-pacing, with
the camera gently following.

Behavior in overlay mode:

- environment/grid hidden, page fully transparent, orbit controls off;
- locomotion defaults to `pace` — the brain can still change it
  ("stand still", "walk around");
- HUD reduced to caption + mic + chat; toggle interactivity via the tray or
  `Ctrl/Cmd+Shift+T` to talk to it, then let it go ambient again.
