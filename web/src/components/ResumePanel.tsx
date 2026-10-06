export interface ResumeItem {
  id: string;
  label: string; // what it is: its seed, round ...
  used: number; // Date.now() of its last save, 0 if unknown
  params: Record<string, string>; // the URL params that deal it again
  over?: boolean; // a game that has ended: listed, but not 「続きから」
}

interface ResumePanelProps {
  noun: string; // 練習 or 対局
  newLabel: string; // the header's button that starts a new one
  items: ResumeItem[]; // the most recently used first
  busy: boolean;
  onOpen: (item: ResumeItem) => void;
}

// Listed besides 「続きから」.
const MAX_OTHERS = 4;

function describe(item: ResumeItem): string {
  if (!item.used) return item.label;
  const when = new Date(item.used).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${item.label}・${when}`;
}

/**
 * Shown instead of a new session or game when the page opens without one in
 * the URL and some are saved: 「続きから」 resumes the most recently used
 * one not over, and the list the others; the header's button (newLabel)
 * starts a new one.
 */
export function ResumePanel({ noun, newLabel, items, busy, onOpen }: ResumePanelProps) {
  const last = items.find((s) => !s.over);
  const others = items.filter((s) => s !== last).slice(0, MAX_OTHERS);
  return (
    <section class="resume-panel" aria-label={`保存した${noun}`}>
      {last && (
        <div class="resume-last">
          <button
            type="button"
            class="action-primary"
            aria-describedby="resume-last-desc"
            disabled={busy}
            onClick={() => onOpen(last)}
          >
            続きから
          </button>
          <span id="resume-last-desc">{describe(last)}</span>
        </div>
      )}
      {others.length > 0 && (
        <>
          <h2 class="resume-heading">最近の{noun}</h2>
          <ul class="resume-list">
            {others.map((s) => (
              <li key={s.id}>
                <button type="button" disabled={busy} onClick={() => onOpen(s)}>
                  {describe(s)}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p class="muted">新しく始めるときは「{newLabel}」</p>
    </section>
  );
}
