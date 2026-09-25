import type { Tile, YakuRow } from '../api';
import type { PanelKey } from '../panels';
import { YakuTable } from './YakuTable';
import { Glossary } from './Glossary';

export interface SidePanelsProps {
  analysis: YakuRow[];
  byDiscard: Record<Tile, YakuRow[]>;
  previewTile: string | null;
  mode: 'practice' | 'game';
  isMin: (k: PanelKey) => boolean;
  onMinimize: (k: PanelKey) => void;
}

/** The right column: the yaku table (previewing a hovered discard) and the glossary. */
export function SidePanels({ analysis, byDiscard, previewTile, mode, isMin, onMinimize }: SidePanelsProps) {
  // Preview only tiles the server analysed, so the title never outruns the table.
  const previewRows = previewTile ? byDiscard[previewTile] : undefined;
  return (
    <div class="area-side" hidden={isMin('yaku') && isMin('gloss')}>
      <div class="area-yaku" hidden={isMin('yaku')}>
        <YakuTable
          rows={previewRows ?? analysis}
          baseline={previewRows ? analysis : null}
          previewTile={previewRows ? previewTile : null}
          onMinimize={() => onMinimize('yaku')}
        />
      </div>
      <div class="area-gloss" hidden={isMin('gloss')}>
        <Glossary mode={mode} onMinimize={() => onMinimize('gloss')} />
      </div>
    </div>
  );
}
