// ego-only runner. Reuses the assigned TaskSpace and an existing local server.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function runEgoChecks(layoutOnly = false) {
  const space = Number(process.env.EGO_SPACE);
  if (!Number.isInteger(space) || space < 1) throw Error('Set EGO_SPACE to an assigned ego TaskSpace; no second browser is launched');
  const base = process.env.EGO_BASE || 'http://127.0.0.1:4176/';
  const out = path.resolve(process.env.EGO_OUT || '.smoke-out/轻量演示');
  fs.mkdirSync(out, { recursive: true });
  const script = fs.readFileSync(new URL('./轻量演示-ego.js', import.meta.url), 'utf8');
  const input = `const config=${JSON.stringify({space,base,out,layoutOnly})};\n${script}`;
  const reportPath = path.join(out, 'result.json');
  fs.rmSync(reportPath, {force:true});
  const result = spawnSync('ego-browser', ['nodejs'], { input, encoding: 'utf8', timeout: 240000, maxBuffer: 8*1024*1024 });
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
  if (result.error) throw result.error;
  if (result.status !== 0) { process.exitCode = result.status || 1; return; }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  if (report.base !== base || report.layoutOnly !== layoutOnly || report.count !== (layoutOnly ? 35 : 50) || !report.checks.every(c => c.ok)) throw Error('Ego report incomplete');
  console.log(`PASS ${report.count} Ego checks; report: ${reportPath}`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) runEgoChecks(process.argv.includes('--layout'));
