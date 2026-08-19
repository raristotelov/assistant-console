import io
import json
import os
import queue
import re
import sys
import threading
import wave
from collections import deque

SAMPLE_RATE = 24000


def read_stdin(messages):
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            messages.put(json.loads(line))
        except json.JSONDecodeError:
            pass
    messages.put(None)


def split_sentences(text):
    parts = []
    for block in text.split("\n"):
        block = block.strip()
        if not block:
            continue
        parts.extend(s.strip() for s in re.split(r"(?<=[.!?])\s+", block) if s.strip())
    return parts


def to_wav_bytes(audio):
    samples = (audio.clamp(-1, 1).numpy() * 32767).astype("int16")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(samples.tobytes())
    return buf.getvalue()


def emit(header, payload=b""):
    out = sys.stdout.buffer
    out.write((json.dumps(header) + "\n").encode("utf-8"))
    if payload:
        out.write(payload)
    out.flush()


class Inbox:
    def __init__(self):
        self.messages = queue.Queue()
        self.pending = deque()
        self.cancel_max = 0
        self.closed = False
        threading.Thread(target=read_stdin, args=(self.messages,), daemon=True).start()

    def _accept(self, msg):
        if msg is None:
            self.closed = True
        elif "cancel" in msg:
            self.cancel_max = max(self.cancel_max, msg["cancel"])
        elif "text" in msg and "id" in msg:
            self.pending.append(msg)

    def drain(self):
        while not self.closed:
            try:
                self._accept(self.messages.get_nowait())
            except queue.Empty:
                return

    def next_utterance(self):
        self.drain()
        while not self.pending and not self.closed:
            self._accept(self.messages.get())
            self.drain()
        return self.pending.popleft() if self.pending else None


def main():
    from kokoro import KPipeline

    voice = os.environ.get("KOKORO_VOICE", "af_heart")
    pipeline = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M")

    inbox = Inbox()
    emit({"ready": True})

    while True:
        msg = inbox.next_utterance()
        if msg is None:
            return

        utterance_id = msg["id"]
        if utterance_id <= inbox.cancel_max:
            continue
        sentences = split_sentences(msg["text"])
        for seq, sentence in enumerate(sentences):
            inbox.drain()
            if utterance_id <= inbox.cancel_max:
                break
            try:
                chunks = [audio for _gs, _ps, audio in pipeline(sentence, voice=voice)]
            except Exception as e:
                emit({"id": utterance_id, "error": str(e)})
                break
            for audio in chunks:
                wav = to_wav_bytes(audio)
                emit(
                    {
                        "id": utterance_id,
                        "seq": seq,
                        "len": len(wav),
                        "last": seq == len(sentences) - 1,
                    },
                    wav,
                )


if __name__ == "__main__":
    main()
