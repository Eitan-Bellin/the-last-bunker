#!/usr/bin/env node
// Re-print or compare saved simulator results:
//   node tools/sim/report.mjs store/sim/baseline-casual.json                    -> the summary again
//   node tools/sim/report.mjs store/sim/baseline-casual.json after-casual.json  -> side-by-side medians (A = first)
import { readFileSync } from 'node:fs';
import { compareReport, textReport } from './report-core.mjs';

const [fa, fb] = process.argv.slice(2);
if (!fa) {
  console.log('usage: node tools/sim/report.mjs result.json [other.json]');
  process.exit(1);
}
const a = JSON.parse(readFileSync(fa, 'utf8'));
console.log(fb ? compareReport(a, JSON.parse(readFileSync(fb, 'utf8'))) : textReport(a));
