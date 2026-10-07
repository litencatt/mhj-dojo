import type { ComponentChildren } from 'preact';
import { Dock, type DockItem } from './Dock';
import { EngineLoading } from './EngineLoading';
import { ErrorBanner, SaveFailedNotice } from './ErrorBanner';
import { Help } from './Help';
import { ResumePanel, type ResumeItem } from './ResumePanel';
import { TabStopped } from './TabStopped';
import { VersionTag } from './VersionTag';
import { useYakuTop } from '../hooks';
import type { PanelKey } from '../panels';

/** What tells practice (the default page) and a CPU game (?mode=game) apart in the shell. */
const MODES = {
  practice: { subtitle: '麻雀道場', links: [['?mode=game', 'CPU対戦へ'], ['?mode=dojo', '道場へ']], noun: '練習', newLabel: '新しい練習' },
  game: { subtitle: 'CPU対戦', links: [['?', '練習へ'], ['?mode=dojo', '道場へ']], noun: '対局', newLabel: '新規対局' },
} as const;

interface AppShellProps {
  mode: keyof typeof MODES;
  dojo?: boolean; // a dojo game: the CPU game's page, with the dojo as its subtitle and link
  started: boolean; // a session or game is shown
  header: ComponentChildren; // the header's new-game form and status, after the version and help
  main: ComponentChildren; // under the header: the hand, the chart ...
  children?: ComponentChildren; // beside the main area: the side panels
  docked: DockItem[]; // the minimized panels
  onRestore: (key: PanelKey) => void;
  onShowGlossary?: () => void; // none: Help has no link to the glossary
  offered: ResumeItem[]; // see useOffered
  onOpen: (item: ResumeItem) => void;
  busy: boolean;
  error: string | null;
  onRetry?: () => void; // none: a retry would fail the same way
  stopped: boolean; // another tab took the session or game over
  onContinue: () => void;
}

/** A dojo game (?mode=dojo&game=): the game's layout and styles, the dojo's names, and a link back to the hub only (the game is saved; 練習 and CPU対戦 are there). */
const DOJO_MODE = { subtitle: '道場', links: [['?mode=dojo', '道場へ戻る']], noun: '対局', newLabel: '新規対局' } as const;

/**
 * The page around a practice session or a CPU game: the header, the error,
 * the saves offered to resume or the engine loading, the dock of minimized
 * panels and the notice that another tab took over.
 */
export function AppShell(p: AppShellProps) {
  const m = p.dojo ? DOJO_MODE : MODES[p.mode];
  const appClass = p.started && p.docked.length > 0 ? `app app-${p.mode} has-dock` : `app app-${p.mode}`;
  // On a phone the yaku panel scrolls on its own in the height left under the
  // header and the hand (and a game's table) (style.css).
  const appRef = useYakuTop(p.started);

  return (
    <div ref={appRef} class={appClass}>
      <div class="area-main">
        <div class="area-header">
          <header class="app-header">
            <h1>
              mhj-dojo <span class="app-subtitle">{m.subtitle}</span>
              {m.links.map(([href, label]) => (
                <a key={href} class="mode-link" href={href}>{label}</a>
              ))}
            </h1>
            <div class="header-meta">
              <VersionTag />
              <Help onShowGlossary={p.onShowGlossary} />
            </div>
            {p.header}
          </header>

          {/* 再試行 only for an engine failure: a refused request would fail again. */}
          {p.error && <ErrorBanner message={p.error} busy={p.busy} onRetry={p.onRetry} />}
          <SaveFailedNotice />

          {!p.started && p.offered.length > 0 && (
            <ResumePanel noun={m.noun} newLabel={m.newLabel} items={p.offered} busy={p.busy} onOpen={p.onOpen} />
          )}

          {!p.started && !p.error && p.offered.length === 0 && (
            <EngineLoading />
          )}
        </div>
        {p.main}
      </div>
      {p.children}
      {p.started && (
        <Dock
          items={p.docked}
          onRestore={(k) => p.onRestore(k as PanelKey)}
        />
      )}
      {/* 「このタブで続ける」 takes the session or game back, from where the other tab left it. */}
      {p.stopped && <TabStopped busy={p.busy} onContinue={p.onContinue} />}
    </div>
  );
}
