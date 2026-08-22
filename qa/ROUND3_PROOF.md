# Round 3 proof — 2026-08-22

All browser checks below used this worktree's freshly built `dist/` on the
isolated server at `http://127.0.0.1:8617/?debug=1`.

## Media inspection

`ffprobe -v error -show_entries stream=width,height,display_aspect_ratio -show_entries format=duration,size -of json` produced:

| File | Pixels | Ratio | Duration | Bytes | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| `marketing/cover-16x9.png` | 1920x1080 | 16:9 | still | 521,554 | pass |
| `marketing/cover-2x3.png` | 800x1200 | 2:3 | still | 265,470 | pass |
| `marketing/cover-1x1.png` | 800x800 | 1:1 | still | 252,741 | pass |
| `marketing/video-landscape.mp4` | 1920x1080 | 16:9 | 15.700s | 7,122,558 | pass |
| `marketing/video-portrait.mp4` | 800x1200 | 2:3 | 15.700s | 4,335,866 | pass |

Both MP4s contain one H.264 video stream and no audio stream. They are built
from a fresh clean gameplay recording: the matching cover is held for 0.7s,
then the video cuts to gameplay. Frame samples at 0.1s and 1.2s were visually
checked for cover then gameplay, with no menu, black frame, cursor, or game-over
screen in the trimmed reel.

## Fresh visual proof

- `qa/round3/907x510-menu.png` and `qa/round3/907x510-gameplay.png`
- `qa/round3/1920x1080-menu.png` and `qa/round3/1920x1080-gameplay.png`
- `qa/round3/390x844-menu.png` and `qa/round3/390x844-gameplay.png`

The gameplay captures show the first-run visual WASD/ZQSD / arrow / swipe
card. It dismisses and is persisted after the first successful steer; the
media recorder performs that steer before its usable gameplay segment.
