import type { Win } from '../api';
import { Tile } from './Tile';
import { yakuHanText } from '../yakumanLabel';

export interface WinPanelProps {
  win: Win;
}

/** Terminal tsumo panel: 14 tiles, yaku list with han, dora, han total. */
export function WinPanel(props: WinPanelProps) {
  const { win } = props;
  // Every yakuman is 13 han (26 for a double yakuman) and no ordinary yaku
  // reaches that; with a yakuman, dora are reported but not added to the total.
  const yakuman = win.yaku.some((y) => y.han >= 13);
  const doraIgnored = yakuman && win.dora > 0;
  // At 跳満 (6 han) or above, the dojo's win effect plays over it, as over a game's result (ResultPanel).
  const high = win.han_total >= 6;
  return (
    <section class="win-panel" aria-label="和了">
      <h2>ツモ和了</h2>
      {high && <div class="win-effect" data-testid="win-effect" aria-hidden="true" />}
      <div class="win-tiles" role="group" aria-label="和了形14枚">
        {win.tiles.map((t, i) => (
          <Tile key={`${t}-${i}`} tile={t} />
        ))}
      </div>
      <table class="win-yaku-table">
        <thead>
          <tr>
            <th scope="col">役</th>
            <th scope="col">翻</th>
          </tr>
        </thead>
        <tbody>
          {win.yaku.map((y) => (
            <tr key={y.key}>
              <td>{y.name}</td>
              <td>{yakuHanText(y.han)}</td>
            </tr>
          ))}
          <tr class={doraIgnored ? 'win-dora-ignored' : ''}>
            <td>
              ドラ
              {doraIgnored && <span class="win-note">役満のため加算なし</span>}
            </td>
            <td>{win.dora}翻</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">合計</th>
            <td>{yakuman ? yakuHanText(win.han_total) : `${win.han_total}翻`}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}
