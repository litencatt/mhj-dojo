import { segments } from './readings';

/** A text with furigana over its mahjong terms' first use (readings.ts); seen is shared by texts shown together. */
export function Furigana({ text, seen }: { text: string; seen?: Set<string> }) {
  return (
    <>
      {segments(text, seen).map((s, i) =>
        s.reading === undefined ? (
          s.text
        ) : (
          <ruby key={i} class="furigana">
            {s.text}
            <rp>（</rp>
            <rt>{s.reading}</rt>
            <rp>）</rp>
          </ruby>
        ),
      )}
    </>
  );
}
