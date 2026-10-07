import type { ComponentChildren } from 'preact';
import { Help, type HelpMode } from './Help';
import { VersionTag } from './VersionTag';

// The three modes, linked from every page's header (a dojo game's 道場 leads back to the hub).
const MODE_LINKS: readonly (readonly [HelpMode, string, string])[] = [
  ['practice', '?', '練習'],
  ['game', '?mode=game', 'CPU対戦'],
  ['dojo', '?mode=dojo', '道場'],
];

interface SiteHeaderProps {
  mode: HelpMode; // the page's mode: marked among the links, and explained by the help
  onSettings?: () => void; // opens the mode's 設定 dialog; none: no 設定 button
  onShowGlossary?: () => void; // none: Help has no link to the glossary
  children?: ComponentChildren; // under the title row: the session's or game's status
}

/** Every mode's header: the title and the three modes (this one marked), then the version, 設定 and help. */
export function SiteHeader({ mode, onSettings, onShowGlossary, children }: SiteHeaderProps) {
  return (
    <header class="app-header">
      <h1>
        mhj-dojo
        {MODE_LINKS.map(([m, href, label]) => (
          <a key={m} class="mode-link" href={href} aria-current={m === mode ? 'page' : undefined}>
            {label}
          </a>
        ))}
      </h1>
      <div class="header-meta">
        <VersionTag />
        {onSettings && (
          <button type="button" class="settings-button" aria-haspopup="dialog" onClick={onSettings}>
            設定
          </button>
        )}
        <Help mode={mode} onShowGlossary={onShowGlossary} />
      </div>
      {children}
    </header>
  );
}
