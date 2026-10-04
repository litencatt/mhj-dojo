export interface ResumeItem {
  id: string;
  label: string; // what it is: its seed, round ...
  used: number; // Date.now() of its last save
}

interface ResumePanelProps {
  noun: string; // 練習 or 対局
  items: ResumeItem[]; // the most recently used first
  busy: boolean;
  onOpen: (id: string) => void;
}

// The most recently used one, and up to this many others.
const MAX_OTHERS = 4;

function when(used: number): string {
  return new Date(used).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * Shown instead of a new session or game when the page opens without one in
 * the URL and some are saved: 「続きから」 resumes the most recently used,
 * and the list the others; the header's 新規対局 starts a new one.
 */
export function ResumePanel({ noun, items, busy, onOpen }: ResumePanelProps) {
  const [last, ...others] = items;
  return (
    <section class="resume-panel" aria-label={`保存した${noun}`}>
      <div class="resume-last">
        <button type="button" class="action-primary" disabled={busy} onClick={() => onOpen(last.id)}>
          続きから
        </button>
        <span>
          {last.label}・{when(last.used)}
        </span>
      </div>
      {others.length > 0 && (
        <>
          <h2 class="resume-heading">最近の{noun}</h2>
          <ul class="resume-list">
            {others.slice(0, MAX_OTHERS).map((s) => (
              <li key={s.id}>
                <button type="button" disabled={busy} onClick={() => onOpen(s.id)}>
                  {s.label}・{when(s.used)}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p class="muted">新しく始めるときは「新規対局」</p>
    </section>
  );
}
