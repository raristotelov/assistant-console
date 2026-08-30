const SEE_TERMINAL_NOTICE = "There's something in the terminal you need to see.";

function toSpeakable(markdown) {
  let text = markdown;
  let skippedVisualContent = false;

  text = text.replace(/```[\s\S]*?(```|$)/g, () => {
    skippedVisualContent = true;
    return " ";
  });

  const lines = text.split("\n").filter((line) => {
    if (/^\s*\|.*\|\s*$/.test(line) || /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line)) {
      skippedVisualContent = true;
      return false;
    }
    return true;
  });
  text = lines
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
        .replace(/^\s*>\s?/, ""),
    )
    .join("\n");

  text = text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\b_([^_]+)_\b/g, "$1")
    .replace(/[*`#~]/g, " ")
    .replace(
      /\p{Extended_Pictographic}|\p{Emoji_Modifier}|\u{FE0E}|\u{FE0F}|\u{200D}|\u{20E3}/gu,
      " ",
    )
    .replace(/\b([A-Z]{2,5})(s?)\b/g, (_m, letters, plural) => letters.split("").join(" ") + plural)
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();

  if (skippedVisualContent) {
    text = text ? `${text} ${SEE_TERMINAL_NOTICE}` : SEE_TERMINAL_NOTICE;
  }
  return text;
}

module.exports = { toSpeakable };
