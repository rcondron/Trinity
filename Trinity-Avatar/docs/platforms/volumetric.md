# Volumetric / persistence-of-vision displays (experimental)

`?platform=volumetric` — spinning-arm displays, LED POV fans, Voxon-style
swept-volume hardware. **Best-effort adapter**: it ships working in a
browser simulator; real hardware integration will need device-specific glue.

## Modes

| URL | What you get |
|---|---|
| `?platform=volumetric` | POV **simulator**: slices cycle at `rpm`, approximating the spinning display |
| `?platform=volumetric&view=grid` | All slices tiled — the hardware-facing frame layout |
| `…&sink=ws://host:port` | Streams JPEG slice frames to your WebSocket receiver (NDI-style hand-off) |

## Calibration knobs (URL params / platform settings)

| Knob | Default | Meaning |
|---|---|---|
| `slices` | 24 | Camera azimuths per revolution. Match your display's slices-per-rev. More = smoother, heavier. |
| `rpm` | 900 | Virtual rotation speed. Match the physical rotor so slice N renders when the arm is at N/slices of a turn. |
| `size` | 256 | Sink frame resolution (px). |
| `brightness` | 1 | Multiply into your LED gamma pipeline. |

**Rotation sync**: hardware should treat slice index `k` as azimuth
`k/slices × 360°`, zero at the camera's +Z. Feed your rotor's index pulse to
pick the slice, or run the sink receiver as the clock master and let the
display free-run at the same rpm.

## True voxel displays

For swept-volume devices wanting voxels rather than slices: render the same
`slices` grid and back-project each pixel by its known azimuth — a
render-to-3D-texture pass is a straightforward extension of the grid mode
(the cameras already form a cylindrical capture rig).
