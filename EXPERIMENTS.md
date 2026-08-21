# Experimental ideas (MediaPipe-powered)

Proposals for this branch. Status: [ ] proposed · [~] in progress · [x] done · [✗] tried & rejected

## A. [✗] Hologram backdrop (Image Segmenter) — wow 5/5, effort 3/5
> Tried on 2026-08-21, rejected: cutout quality not convincing. Commit dropped.
Replace the dimmed webcam with a real hologram of you: selfie segmentation
cuts your silhouette out of the frame, rendered to a canvas with a cyan
scanline/glow shader on the dark grid. The room disappears, *you* become
part of the HUD.

## B. [ ] Head parallax depth (Face Landmarker) — wow 4/5, effort 2/5
Track the head position and shift windows a few px against head movement,
scaled by a per-window depth factor. Instantly makes the desktop feel like
a volume floating behind the glass. Runs fine alongside hand tracking.

## C. [ ] Semantic gestures (Gesture Recognizer) — wow 4/5, effort 3/5
Swap the raw HandLandmarker for MediaPipe's GestureRecognizer (same 21
landmarks + built-in gesture classes) and map:
- ✊ closed fist over a window → minimize it to a dock chip
- 🖐 open palm hold (~700 ms) → radial context menu around the cursor
  (close / minimize / send to HOLO)
- 👍 / 👎 → confirm / cancel (e.g. before the agent deletes a file)
- ✌️ victory → snapshot of the workspace layout

## D. [ ] Point-and-talk fusion (existing tracking + agent) — wow 4/5, effort 1/5
Send the file window currently under your cursor to the agent as context
("the user is pointing at reactor_notes.md"). Then "HOLO, close this",
"summarize this", "delete it" just work. Cheapest big win on the list.

## E. [ ] Air writing (existing tracking) — wow 4/5, effort 3/5
Index-finger trails rendered as glowing strokes on a whiteboard window;
clear with a clap-over-it. Bonus: feed the strokes' bounding boxes to the
agent as a note ("save my sketch as sketch.png" via canvas export).

## F. [ ] Throw physics (existing tracking) — wow 3/5, effort 2/5
Windows keep momentum when released mid-drag, with friction and soft edge
bounces. The release velocity is already available in the One-Euro state.

## G. [ ] Two-hand rotate (existing tracking) — wow 3/5, effort 2/5
While both hands pinch a window, follow the angle between the hands to
rotate it (CSS rotate3d), in addition to the current distance-resize.

## H. [ ] Presence lock (Face Detector) — wow 3/5, effort 2/5
No face in front of the camera for N seconds → blur all windows behind a
"STANDBY" shield; unlock instantly when you come back. (Optionally a
"welcome back" TTS line later.)

## I. [ ] Depth push/pull (hand world landmarks) — wow 3/5, effort 4/5
Use 3D world landmarks to detect the hand moving toward/away from the
camera while pinching: push a window "into the distance" (smaller + blur)
or pull it forward. Fake z-axis for the whole desktop.

## J. [ ] Suit-up easter egg (Pose Landmarker) — wow 2/5, effort 3/5
Raise both arms in a T-pose → full-screen "assembly" animation sweeps over
your silhouette. Pure fun, zero utility.
