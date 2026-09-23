// Chooses between the real API (production, and normal dev use) and the
// in-browser mock fixture (dev-only, opt-in via `?mock=1`). The mock branch
// is gated on import.meta.env.DEV, which Vite statically replaces with
// `false` in production builds, so the dead branch — and the mock module
// itself — is stripped from the production bundle.
import * as realApi from './api';
export type { ApiError, State, YakuRow, UkeireEntry, HistoryEntry, TreeNode, Win, WinYaku, NodeStatus, Tile } from './api';

const useMock = import.meta.env.DEV && new URLSearchParams(location.search).get('mock') === '1';

async function mockModule() {
  return import('./mock');
}

export async function createSession(opts: { seed?: number; max_turns?: number } = {}): Promise<realApi.State> {
  if (useMock) return (await mockModule()).mockCreateSession(opts);
  return realApi.createSession(opts);
}

export async function getSession(id: string): Promise<realApi.State> {
  if (useMock) return (await mockModule()).mockGetSession(id);
  return realApi.getSession(id);
}

export async function discard(id: string, tile: string): Promise<realApi.State> {
  if (useMock) return (await mockModule()).mockDiscard(id, tile);
  return realApi.discard(id, tile);
}

export async function tsumo(id: string): Promise<realApi.State> {
  if (useMock) return (await mockModule()).mockTsumo(id);
  return realApi.tsumo(id);
}

export async function goto(id: string, nodeId: number): Promise<realApi.State> {
  if (useMock) return (await mockModule()).mockGoto(id, nodeId);
  return realApi.goto(id, nodeId);
}

export const isMock = useMock;
