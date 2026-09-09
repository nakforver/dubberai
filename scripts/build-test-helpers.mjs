import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const source = fs.readFileSync('server.ts', 'utf8');
const endpointIndex = source.indexOf("app.post('/api/transcribe/start'");
if (endpointIndex < 0) throw new Error('server start marker not found');

const temporaryPath = path.join('dist', 'server.test.ts');
const outputPath = path.join('dist', 'server.test.cjs');
fs.mkdirSync(path.dirname(temporaryPath), { recursive: true });
fs.writeFileSync(
  temporaryPath,
  source.slice(0, endpointIndex) +
    '\nexport { parseTimestamp, buildRenderedAudioSegments, validateSegmentTimeline, escapeFFmpegFilterPath, buildSubtitleVideoFilter };\n'
);
execFileSync('npx', ['esbuild', temporaryPath, '--bundle', '--platform=node', '--format=cjs', `--outfile=${outputPath}`], { stdio: 'inherit' });
