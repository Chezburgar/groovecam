# GrooveCam 🕺

Turn any song into a dance game — right in your browser.

**Play it:** upload an MP3/WAV/OGG, GrooveCam analyzes the beat and energy of the track, generates a choreography chart timed to the music, then uses your **webcam + pose detection** to score every move you hit.

## How it works

- **Audio analysis** (`js/analyzer.js`): decodes the song with the Web Audio API, computes an onset-strength envelope, estimates BPM via autocorrelation with a tempo prior, locks the beat phase, and rank-normalizes local energy per beat.
- **Choreography** (`js/choreo.js`): a seeded generator places moves on the beat grid — chill moves in quiet sections, hype moves in the chorus. Same song + difficulty = same dance.
- **Pose scoring** (`js/pose.js`, `js/moves.js`): [MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) runs in-browser on your camera feed. Each move is a geometric detector over the landmarks (e.g. "both wrists above head") returning a 0–1 confidence, graded PERFECT / GREAT / OK / MISS.
- **Privacy**: nothing leaves your machine. Audio decoding, beat detection, and camera inference all run locally.

## Run locally

Any static server works (ES modules need http, not `file://`):

```sh
npx http-server -p 8123
# or
python -m http.server 8123
```

Then open http://localhost:8123. Camera access requires `localhost` or HTTPS.

## Deploy

It's a plain static site — push to GitHub and enable GitHub Pages on the repo root.
