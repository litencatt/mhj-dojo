import type { ComponentChildren } from 'preact';
import { Dock, type DockItem } from './Dock';
import { EngineLoading } from './EngineLoading';
import { ErrorBanner, SaveFailedNotice } from './ErrorBanner';
import { ResumePanel, type ResumeItem } from './ResumePanel';
import { SettingsDialog } from './SettingsDialog';
import { SiteHeader } from './SiteHeader';
import { TabStopped } from './TabStopped';
import { useYakuTop } from '../hooks';
import type { PanelKey } from '../panels';

/** What tells practice (the default page) and a CPU game (?mode=game) apart in the shell. */
const MODES = {
  practice: { noun: '練習', newLabel: '新しい練習' },
  game: { noun: '対局', newLabel: '新規対局' },
} as const;

interface AppShellProps {
  mode: keyof typeof MODES;
  dojo?: boolean; // a dojo game: the CPU game's page, marked as the dojo in the header
  started: boolean; // a session or game is shown
  header: ComponentChildren; // the header's status, under the title row
  settings: ComponentChildren; // the 設定 dialog's contents: the new-game form, the playback speed ...
  settingsOpen: boolean;
  onSettingsOpen: (open: boolean) => void;
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

/**
 * The page around a practice session or a CPU game: the header, the error,
 * the saves offered to resume or the engine loading, the dock of minimized
 * panels and the notice that another tab took over.
 */
// A dojo game (?mode=dojo&game=) leads back to the hub, where it started (the game is saved).
const DOJO_BACK = ['?mode=dojo', '道場トップへ戻る'] as const;

export function AppShell(p: AppShellProps) {
  const m = MODES[p.mode];
  const appClass = p.started && p.docked.length > 0 ? `app app-${p.mode} has-dock` : `app app-${p.mode}`;
  // On a phone the yaku panel scrolls on its own in the height left under the
  // header and the hand (and a game's table) (styles/*.css).
  const appRef = useYakuTop(p.started);

  return (
    <div ref={appRef} class={appClass}>
      <div class="area-main">
        <div class="area-header">
          <SiteHeader mode={p.dojo ? 'dojo' : p.mode} back={p.dojo ? DOJO_BACK : undefined} onSettings={() => p.onSettingsOpen(true)} onShowGlossary={p.onShowGlossary}>
            {p.header}
          </SiteHeader>
          <SettingsDialog open={p.settingsOpen} onClose={() => p.onSettingsOpen(false)}>
            {p.settings}
          </SettingsDialog>

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
