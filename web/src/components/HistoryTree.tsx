import { memo } from 'preact/compat';
import type { TreeNode } from '../api';
import { Tile } from './Tile';
import { PanelHeading } from './PanelHeading';

export interface HistoryTreeProps {
  onMinimize?: () => void;
  minimized?: boolean; // in the dock: nothing is drawn
  tree: TreeNode[];
  currentNodeId: number;
  disabled: boolean;
  onGoto: (nodeId: number) => void;
}

function shantenLabel(s: number | null): string {
  if (s === null) return '?';
  if (s === -1) return '和了';
  if (s === 0) return '聴牌';
  return `${s}向聴`;
}

function statusMark(status: TreeNode['status']): string {
  if (status === 'tsumo') return '🀄ツモ';
  if (status === 'exhausted') return '流局';
  return '';
}

interface Row {
  node: TreeNode;
  depth: number;
  isBranchStart: boolean; // one of >=2 siblings (a fork child)
}

/** 履歴ツリー: every branch ever created from this seed's wall. Click to goto.
 * Only fork points add indentation — a long single-child chain stays flat, so
 * an 18-turn straight line renders as a compact vertical list, not a staircase. */
export const HistoryTree = memo(function HistoryTree(props: HistoryTreeProps) {
  const { tree, currentNodeId, disabled, onGoto, onMinimize, minimized } = props;
  if (minimized) return null;
  const byParent = new Map<number | null, TreeNode[]>();
  const byId = new Map<number, TreeNode>();
  for (const n of tree) {
    byId.set(n.node_id, n);
    const list = byParent.get(n.parent_id) ?? [];
    list.push(n);
    byParent.set(n.parent_id, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.node_id - b.node_id);

  const currentPath = new Set<number>();
  let cursor: TreeNode | undefined = byId.get(currentNodeId);
  while (cursor) {
    currentPath.add(cursor.node_id);
    cursor = cursor.parent_id === null ? undefined : byId.get(cursor.parent_id);
  }

  const rows: Row[] = [];
  function flatten(nodeId: number, depth: number, isBranchStart: boolean) {
    let node: TreeNode | undefined = byId.get(nodeId);
    let first = true;
    while (node) {
      rows.push({ node, depth, isBranchStart: first && isBranchStart });
      first = false;
      const children = byParent.get(node.node_id) ?? [];
      if (children.length === 1) {
        node = children[0];
      } else {
        for (const child of children) flatten(child.node_id, depth + 1, true);
        node = undefined;
      }
    }
  }
  const roots = byParent.get(null) ?? [];
  for (const r of roots) flatten(r.node_id, 0, false);

  return (
    <section class="tree-panel" aria-label="履歴ツリー">
      <PanelHeading title="履歴ツリー" onMinimize={onMinimize} />
      <ul class="tree-flat">
        {rows.map(({ node, depth, isBranchStart }) => {
          const isCurrent = node.node_id === currentNodeId;
          const onPath = currentPath.has(node.node_id);
          const isRoot = node.parent_id === null;
          return (
            <li
              key={node.node_id}
              class={`tree-row ${onPath ? 'tree-on-path' : ''} ${isBranchStart ? 'tree-branch-start' : ''}`}
              style={{ marginLeft: `${depth * 16}px` }}
            >
              <button
                type="button"
                class={`tree-node-btn ${isCurrent ? 'tree-current' : ''}`}
                disabled={disabled}
                onClick={() => onGoto(node.node_id)}
                aria-current={isCurrent ? 'true' : undefined}
              >
                {isRoot ? (
                  <span class="tree-node-label">配牌</span>
                ) : (
                  <>
                    <span class="tree-node-turn">{node.turn}巡</span>
                    {node.discard && <Tile tile={node.discard} size="xs" />}
                  </>
                )}
                <span class="tree-node-shanten">{shantenLabel(node.normal_shanten)}</span>
                {node.status !== 'playing' && <span class="tree-node-status">{statusMark(node.status)}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
});
