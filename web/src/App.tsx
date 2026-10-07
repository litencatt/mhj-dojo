import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import * as api from './api';
import type { SessionState } from './api';
import { Hand } from './components/Hand';
import { ShantenChart } from './components/ShantenChart';
import { HistoryTree } from './components/HistoryTree';
import { WinPanel } from './components/WinPanel';
import { DoraStatus } from './components/DoraStatus';
import { SidePanels } from './components/SidePanels';
import { AdvicePanel } from './components/AdvicePanel';
import { AppShell } from './components/AppShell';
import { PANELS, focusGlossary, optionalInt, useMinimized } from './panels';
import {
  useOffered,
  useRowNames,
  useSerialRequest,
  useSingleTab,
  useStableCallback,
  useUrlResume,
} from './hooks';
import { claim } from './singleTab';
import { savedSessions } from './wasm';

export function App() {
  const [state, setState] = useState<SessionState | null>(null);
  const [previewTile, setPreviewTile] = useState<string | null>(null);
  const [highlightTile, setHighlightTile] = useState<string | null>(null);
  const [seedInput, setSeedInput] = useState('');
  const [maxTurnsInput, setMaxTurnsInput] = useState('18');
  // 設定 (the header's button) opens the new-practice form in a modal dialog; a new session closes it.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const shownSession = useRef<string | null>(null);
  const { minimized, isMin, minimize, restore } = useMinimized();
  // Opened with no session or seed in the URL: the saved sessions, if any,
  // are offered instead of a new one.
  const offered = useOffered(() =>
    savedSessions().map((s) => ({
      id: s.id,
      label: `シード ${s.seed}`,
      used: s.used,
      params: { seed: String(s.seed), turns: String(s.maxTurns) },
    })),
  );
  const adviceOpen = !isMin('advice');
  // The states that came with the advice (see load).
  const withAdvice = useRef(new WeakSet<SessionState>());

  // Runs a session call with the view the page needs (docs/api.md "View
  // options"): the advice only while its panel is open, and with prev (the
  // state shown, of the same session) only the tree nodes it lacks. The
  // state returned carries the whole tree: prev's nodes and the new ones,
  // or, should they not add up to node_count, the tree asked for afresh.
  async function load(call: (view: api.SessionView) => Promise<SessionState>, prev: SessionState | null) {
    const view = { advice: adviceOpen, treeFrom: prev ? prev.tree.length : 0 };
    let next = await call(view);
    if (prev && view.treeFrom > 0) {
      const tree = next.session_id === prev.session_id ? [...prev.tree.slice(0, view.treeFrom), ...next.tree] : [];
      next =
        tree.length === next.node_count
          ? { ...next, tree }
          : await api.getSession(next.session_id, { advice: view.advice, treeFrom: 0 });
    }
    if (view.advice) withAdvice.current.add(next);
    return next;
  }

  const { busy, error, retryable, request, retry } = useSerialRequest<SessionState>(
    (next) => {
      if (shownSession.current !== next.session_id) {
        shownSession.current = next.session_id;
        setSettingsOpen(false);
      }
      setState(next);
      setPreviewTile(null);
      setHighlightTile(null);
    },
  );
  const stopped = useSingleTab(state ? api.sessionKey(state.session_id) : null);

  // A state shown while the advice panel was minimized came without the
  // advice: opening the panel asks for it (once per state), apart from the
  // serial requests (nothing else waits on it, and the preview stays). The
  // answer fills in the advice and the review only if the state shown is
  // still the one asked about, at the same node: had the session moved on
  // (another browser), the next request shows that.
  const adviceAsked = useRef<SessionState | null>(null);
  useEffect(() => {
    if (!state || !adviceOpen || busy || stopped || withAdvice.current.has(state) || adviceAsked.current === state) return;
    const asked = state;
    adviceAsked.current = asked;
    api.getSession(asked.session_id, { advice: true, treeFrom: asked.tree.length }).then(
      (got) =>
        setState((cur) => {
          if (cur !== asked || got.session_id !== asked.session_id || got.node_id !== asked.node_id) return cur;
          const next = { ...cur, advice: got.advice, discard_review: got.discard_review };
          withAdvice.current.add(next);
          return next;
        }),
      () => {
        // Stopped by another tab, or failed: the panel stays as it is.
      },
    );
  }, [state, adviceOpen, busy, stopped]);

  function startGame(seed?: number, maxTurns?: number) {
    return request(() => load((v) => api.createSession({ seed, max_turns: maxTurns ?? 18 }, v), null));
  }

  // The URL carries ?session=&seed=&turns= so a reload resumes the session,
  // or replays the same wall from the seed when it has no save (404).
  const { resume, open } = useUrlResume({
    idKey: 'session',
    offering: offered.length > 0,
    request,
    get: (id) => {
      // Before asking for it, so that another tab stops saving it first.
      claim(api.sessionKey(id));
      return load((v) => api.getSession(id, v), null);
    },
    create: (params) =>
      load(
        (v) =>
          api.createSession({ seed: optionalInt(params.get('seed')), max_turns: optionalInt(params.get('turns')) ?? 18 }, v),
        null,
      ),
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
    void request(() => load((v) => api.discard(state.session_id, tile, state.node_id, v), state));
  }

  function handleTsumo() {
    if (!state) return;
    void request(() => load((v) => api.tsumo(state.session_id, state.node_id, v), state));
  }

  const handleGoto = useStableCallback((nodeId: number) => {
    if (!state) return;
    void request(() => load((v) => api.goto(state.session_id, nodeId, v), state));
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

  return (
    <AppShell
      mode="practice"
      settings={
        <form class="new-game-form" onSubmit={handleNewGame}>
          <fieldset class="dojo-settings-group option-group">
            <legend>シード</legend>
            <input
              type="number"
              aria-label="シード"
              value={seedInput}
              placeholder="ランダム"
              onInput={(e) => setSeedInput((e.target as HTMLInputElement).value)}
            />
          </fieldset>
          <fieldset class="dojo-settings-group option-group">
            <legend>最大巡目</legend>
            <input
              type="number"
              aria-label="最大巡目"
              class="input-narrow"
              min={1}
              value={maxTurnsInput}
              onInput={(e) => setMaxTurnsInput((e.target as HTMLInputElement).value)}
            />
          </fieldset>
          <button type="submit" disabled={busy}>新しい練習</button>
        </form>
      }
      settingsOpen={settingsOpen}
      onSettingsOpen={setSettingsOpen}
      started={!!state}
      docked={docked}
      onRestore={restore}
      onShowGlossary={() => {
        restore('gloss');
        focusGlossary();
      }}
      offered={offered}
      onOpen={(s) => open(s.id, s.params)}
      busy={busy}
      error={error}
      onRetry={retryable ? () => retry(resume) : undefined}
      stopped={stopped}
      onContinue={resume}
      header={
        <>
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
        </>
      }
      main={
        state && (
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
        )
      }
    >
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
          remaining={state.remaining}
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
    </AppShell>
  );
}
