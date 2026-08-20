# Future ideas

Things that would fit HoloSpace well, roughly ordered by coolness/effort ratio.

## Interaction
- **Grab-to-throw physics**: give windows momentum when released mid-drag, with
  friction and soft bouncing on screen edges (Iron-Man "flick a file across the
  room" feel). The velocity is already available in the One-Euro filter state.
- **Open-palm hold = context ring**: holding an open palm over a window for
  ~700 ms spawns a radial menu around the cursor (close / duplicate / send to
  HOLO / minimize).
- **Fist = minimize to dock**: closing a fist over a window shrinks it into a
  small chip at the bottom of the screen; pinch the chip to restore.
- **Two-hand rotate**: while both hands pinch a window, follow the angle
  between the hands (in addition to distance) to rotate it in 3D
  (`transform: rotate3d`), like Tony spinning a hologram.
- **Depth layer**: use the hand's apparent size (z proxy) to push/pull windows
  along a fake z-axis (scale + blur), so the desktop feels volumetric.
- **Head parallax**: track the face position too and shift the whole scene a
  few pixels opposite to head movement — instant "hologram floating in the
  room" depth illusion, very cheap with MediaPipe FaceDetector.

## Voice / agent
- **Wake word** ("Hey HOLO") using a tiny always-on VAD + keyword model so the
  mic click becomes optional.
- **TTS replies**: pipe agent answers through a local TTS (kokoro or
  llama.cpp's tts models) so HOLO talks back; sync the mic ring animation to
  the audio envelope.
- **Voice-driven window control**: expose `move/resize/close` window tools to
  the agent ("HOLO, put the reactor schematic on the left").
- **Streaming ASR**: swap click-to-stop for continuous transcription with
  whisper-stream (or the Nemotron RNNT model once a runtime for the `asr`
  GGUF arch is available) and end-of-speech detection.
- **File summaries on hover**: hovering a library card 1 s asks the LLM for a
  one-line summary, shown as a tooltip (cache it).

## Files / windows
- **PDF windows** via pdf.js, page turning with horizontal pinch-swipes.
- **Editable text windows**: a holographic on-screen keyboard, or "dictate
  into file" mode that appends transcription directly to the open file.
- **Video files** with a scrub bar you can pinch-drag.
- **Image gallery mode**: clap with both fists to arrange all open windows in
  an orbit/grid layout instead of closing them.

## Polish
- **Calibration overlay**: 5-point pinch calibration to fit the cursor mapping
  to the user's arm span / camera placement.
- **Per-user profiles** persisted in localStorage (gesture thresholds, colors).
- **Session replay**: record cursor traces + events to replay a session as an
  attract-mode demo.
- **Multi-monitor / projector mode**: a second browser window acting as pure
  display while the laptop handles tracking.
