import { useMemo, useRef, useState } from 'preact/hooks';
import { findItem } from './catalog';
import { findLesson, lessonActive, lessonAids, lessonStage, recordSuccess, type Verdict } from './lessons';
import { loadProgress, saveProgress, type DojoProgress } from './progress';

/** What the last success did: counted one of several, passed the assisted stage, or passed the lesson with its reward. */
export type LessonNote =
  | { kind: 'counted' }
  | { kind: 'passed' }
  | { kind: 'completed'; item: string | null; coins: number }; // the item granted (its name), the coins received

/**
 * A lesson played on a page (a dojo game's or practice mode's): the lesson,
 * where it stands, and record, which counts a judgment under its key. A
 * success is saved to the dojo's progress at once (read fresh from storage,
 * so another tab's changes are kept); a key succeeded with before is not
 * counted again. A failure costs nothing: it clears the note and counts
 * toward the hint. A judgment of a lesson locked or done does nothing. Null
 * without a lesson (none asked for, or the page has no dojo).
 */
export function useLesson(lessonId: string | null, onSaved?: (p: DojoProgress) => void) {
  const lesson = lessonId === null ? null : (findLesson(lessonId) ?? null);
  // Read once the lesson is known (a dojo game knows it once its state comes), then kept as it is saved.
  const loaded = useMemo(() => (lesson ? loadProgress().progress : null), [lesson?.id]);
  const [saved, setProgress] = useState<DojoProgress | null>(null);
  const progress = saved ?? loaded;
  const [note, setNote] = useState<LessonNote | null>(null);
  const [failures, setFailures] = useState(0);
  const [saveFailed, setSaveFailed] = useState(false);
  // The keys succeeded with on this page: a state seen again (a re-render) is not counted twice. A
  // failure is not kept: the key of a step that failed may still succeed (none does yet, but the
  // judgment is the lesson's to make).
  const succeeded = useRef(new Set<string>());
  if (!lesson || !progress) return null;

  function record(verdict: Verdict, key: string) {
    if (!lesson || verdict === null || succeeded.current.has(key)) return;
    const cur = loadProgress().progress;
    if (!lessonActive(cur, lesson.id)) return;
    if (!verdict) {
      setFailures((n) => n + 1);
      setNote(null);
      return;
    }
    succeeded.current.add(key);
    setFailures(0);
    const r = recordSuccess(cur, lesson.id, key);
    if (r.progress === cur) return; // counted before (another tab, a reload)
    if (r.completed) {
      const granted = r.progress.ownedItems.find((id) => !cur.ownedItems.includes(id));
      setNote({ kind: 'completed', item: granted ? (findItem(granted)?.name ?? null) : null, coins: r.progress.coins - cur.coins });
    } else setNote({ kind: r.passed ? 'passed' : 'counted' });
    setSaveFailed(!saveProgress(r.progress));
    setProgress(r.progress);
    onSaved?.(r.progress);
  }

  const stage = lessonStage(progress, lesson.id);
  const aids = lessonAids(progress, lesson.id);
  const active = lessonActive(progress, lesson.id);
  return {
    lesson,
    stage,
    count: progress.lessons[lesson.id]?.count ?? 0,
    note,
    failures,
    saveFailed,
    record,
    /** Drops the note (the next round begins). */
    clearNote: () => setNote(null),
    /** Whether an assist of the lesson is on while it is learned (lessonAids: at the assisted stage only, owned or not); undefined for any other assist. */
    assist(id: string): boolean | undefined {
      return active && lesson.assists.includes(id) ? aids.assists.includes(id) : undefined;
    },
  };
}
