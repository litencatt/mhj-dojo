import { memo } from 'preact/compat';
import type { Advice, AdviceCandidate, AdvicePhase, DangerLevel, DiscardReview, SeatDanger } from '../api';
import { PanelHeading } from './PanelHeading';
import { Tile, mouseOnly } from './Tile';
import { tileName } from '../tiles';
import { DANGER_NAMES, dangerLevel } from '../danger';

export interface AdvicePanelProps {
  advice: Advice | null; // null unless a discard is pending
  review: DiscardReview | null; // the discard that led to this node
  onHighlight: (tile: string | null) => void; // a hovered candidate, to mark in the hand
  onMinimize: () => void; // send the panel to the dock
  minimized?: boolean; // in the dock: nothing is drawn
  game?: boolean; // a CPU game: advice for a concealed hand only, and no defense
  danger?: SeatDanger[]; // a CPU game, on your turn against a riichi: shown beside each candidate
}

const PHASE_LABELS: Record<AdvicePhase, string> = { early: '序盤', middle: '中盤', late: '終盤' };

function shantenLabel(s: number): string {
  return s === 0 ? '聴牌' : `${s}向聴`;
}

/** A candidate read as one line; focusing it marks the tile in the hand. */
function candidateLabel(c: AdviceCandidate, level: DangerLevel | null): string {
  const parts = [`打 ${tileName(c.tile)}`, shantenLabel(c.shanten), `${c.shanten === 0 ? '待ち' : '有効牌'} ${c.ukeire_kinds}種${c.ukeire}枚`];
  if (c.wait !== null && c.shanten > 0) parts.push(`聴牌時の待ち 平均${c.wait.toFixed(1)}枚`);
  if (level !== null) parts.push(`危険度 ${DANGER_NAMES[level]}`);
  return `${parts.join('、')}（手牌で表示）`;
}

function percent(p: number): string {
  return `${Math.round(p * 100)}%`;
}

/**
 * The practice advice (docs/api.md "Advice"): the best three discards, the
 * outlook for the rest of the game, notes and the review of the last discard.
 * It starts minimized in the right-edge dock like the other panels, so the
 * answer is not shown before the player has thought about the hand.
 */
export const AdvicePanel = memo(function AdvicePanel({ advice, review, onHighlight, onMinimize, minimized, game, danger }: AdvicePanelProps) {
  if (minimized) return null;
  const bestLevel = advice?.candidates[0] ? dangerLevel(danger, advice.candidates[0].tile) : null;
  return (
    <section class="advice-panel" aria-label="アドバイス">
      <PanelHeading
        title="アドバイス"
        onMinimize={() => {
          onHighlight(null);
          onMinimize();
        }}
      />
      <div class="advice-body">
        {/* Always mounted, so each new review is announced. */}
        <div role="status" aria-live="polite">
          {review && (
            <p class={review.is_best ? 'advice-review advice-review-best' : 'advice-review'}>{review.text}</p>
          )}
        </div>
        {advice ? (
          <>
            <ol class="advice-candidates" aria-label="おすすめの打牌">
              {advice.candidates.map((c, i) => {
                const level = dangerLevel(danger, c.tile);
                return (
                <li
                  key={c.tile}
                  class="advice-candidate"
                  tabIndex={0}
                  aria-label={candidateLabel(c, level)}
                  onPointerEnter={mouseOnly(() => onHighlight(c.tile))}
                  onPointerLeave={mouseOnly(() => onHighlight(null))}
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
                  {level !== null && (
                    <span class={`advice-danger advice-danger-${level}`} title={`危険度 ${DANGER_NAMES[level]}`} aria-hidden="true">
                      {DANGER_NAMES[level]}
                    </span>
                  )}
                </li>
                );
              })}
            </ol>
            {bestLevel !== null && bestLevel >= 2 && (
              <p class="advice-danger-note">
                {bestLevel === 3 ? '最善の打牌はリーチ者に危険な牌です。押すかどうか考えましょう。' : '最善の打牌はリーチ者に通るとは限りません。'}
              </p>
            )}
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
            <p class="advice-caveat">
              確率はツモ数と見えていない牌からの目安です。{game && `順位は他家の手（危険度）を考えません。${danger?.length ? '危険度はリーチ者に対する目安です。' : ''}`}
            </p>
          </>
        ) : (
          <p class="advice-caveat">
            {game ? '鳴いていない手で打牌する局面（リーチ後を除く）でおすすめを表示します。' : '打牌する局面でおすすめを表示します。'}
          </p>
        )}
      </div>
    </section>
  );
});
