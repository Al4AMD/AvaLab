/**
 * Word error rate for the ASR experiment (F14, Wave-5 Plan 03 Task 3).
 *
 * Normalization: NFKC, lower-case, punctuation replaced by a space, then
 * whitespace collapsed. WER = (substitutions + deletions + insertions) / N,
 * where N is the reference word count. An empty reference has no denominator,
 * so it throws `RangeError` instead of returning a meaningless zero.
 */
export function normalizeTranscript(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\p{P}+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function words(text: string): string[] {
  const normalized = normalizeTranscript(text);
  return normalized === "" ? [] : normalized.split(" ");
}

function editDistance(reference: readonly string[], hypothesis: readonly string[]): number {
  let previous = Array.from({ length: hypothesis.length + 1 }, (_, index) => index);
  for (let row = 1; row <= reference.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= hypothesis.length; column += 1) {
      const diagonal = previous[column - 1] ?? 0;
      const substitution = diagonal + (reference[row - 1] === hypothesis[column - 1] ? 0 : 1);
      current.push(
        Math.min((previous[column] ?? 0) + 1, (current[column - 1] ?? 0) + 1, substitution),
      );
    }
    previous = current;
  }
  return previous[hypothesis.length] ?? 0;
}

export function wordErrorRate(reference: string, hypothesis: string): number {
  const referenceWords = words(reference);
  if (referenceWords.length === 0) {
    throw new RangeError("wordErrorRate: reference transcript is empty");
  }
  return editDistance(referenceWords, words(hypothesis)) / referenceWords.length;
}
