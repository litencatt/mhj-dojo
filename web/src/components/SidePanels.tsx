import type { ComponentChildren } from 'preact';
import { useCallback, useMemo } from 'preact/hooks';
import { withNames, type ComboRow, type DiscardRow, type Remaining, type Tile, type YakuRow } from '../api';
import type { PanelKey } from '../panels';
import { YakuTable } from './YakuTable';
import { Glossary } from './Glossary';

export interface SidePanelsProps {
  analysis: YakuRow[];
  byDiscard: Record<Tile, DiscardRow[]>;
  combos: ComboRow[];
  combosByDiscard: Record<Tile, ComboRow[]>;
  remaining: Remaining;
  previewTile: string | null;
  mode: 'practice' | 'game';
  glossary?: boolean; // false leaves the glossary out (a CPU game on a phone)
  isMin: (k: PanelKey) => boolean;
  onMinimize: (k: PanelKey) => void; // keeps its identity across renders (useMinimized)
  advice?: ComponentChildren; // the advice panel (practice), above the glossary
}

/** The right column: the yaku table (previewing a hovered discard), the advice and the glossary. */
export function SidePanels({
  analysis,
  byDiscard,
  combos,
  combosByDiscard,
  remaining,
  previewTile,
  mode,
  glossary = true,
  isMin,
  onMinimize,
  advice,
}: SidePanelsProps) {
  // Preview only tiles the engine analysed, so the title never outruns the table.
  const preview = previewTile ? byDiscard[previewTile] : undefined;
  const previewRows = useMemo(() => preview && withNames(preview, analysis), [preview, analysis]);
  const adviceShown = !!advice && !isMin('advice');
  const glossHidden = !glossary || isMin('gloss');
  const minimizeYaku = useCallback(() => onMinimize('yaku'), [onMinimize]);
  const minimizeGloss = useCallback(() => onMinimize('gloss'), [onMinimize]);
  return (
    <div class="area-side" hidden={isMin('yaku') && glossHidden && !adviceShown}>
      <div class="area-yaku" hidden={isMin('yaku')}>
        <YakuTable
          rows={previewRows ?? analysis}
          baseline={previewRows ? analysis : null}
          previewTile={previewRows ? previewTile : null}
          combos={(previewRows && previewTile && combosByDiscard[previewTile]) || combos}
          baseCombos={previewRows ? combos : null}
          remaining={remaining}
          minimized={isMin('yaku')}
          onMinimize={minimizeYaku}
        />
      </div>
      <div class="area-notes" hidden={glossHidden && !adviceShown}>
        {advice && (
          <div class="area-advice" hidden={!adviceShown}>
            {advice}
          </div>
        )}
        {glossary && (
          <div class="area-gloss" hidden={isMin('gloss')}>
            <Glossary mode={mode} minimized={isMin('gloss')} onMinimize={minimizeGloss} />
          </div>
        )}
      </div>
    </div>
  );
}
