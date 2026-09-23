import type { Win } from '../api';
import { Tile } from './Tile';

export interface WinPanelProps {
  win: Win;
}

/** Terminal tsumo panel: 14 tiles, yaku list with han, dora, han total. */
export function WinPanel(props: WinPanelProps) {
  const { win } = props;
  return (
    <section class="win-panel" aria-label="和了">
      <h2>ツモ和了</h2>
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
              <td>{y.han}翻</td>
            </tr>
          ))}
          <tr>
            <td>ドラ</td>
            <td>{win.dora}翻</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">合計</th>
            <td>{win.han_total}翻</td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}
