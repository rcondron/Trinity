# Trinity Avatar — Android / iOS (Capacitor)

Native app wrapper. On the phone you get: **Trinity standing in an empty
space, voice-first** — tap the mic, talk, she talks back. Speech recognition
and speech synthesis run through native Android services (Android WebViews
don't ship the Web Speech API), wired via:

- `@capacitor-community/speech-recognition` — mic → text
- `@capacitor-community/text-to-speech` — her voice when no ElevenLabs key

The `android/` project is **committed and ready to build** (mic permissions,
cleartext LAN networking, and speech-service visibility already configured).

## Get the APK (no Android Studio needed)

The `android-apk` GitHub Actions workflow builds a sideloadable debug APK on
every push (or run it manually from the Actions tab) → download the
`trinity-avatar-debug-apk` artifact.

Install on the phone (e.g. HTC U23 Pro):

1. Copy `app-debug.apk` to the phone (USB, Drive, etc.) and open it —
   allow "install unknown apps" when prompted. Or via adb:
   `adb install app-debug.apk`.
2. First mic tap → grant the microphone permission.

## Build locally instead

```bash
cd Trinity-Avatar
pnpm install
./scripts/setup_avatar.sh                 # optional: bundle the CC0 VRM
pnpm --filter @trinity-avatar/web build
cd apps/mobile
pnpm exec cap sync android
cd android && ./gradlew assembleDebug     # needs Android SDK 34
# → app/build/outputs/apk/debug/app-debug.apk
```

Or open `apps/mobile/android/` in Android Studio and press Run.

## Modes on the phone

- **Out of the box (no setup)**: fully standalone — the avatar stands in
  empty space, listens via native speech recognition, and the on-device
  fallback persona answers through native TTS. Status pills mark
  everything as fallback.
- **Full Trinity**: run the services on your PC and point the app at them —
  ⚙ Settings →
  - Orchestrator: `ws://<your-PC-LAN-IP>:8790/session`
  - Motion: `ws://<your-PC-LAN-IP>:8791/ws`

  With the Trinity Bridge running on the PC, the phone avatar talks to your
  actual Trinity agent ("she does everything in the background"); add an
  ElevenLabs key on the PC for her real voice + timestamped lip sync.
  Phone and PC must share a network; URLs persist on the phone.

## Photoreal avatar on the phone

Create a full-body avatar from a selfie at readyplayer.me, then in the app:
⚙ Settings → **Avatar URL** → paste
`https://models.readyplayer.me/<your-id>.glb?morphTargets=ARKit` → Save.
No rebuild needed; the phone downloads it straight from their CDN
(see docs/avatar-customization.md).

## UI notes

- Big mic button: tap = open mic (continuous), hold = push-to-talk.
- ⌨ button shows the text box if you'd rather type.
- `?env=stage` in a browser restores the grid/stage look; the app defaults
  to the clean empty-space environment.

## iOS

`pnpm add:ios && pnpm sync` on macOS (needs Xcode). Add
`NSMicrophoneUsageDescription` + `NSSpeechRecognitionUsageDescription` to
`Info.plist`. The generated `ios/` directory is not committed.
