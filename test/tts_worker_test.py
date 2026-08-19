import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from tts_worker import Inbox, split_sentences


class SplitSentences(unittest.TestCase):
    def test_splits_on_sentence_endings(self):
        self.assertEqual(
            split_sentences("First one. Second one! Third one?"),
            ["First one.", "Second one!", "Third one?"],
        )

    def test_keeps_a_single_sentence_whole(self):
        self.assertEqual(split_sentences("No trailing punctuation here"), ["No trailing punctuation here"])

    def test_splits_on_line_breaks(self):
        self.assertEqual(split_sentences("Line one\nLine two"), ["Line one", "Line two"])

    def test_drops_blank_lines_and_padding(self):
        self.assertEqual(split_sentences("  One.  \n\n\n  Two.  "), ["One.", "Two."])

    def test_empty_text_yields_nothing(self):
        self.assertEqual(split_sentences(""), [])
        self.assertEqual(split_sentences("   \n  "), [])

    def test_does_not_split_inside_a_sentence(self):
        self.assertEqual(
            split_sentences("Check src/main.js for the handler."),
            ["Check src/main.js for the handler."],
        )


class InboxRouting(unittest.TestCase):
    def make(self):
        inbox = Inbox.__new__(Inbox)
        import queue
        from collections import deque

        inbox.messages = queue.Queue()
        inbox.pending = deque()
        inbox.cancel_max = 0
        inbox.closed = False
        return inbox

    def test_queues_utterances_in_order(self):
        inbox = self.make()
        inbox._accept({"id": 1, "text": "one"})
        inbox._accept({"id": 2, "text": "two"})
        self.assertEqual([m["id"] for m in inbox.pending], [1, 2])

    def test_cancel_raises_the_threshold(self):
        inbox = self.make()
        inbox._accept({"cancel": 3})
        inbox._accept({"cancel": 1})
        self.assertEqual(inbox.cancel_max, 3)

    def test_ignores_malformed_messages(self):
        inbox = self.make()
        inbox._accept({"text": "no id"})
        inbox._accept({"id": 9})
        self.assertEqual(list(inbox.pending), [])

    def test_none_closes_the_inbox(self):
        inbox = self.make()
        inbox._accept(None)
        self.assertTrue(inbox.closed)


if __name__ == "__main__":
    unittest.main()
