import type { ComponentChildren } from 'preact';
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
  advice?: ComponentChildren; // the advice panel (practice), above the glossary
}

/** The right column: the yaku table (previewing a hovered discard), the advice and the glossary. */
export function SidePanels({ analysis, byDiscard, previewTile, mode, isMin, onMinimize, advice }: SidePanelsProps) {
  // Preview only tiles the server analysed, so the title never outruns the table.
  const previewRows = previewTile ? byDiscard[previewTile] : undefined;
  return (
    <div class="area-side" hidden={isMin('yaku') && isMin('gloss') && !advice}>
      <div class="area-yaku" hidden={isMin('yaku')}>
        <YakuTable
          rows={previewRows ?? analysis}
          baseline={previewRows ? analysis : null}
          previewTile={previewRows ? previewTile : null}
          onMinimize={() => onMinimize('yaku')}
        />
      </div>
      <div class="area-notes" hidden={isMin('gloss') && !advice}>
        {advice && <div class="area-advice">{advice}</div>}
        <div class="area-gloss" hidden={isMin('gloss')}>
          <Glossary mode={mode} onMinimize={() => onMinimize('gloss')} />
        </div>
      </div>
    </div>
  );
}
