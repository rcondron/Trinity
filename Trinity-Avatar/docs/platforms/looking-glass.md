# Looking Glass (light-field / "hologram cube")

`?platform=lookingglass&cols=8&rows=6&cone=35`

Looking Glass displays consume **quilts**: a grid of renders sweeping a
horizontal parallax cone. This platform renders a live quilt of the avatar —
in the browser that grid itself is the simulator; on a device it's the frame
you feed the driver.

## Per-device quilt settings

| Device | cols × rows | cone |
|---|---|---|
| Go / Portrait | 8 × 6 (48 views) | 35–40° |
| 16" / 32" | 8 × 9 … 11 × 6 | 40–50° |

Set via URL params (`cols`, `rows`, `cone`) — they're also live-tunable from
the platform settings.

## Driving a real device

Two supported routes:

1. **Looking Glass Bridge** (recommended): run [Bridge](https://lookingglassfactory.com/software/looking-glass-bridge),
   cast the browser window showing the quilt; Bridge handles the lenticular
   swizzle for your calibration.
2. **@lookingglass/webxr polyfill**: add the
   [Looking Glass WebXR library](https://github.com/Looking-Glass/looking-glass-webxr)
   and enter the `vr` platform — the polyfill presents it on the display.
   We render quilts natively instead by default to avoid pinning their
   library version, but nothing prevents loading it alongside.

The quilt is standard: bottom-left view = leftmost camera, row-major upward.
Screenshot the canvas and any Looking Glass quilt viewer will accept it.
