import type { Advice, AdviceCandidate, AdvicePhase, DiscardReview } from '../api';
import { useAdviceOpen } from '../hooks';
import { Tile } from './Tile';

export interface AdvicePanelProps {
  advice: Advice | null; // null unless a discard is pending
  review: DiscardReview | null; // the discard that led to this node
  onHighlight: (tile: string | null) => void; // a hovered candidate, to mark in the hand
}

const PHASE_LABELS: Record<AdvicePhase, string> = { early: '序盤', middle: '中盤', late: '終盤' };

function shantenLabel(s: number): string {
  return s === 0 ? '聴牌' : `${s}向聴`;
}

/** A candidate read as one line; focusing it marks the tile in the hand. */
function candidateLabel(c: AdviceCandidate): string {
  const parts = [`打 ${c.tile}`, shantenLabel(c.shanten), `${c.shanten === 0 ? '待ち' : '有効牌'} ${c.ukeire_kinds}種${c.ukeire}枚`];
  if (c.wait !== null && c.shanten > 0) parts.push(`聴牌時の待ち 平均${c.wait.toFixed(1)}枚`);
  return `${parts.join('、')}（手牌で表示）`;
}

function percent(p: number): string {
  return `${Math.round(p * 100)}%`;
}

/**
 * The practice advice (docs/api.md "Advice"): the best three discards, the
 * outlook for the rest of the game, notes and the review of the last discard.
 * It stays closed until opened, so the answer is not shown before the player
 * has thought about the hand; the open state is remembered.
 */
export function AdvicePanel({ advice, review, onHighlight }: AdvicePanelProps) {
  const [open, setOpen] = useAdviceOpen();
  return (
    <section class="advice-panel" aria-label="アドバイス">
      <div class="panel-heading">
        <h2>アドバイス</h2>
        <button
          type="button"
          class="advice-toggle"
          aria-expanded={open}
          aria-controls={open ? 'advice-body' : undefined}
          onClick={() => {
            setOpen(!open);
            onHighlight(null);
          }}
        >
          {open ? '閉じる' : '開く'}
        </button>
      </div>
      {open && (
        <div id="advice-body" class="advice-body">
          {/* Mounted while open, so each new review is announced. */}
          <div role="status" aria-live="polite">
            {review && (
              <p class={review.is_best ? 'advice-review advice-review-best' : 'advice-review'}>{review.text}</p>
            )}
          </div>
          {advice ? (
            <>
              <ol class="advice-candidates" aria-label="おすすめの打牌">
                {advice.candidates.map((c, i) => (
                  <li
                    key={c.tile}
                    class="advice-candidate"
                    tabIndex={0}
                    aria-label={candidateLabel(c)}
                    onMouseEnter={() => onHighlight(c.tile)}
                    onMouseLeave={() => onHighlight(null)}
                    onFocus={() => onHighlight(c.tile)}
                    onBlur={() => onHighlight(null)}
                  >
                    <span class="advice-rank">{i + 1}</span>
                    <Tile tile={c.tile} size="sm" />
                    <span class="advice-figures">
                      <span class="advice-shanten">{shantenLabel(c.shanten)}</span>
                      <span>
                        {c.shanten === 0 ? '待ち' : '有効牌'} {c.ukeire_kinds}種{c.ukeire}枚
                      </span>
                      {c.wait !== null && c.shanten > 0 && <span>聴牌時の待ち 平均{c.wait.toFixed(1)}枚</span>}
                    </span>
                  </li>
                ))}
              </ol>
              <dl class="advice-outlook">
                <div>
                  <dt>巡目</dt>
                  <dd>
                    {advice.junme}巡目（{PHASE_LABELS[advice.phase]}）
                  </dd>
                </div>
                <div>
                  <dt>残りツモ</dt>
                  <dd>{advice.draws_left}回</dd>
                </div>
                <div>
                  <dt>聴牌まで</dt>
                  <dd>{advice.candidates[0]?.shanten === 0 ? '聴牌済み' : `約${percent(advice.tenpai_chance)}`}</dd>
                </div>
                <div>
                  <dt>和了まで</dt>
                  <dd>約{percent(advice.win_chance)}</dd>
                </div>
              </dl>
              <p class="advice-guideline">{advice.guideline}</p>
              <ul class="advice-notes">
                <li>{advice.shape}</li>
                {advice.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
              {advice.near_yaku.length > 0 && (
                <div class="advice-yaku">
                  <span class="advice-yaku-label">近い役</span>
                  <ul>
                    {advice.near_yaku.map((y) => (
                      <li key={y.key} class={y.kept ? 'advice-yaku-kept' : 'advice-yaku-lost'}>
                        {y.name} {shantenLabel(y.shanten)}
                        <span class="advice-yaku-mark">{y.kept ? '（残る）' : '（遠のく）'}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p class="advice-caveat">確率はツモ数と見えていない牌からの目安です。</p>
            </>
          ) : (
            <p class="advice-caveat">打牌する局面でおすすめを表示します。</p>
          )}
        </div>
      )}
    </section>
  );
}
