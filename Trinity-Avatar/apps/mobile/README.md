# Trinity Avatar — Mobile (Capacitor)

Native iOS/Android wrapper around the web app. The web build is the UI; the
mic uses the platform's speech recognition through the WebView.

## Build

```bash
cd Trinity-Avatar
pnpm --filter @trinity-avatar/web build          # produces apps/web/dist
cd apps/mobile
pnpm add:android    # once — generates android/ (needs Android Studio)
pnpm add:ios        # once — generates ios/ (needs Xcode, macOS)
pnpm sync           # copy the web build into the native projects
pnpm open:android   # or open:ios — then run from the IDE
```

## Pointing at your services

On a device, `localhost` is the phone itself. Open Settings (⚙ in the app)
and set the orchestrator/motion URLs to your machine's LAN address, e.g.
`ws://192.168.1.20:8790/session` — or run the services on a host the phone
can reach. Values persist in localStorage.

For live-reload dev, add to `capacitor.config.json`:

```json
"server": { "url": "http://YOUR_LAN_IP:5173", "cleartext": true }
```

## Permissions

Microphone permission is requested by the WebView on first mic use.
On iOS add `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription`
to `ios/App/App/Info.plist` (Capacitor scaffolds sensible defaults).

Generated `android/` and `ios/` directories are intentionally gitignored;
they are reproducible via `cap add`.
