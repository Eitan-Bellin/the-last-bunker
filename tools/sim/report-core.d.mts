// Types for report-core.mjs (plain JS so Node can run it without a build step).
import type { SimResult } from './core';

export interface SimFile {
  meta: Record<string, unknown> & { mode: string; hours?: number; days?: number; think: number };
  runs: SimResult[];
  aggregate?: unknown;
}
export const KEY_MILESTONES: string[];
export function fmtT(sec: number | null | undefined): string;
export function aggregate(runs: SimResult[]): unknown;
export function textReport(data: SimFile): string;
export function compareReport(a: SimFile, b: SimFile): string;
