import { useEffect, useRef } from 'preact/hooks';
import { useBackdropClose } from '../components/backdrop';
import { Tile } from '../components/Tile';
import { useMediaQuery } from '../hooks';
import { tileName } from '../tiles';
import { guideFor, practiceHref } from './yakuGuide';

interface GuideDialogProps {
  /** The yaku (or 役牌) shown; null keeps it closed. */
  yakuKey: string | null;
  /** Opened from a lesson (LessonBar): no link away to practise it, which would leave the lesson. */
  inLesson?: boolean;
  /** Just bought: 修得しました above the guide. */
  learned: boolean;
  onClose: () => void;
}

function shantenText(s: number): string {
  return s === 0 ? '聴牌' : `${s}向聴`;
}

/** A yaku's guide in a modal dialog: its conditions, han, an example hand and a way to practise it. */
export function GuideDialog({ yakuKey, inLesson = false, learned, onClose }: GuideDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const backdrop = useBackdropClose(() => ref.current?.close());
  const guide = yakuKey ? guideFor(yakuKey) : undefined;
  // A phone's dialog is too narrow for 14 tiles of the wider size, and so is any dialog for a hand with kans.
  const phone = useMediaQuery('(width <= 760px)');
  const groups = guide ? [guide.example.hand, ...guide.example.melds] : [];
  const tiles = groups.reduce((n, g) => n + g.length, 1);
  const size = phone || tiles > 14 ? 'xs' : 'sm';

  // Opened once the guide is rendered in it, so it has its content and focus lands on its first control.
  useEffect(() => {
    const d = ref.current;
    if (guide && d && !d.open) d.showModal();
  }, [guide?.key]);

  const href = guide && !inLesson && practiceHref(guide);
  return (
    <dialog ref={ref} class="yaku-guide" aria-labelledby="yaku-guide-heading" onClose={onClose} {...backdrop}>
      {guide && (
        <>
          {learned && (
            <p class="dojo-aid-ok yaku-guide-learned" role="status">
              修得しました
            </p>
          )}
          <h2 id="yaku-guide-heading">{guide.name}</h2>
          <dl class="yaku-guide-facts">
            <dt>成立条件</dt>
            <dd>{guide.condition}</dd>
            <dt>翻</dt>
            <dd>{guide.hanLabel}</dd>
          </dl>
          <h3>例の手</h3>
          <div class="yaku-guide-hand" role="group" aria-label="例の手">
            {groups.map((g, i) => (
              <span key={i} class={i === 0 ? 'yaku-guide-group' : 'yaku-guide-group yaku-guide-meld'} role={i === 0 ? undefined : 'group'} aria-label={i === 0 ? undefined : '槓子'}>
                {g.map((t, j) => (
                  <Tile key={j} tile={t} size={size} />
                ))}
                {i === groups.length - 1 && (
                  <Tile tile={guide.example.win} size={size} className="yaku-guide-win" label={`和了牌 ${tileName(guide.example.win)}`} />
                )}
              </span>
            ))}
          </div>
          <p class="dojo-muted yaku-guide-note">離して置いた最後の牌が和了牌。{guide.example.note}</p>
          {!inLesson && guide.practice && (
            <p class="dojo-muted yaku-guide-seed">
              {guide.practice.row === 'normal'
                ? `練習モードでは立直の宣言はできないので、門前で聴牌するまでを練習します（配牌は${shantenText(guide.practice.shanten)}のシード ${guide.practice.seed}）。`
                : `配牌が${guide.practice.rowName}${shantenText(guide.practice.shanten)}のシード ${guide.practice.seed} で練習できます。`}
            </p>
          )}
          {!inLesson && !guide.practice && <p class="dojo-muted yaku-guide-seed">この役は、捨てるだけの練習モードでは練習できません。</p>}
          <div class="dojo-actions">
            {href && (
              <a class="dojo-start" href={href}>
                この役を練習する
              </a>
            )}
            <button type="button" onClick={() => ref.current?.close()}>
              閉じる
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
