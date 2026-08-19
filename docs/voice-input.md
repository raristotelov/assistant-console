# Voice input (you → Claude)

## Stack

- **@ricky0123/vad-web 0.0.19** (Silero VAD) + **onnxruntime-web 1.14.0**, both
  loaded from jsDelivr in `index.html`. Requires network on first load.
- **whisper.cpp** CLI, model `ggml-small.bin`, run per utterance from main.

## Flow

1. Mic button starts `MicVAD`. The library's default constraints apply
   (`channelCount: 1`, `echoCancellation`, `autoGainControl`, `noiseSuppression`
   all true).
2. `onSpeechStart` only updates the status text — it does not interrupt playback.
3. `onSpeechEnd` gives Float32 samples; `encodeWav()` makes a 16 kHz mono
   16-bit WAV and sends it over `voice:transcribe`.
4. Main writes it to a temp dir and runs
   `whisper-cli -m <model> -f in.wav -nt -otxt`, reading stdout (falling back to
   the `.txt` file), then applies `speechOnly()`.
5. If text remains: playback is cancelled (`stopSpeaking()`), then the text is
   sent with `term:send-line`.

## Non-speech filtering

`speechOnly()` in `src/speech.js` removes whisper's non-speech annotations —
`(clears throat)`, `[coughing]`, `*laughs*`, `[BLANK_AUDIO]`, `♪ … ♪` — and
returns an empty string if no letter or digit survives.

Effect: coughs, sniffs and laughter neither interrupt the assistant nor get
typed into Claude. Text mixed with an annotation keeps the real words.

## Barge-in

Interruption fires on **confirmed words**, not on sound. The cost is latency:
the interrupt cannot happen until you stop speaking, because whisper needs the
completed utterance, plus transcription time.

The alternative — interrupting on VAD speech start — was tried and rejected: any
cough, keyboard noise or notification sound killed the reply.

## Known limits

- **Acoustic echo.** Anything played through speakers can reach the mic. The
  VAD's echo cancellation only covers audio the app itself plays, so external
  sounds carrying real speech (e.g. peon-ping's voice lines) get transcribed and
  sent to Claude. Headphones remove this entirely.
- **Whisper hallucination.** Silence or noise occasionally transcribes as a real
  phrase; an annotation filter cannot catch that.
- Whisper is multilingual, so speaking Bulgarian largely works — but see
  [voice-output.md](voice-output.md), replies are read in English only.
