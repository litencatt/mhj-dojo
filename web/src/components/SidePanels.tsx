import type { ComponentChildren } from 'preact';
import type { ComboRow, Tile, YakuRow } from '../api';
import type { PanelKey } from '../panels';
import { YakuTable } from './YakuTable';
import { Glossary } from './Glossary';

export interface SidePanelsProps {
  analysis: YakuRow[];
  byDiscard: Record<Tile, YakuRow[]>;
  combos: ComboRow[];
  combosByDiscard: Record<Tile, ComboRow[]>;
  previewTile: string | null;
  mode: 'practice' | 'game';
  isMin: (k: PanelKey) => boolean;
  onMinimize: (k: PanelKey) => void;
  advice?: ComponentChildren; // the advice panel (practice), above the glossary
}

/** The right column: the yaku table (previewing a hovered discard), the advice and the glossary. */
export function SidePanels({
  analysis,
  byDiscard,
  combos,
  combosByDiscard,
  previewTile,
  mode,
  isMin,
  onMinimize,
  advice,
}: SidePanelsProps) {
  // Preview only tiles the server analysed, so the title never outruns the table.
  const previewRows = previewTile ? byDiscard[previewTile] : undefined;
  const adviceShown = !!advice && !isMin('advice');
  return (
    <div class="area-side" hidden={isMin('yaku') && isMin('gloss') && !adviceShown}>
      <div class="area-yaku" hidden={isMin('yaku')}>
        <YakuTable
          rows={previewRows ?? analysis}
          baseline={previewRows ? analysis : null}
          previewTile={previewRows ? previewTile : null}
          combos={(previewRows && previewTile && combosByDiscard[previewTile]) || combos}
          baseCombos={previewRows ? combos : null}
          onMinimize={() => onMinimize('yaku')}
        />
      </div>
      <div class="area-notes" hidden={isMin('gloss') && !adviceShown}>
        {advice && (
          <div class="area-advice" hidden={!adviceShown}>
            {advice}
          </div>
        )}
        <div class="area-gloss" hidden={isMin('gloss')}>
          <Glossary mode={mode} onMinimize={() => onMinimize('gloss')} />
        </div>
      </div>
    </div>
  );
}
