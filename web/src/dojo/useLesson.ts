import { useMemo, useRef, useState } from 'preact/hooks';
import type { LessonNote } from './LessonBar';
import { findLesson, lessonActive, lessonStage, recordSuccess, type Verdict } from './lessons';
import { loadProgress, saveProgress, type DojoProgress } from './progress';

/**
 * A lesson played on a page (a dojo game's or practice mode's): the lesson,
 * where it stands, and record, which counts a judgment under its key. A
 * success is saved to the dojo's progress at once (read fresh from storage,
 * so another tab's changes are kept); a failure costs nothing and only
 * counts toward the hint. A judgment of a key judged before, or of a lesson
 * locked or done, does nothing. Null without a lesson (none asked for, or
 * the page has no dojo).
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
  const judged = useRef(new Set<string>());
  if (!lesson || !progress) return null;

  function record(verdict: Verdict, key: string) {
    if (!lesson || verdict === null || judged.current.has(key)) return;
    judged.current.add(key);
    const cur = loadProgress().progress;
    if (!lessonActive(cur, lesson.id)) return;
    if (!verdict) {
      setFailures((n) => n + 1);
      return;
    }
    setFailures(0);
    const r = recordSuccess(cur, lesson.id, key);
    if (r.progress === cur) return; // counted before (another tab, a reload)
    setNote(r.completed ? 'completed' : r.passed ? 'passed' : 'counted');
    setSaveFailed(!saveProgress(r.progress));
    setProgress(r.progress);
    onSaved?.(r.progress);
  }

  const stage = lessonStage(progress, lesson.id);
  return {
    lesson,
    stage,
    count: progress.lessons[lesson.id]?.count ?? 0,
    note,
    failures,
    saveFailed,
    record,
    /** Whether an assist of the lesson is on: at the assisted stage only, owned or not; undefined for any other assist. */
    assist(id: string): boolean | undefined {
      if (!lesson.assists.includes(id) || (stage !== 'assisted' && stage !== 'unassisted')) return undefined;
      return stage === 'assisted';
    },
  };
}
