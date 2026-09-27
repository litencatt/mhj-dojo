import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import * as api from './api';
import type { SessionState } from './api';
import { Hand } from './components/Hand';
import { ShantenChart } from './components/ShantenChart';
import { HistoryTree } from './components/HistoryTree';
import { WinPanel } from './components/WinPanel';
import { Dock } from './components/Dock';
import { DoraStatus } from './components/DoraStatus';
import { SidePanels } from './components/SidePanels';
import { AdvicePanel } from './components/AdvicePanel';
import { Help } from './components/Help';
import { TabStopped } from './components/TabStopped';
import { VersionTag } from './components/VersionTag';
import { PANELS, focusGlossary, optionalInt, useMinimized, type PanelKey } from './panels';
import {
  sessionMovedOn,
  useRowNames,
  useSerialRequest,
  useSingleTab,
  useStableCallback,
  useUrlResume,
} from './hooks';
import { claim } from './singleTab';

export function App() {
  const [state, setState] = useState<SessionState | null>(null);
  const [previewTile, setPreviewTile] = useState<string | null>(null);
  const [highlightTile, setHighlightTile] = useState<string | null>(null);
  const [seedInput, setSeedInput] = useState('');
  const [maxTurnsInput, setMaxTurnsInput] = useState('18');
  const { minimized, isMin, minimize, restore } = useMinimized();
  const { busy, error, notice, request } = useSerialRequest<SessionState>(
    (next) => {
      setState(next);
      setPreviewTile(null);
      setHighlightTile(null);
    },
    // On the static site no other tab plays this session meanwhile (see
    // useSingleTab): a 409 is never another tab's doing. On the server it
    // may be another browser's.
    state && !api.WASM ? () => api.getSession(state.session_id) : undefined,
    sessionMovedOn,
  );
  const stopped = useSingleTab(state ? api.sessionKey(state.session_id) : null);

  function startGame(seed?: number, maxTurns?: number) {
    return request(() => api.createSession({ seed, max_turns: maxTurns ?? 18 }));
  }

  // The URL carries ?session=&seed=&turns= so a reload resumes the game, or
  // replays the same wall from the seed after a server restart.
  const resume = useUrlResume({
    idKey: 'session',
    request,
    get: (id) => {
      // Before asking for it, so that another tab stops saving it first.
      claim(api.sessionKey(id));
      return api.getSession(id);
    },
    create: (params) =>
      api.createSession({ seed: optionalInt(params.get('seed')), max_turns: optionalInt(params.get('turns')) ?? 18 }),
    sync: state && { session: state.session_id, seed: String(state.seed), turns: String(state.max_turns) },
  });

  useEffect(() => {
    document.title = 'mhj-dojo - 麻雀道場';
  }, []);

  function handleNewGame(e: Event) {
    e.preventDefault();
    const seed = seedInput.trim() === '' ? undefined : Number(seedInput);
    const maxTurns = maxTurnsInput.trim() === '' ? 18 : Number(maxTurnsInput);
    void startGame(seed, maxTurns);
  }

  function handleDiscard(tile: string) {
    if (!state) return;
    void request(() => api.discard(state.session_id, tile, state.node_id));
  }

  function handleTsumo() {
    if (!state) return;
    void request(() => api.tsumo(state.session_id, state.node_id));
  }

  const handleGoto = useStableCallback((nodeId: number) => {
    if (!state) return;
    void request(() => api.goto(state.session_id, nodeId));
  });

  const rowNames = useRowNames(state?.analysis);
  // The panels are memoized: their callbacks keep their identity.
  const minimizeChart = useCallback(() => minimize('chart'), [minimize]);
  const minimizeTree = useCallback(() => minimize('tree'), [minimize]);
  const minimizeAdvice = useCallback(() => minimize('advice'), [minimize]);

  // Minimized panels stay mounted (hidden, drawing nothing) so they keep
  // their own state, such as the chart's legend selection and the glossary
  // search.
  const docked = PANELS.filter((p) => minimized.includes(p.key));
  const appClass = state && docked.length > 0 ? 'app app-practice has-dock' : 'app app-practice';

  // On a phone the yaku panel scrolls on its own in the height left under the
  // header and the hand (style.css): tell the CSS where the panel starts.
  const appRef = useRef<HTMLDivElement>(null);
  const hasState = !!state;
  useEffect(() => {
    const app = appRef.current;
    if (!app) return;
    // The panels above the yaku table change the app's height when they
    // change, and so does a new window width.
    const ro = new ResizeObserver(() => {
      const yaku = app.querySelector('.area-yaku');
      if (!yaku) return;
      const top = `${yaku.getBoundingClientRect().top + window.scrollY}px`;
      // A write, even of the same value, may restyle the whole app.
      if (app.style.getPropertyValue('--yaku-top') !== top) app.style.setProperty('--yaku-top', top);
    });
    ro.observe(app);
    return () => ro.disconnect();
  }, [hasState]);

  return (
    <div ref={appRef} class={appClass}>
      <div class="area-main">
        <div class="area-header">
          <header class="app-header">
            <h1>
              mhj-dojo <span class="app-subtitle">麻雀道場</span>
              <a class="mode-link" href="?mode=game">CPU対戦へ</a>
            </h1>
            <div class="header-meta">
              <VersionTag />
              <Help
                onShowGlossary={() => {
                  restore('gloss');
                  focusGlossary();
                }}
              />
            </div>
            <form class="new-game-form" onSubmit={handleNewGame}>
              <label>
                シード
                <input
                  type="number"
                  value={seedInput}
                  placeholder="ランダム"
                  onInput={(e) => setSeedInput((e.target as HTMLInputElement).value)}
                />
              </label>
              <label>
                最大巡目
                <input
                  type="number"
                  class="input-narrow"
                  min={1}
                  value={maxTurnsInput}
                  onInput={(e) => setMaxTurnsInput((e.target as HTMLInputElement).value)}
                />
              </label>
              <button type="submit" disabled={busy}>新規対局</button>
            </form>
            {state && (
              <div class="header-status">
                <dl class="game-status">
                  <div>
                    <dt>シード</dt>
                    <dd>{state.seed}</dd>
                  </div>
                  <div>
                    <dt>巡目</dt>
                    <dd>{state.turn} / {state.max_turns}</dd>
                  </div>
                  <div>
                    <dt>残り牌</dt>
                    <dd>{state.wall_remaining}</dd>
                  </div>
                </dl>
                <DoraStatus
                  doraIndicators={state.dora_indicators}
                  dora={state.dora}
                  uraDoraIndicators={state.ura_dora_indicators}
                  uraDora={state.ura_dora}
                />
              </div>
            )}
          </header>

          {error && (
            <div class="error-banner" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div class="notice-banner" role="status">
              {notice}
            </div>
          )}

          {!state && !error && (
            <p class="muted">
              {api.WASM ? '計算エンジンを読み込んでいます…' : '対局を準備しています…'}
            </p>
          )}
        </div>
        {state && (
          <>
            <div class="area-hand">
              <Hand
                hand={state.hand}
                groups={state.hand_groups}
                drawn={state.drawn}
                discards={state.discards}
                disabled={busy || state.status !== 'playing'}
                highlight={highlightTile}
                onDiscard={handleDiscard}
                onPreview={setPreviewTile}
              />
              {state.status === 'playing' && state.can_tsumo && (
                <button type="button" class="tsumo-button" onClick={handleTsumo} disabled={busy}>
                  ツモ
                </button>
              )}
              {state.status === 'exhausted' && <p class="exhausted-banner">流局（{state.max_turns}巡終了）</p>}
              {state.status === 'tsumo' && state.win && <WinPanel win={state.win} />}
            </div>
            <div class="area-chart" hidden={isMin('chart')}>
              <ShantenChart
                sessionId={state.session_id}
                history={state.history}
                currentAnalysis={state.analysis}
                rowNames={rowNames}
                minimized={isMin('chart')}
                onMinimize={minimizeChart}
              />
            </div>
          </>
        )}
      </div>
      {state && (
        <div class="area-tree" hidden={isMin('tree')}>
          <HistoryTree
            tree={state.tree}
            currentNodeId={state.node_id}
            disabled={busy}
            onGoto={handleGoto}
            minimized={isMin('tree')}
            onMinimize={minimizeTree}
          />
        </div>
      )}
      {state && (
        <SidePanels
          analysis={state.analysis}
          byDiscard={state.by_discard}
          combos={state.combos}
          combosByDiscard={state.combos_by_discard}
          previewTile={previewTile}
          mode="practice"
          isMin={isMin}
          onMinimize={minimize}
          advice={
            <AdvicePanel
              advice={state.advice}
              review={state.discard_review}
              onHighlight={setHighlightTile}
              minimized={isMin('advice')}
              onMinimize={minimizeAdvice}
            />
          }
        />
      )}
      {state && (
        <Dock
          items={docked}
          onRestore={(k) => restore(k as PanelKey)}
        />
      )}
      {/* 「このタブで続ける」 takes the session back, from where the other tab left it. */}
      {stopped && <TabStopped busy={busy} onContinue={resume} />}
    </div>
  );
}
