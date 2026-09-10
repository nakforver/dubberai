import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { buildAndValidateSegments } from './audioPipelineHelpers.mjs';

const workspace = path.resolve('.');
const fixtureDir = path.join(workspace, 'tests', 'fixtures');
const testVideo = path.join(fixtureDir, 'timing-video.mp4');

test('Editor export flow uses the real upload, status, and download APIs', async () => {
  const editorSource = await fs.readFile(
    path.join(workspace, 'src/components/Editor.tsx'),
    'utf8'
  );

  assert.ok(editorSource.includes('/api/upload-chunk'));
  assert.ok(editorSource.includes("fetch('/api/export-video'"));
  assert.ok(editorSource.includes('/api/export/status/'));
  assert.ok(editorSource.includes('/api/export/download/'));
});

function makeAudio(pathname, seconds) {
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
    '-i', `anullsrc=r=44100:cl=stereo:d=${seconds.toFixed(3)}`,
    '-t', seconds.toFixed(3), '-c:a', 'libmp3lame', '-b:a', '128k', '-y', pathname
  ]);
}

async function createSegments(segments) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dubberai-audit-'));
  const files = [];
  for (let index = 0; index < segments.length; index++) {
    const fieldname = `audio_${index}`;
    const pathname = path.join(directory, `${fieldname}.mp3`);
    makeAudio(pathname, segments[index].ttsDuration);
    files.push({ fieldname, path: pathname, size: (await fs.stat(pathname)).size });
  }
  return { files, directory };
}

test('timestamp parser accepts all project timestamp formats', () => {
  assert.equal(buildAndValidateSegments.parseTimestamp('00:00:03.500'), 3.5);
  assert.equal(buildAndValidateSegments.parseTimestamp('01:02:03,250'), 3723.25);
  assert.equal(buildAndValidateSegments.parseTimestamp('1:03.5'), 63.5);
  assert.equal(buildAndValidateSegments.parseTimestamp(63.5), 63.5);
});

test('validates subtitle timing and preserves identity and timing during translation', () => {
  const source = buildAndValidateSegments.validateSubtitleLines([
    { id: 'seg-4', start: '1:02.5', end: '1:04.0', text: 'Hello' }
  ]);

  assert.equal(source[0].id, 'seg-4');
  assert.equal(source[0].start, '1:02.5');
  assert.equal(source[0].end, '1:04.0');

  const translated = buildAndValidateSegments.mergeTranslatedSubtitleLine(
    source[0],
    { id: 'changed', start: '99:00', end: '98:00', text: 'សួស្តី' },
    0
  );
  assert.deepEqual(
    { id: translated.id, start: translated.start, end: translated.end, text: translated.text },
    { id: 'seg-4', start: '1:02.5', end: '1:04.0', text: 'សួស្តី' }
  );

  assert.throws(
    () => buildAndValidateSegments.validateSubtitleLines([
      { id: 'bad', start: '1:02.5', end: '1:02.5', text: 'Hello' }
    ]),
    /Invalid end timestamp at subtitle index 0/
  );

  const normalizedTimeline = buildAndValidateSegments.normalizeSubtitleTimeline([
    { id: '1', start: '0:50.0', end: '0:55.0', text: 'Line 1' },
    { id: '4', start: '0:57.2', end: '0:57.2', text: 'Zero duration line' },
    { id: '5', start: '1:02.0', end: '1:05.0', text: 'Line 5' }
  ]);
  assert.equal(normalizedTimeline[1].start, '0:57.200');
  assert.equal(normalizedTimeline[1].end, '1:02.000');
  const validNormalized = buildAndValidateSegments.validateSubtitleLines(normalizedTimeline);
  assert.equal(validNormalized.length, 3);
});

test('validates export metadata and selects the correct final FFmpeg audio input', () => {
  const normalized = buildAndValidateSegments.validateExportAudioMetadata([
    { key: 'audio_0', start: 12.5, end: 14.25, segmentId: 'seg-1', expectedDuration: 1.5 }
  ]);
  assert.deepEqual(
    { start: normalized[0].start, end: normalized[0].end },
    { start: '12.5', end: '14.25' }
  );

  assert.throws(
    () => buildAndValidateSegments.validateExportAudioMetadata([
      { key: 'audio_4', start: '00:00:01.000', end: '00:00:01.000' }
    ]),
    /Invalid end timestamp for audio_4/
  );

  assert.equal(buildAndValidateSegments.buildFinalAudioMap(true, []), '0:a');
  assert.equal(buildAndValidateSegments.buildFinalAudioMap(false, [{}]), '1:a');
  assert.equal(buildAndValidateSegments.buildFinalAudioMap(false, []), '');
});

test('builds a valid timeline and rejects duplicate or stale audio', async () => {
  const metadata = [
    { key: 'audio_0', start: '00:00:01.000', end: '00:00:03.000', segmentId: 'seg-1' },
    { key: 'audio_1', start: '00:00:04.000', end: '00:00:06.000', segmentId: 'seg-2' }
  ];
  const { files } = await createSegments([
    { ttsDuration: 1.9 },
    { ttsDuration: 1.8 }
  ]);
  const segments = await buildAndValidateSegments.build(files, metadata);

  assert.equal(segments.length, 2);
  assert.equal(segments[0].placementSeconds, 1);
  assert.equal(segments[1].placementSeconds, 4);
  assert.equal(segments[0].renderOrder, 1);
  assert.equal(segments[1].renderOrder, 2);

  await assert.rejects(
    () => buildAndValidateSegments.build(files, metadata.concat(metadata[0])),
    /Duplicate audio metadata key|Missing TTS audio files/
  );
  await assert.rejects(
    () => buildAndValidateSegments.build(files.slice(0, 1), metadata),
    /TTS audio files without timeline metadata|Missing TTS audio files/
  );
});

test('rejects invalid timestamps and unintended overlap', async () => {
  const badTime = [
    { key: 'audio_0', start: 'not-a-time', end: '00:00:02.000' }
  ];
  const oneSecond = await createSegments([{ ttsDuration: 1 }]);
  await assert.rejects(
    () => buildAndValidateSegments.build(oneSecond.files, badTime),
    /Invalid start timestamp/
  );

  const overlapping = [
    { key: 'audio_0', start: '00:00:00.000', end: '00:00:02.500', segmentId: 'seg-1' },
    { key: 'audio_1', start: '00:00:00.500', end: '00:00:05.000', segmentId: 'seg-2' }
  ];
  const twoSegments = await createSegments([{ ttsDuration: 1 }, { ttsDuration: 1 }]);
  const overlapSegments = await buildAndValidateSegments.build(twoSegments.files, overlapping);
  assert.throws(
    () => buildAndValidateSegments.validate(overlapSegments, 6),
    /Unintended TTS overlap/
  );
});

test('preserves intentional source overlap while rejecting TTS overrun', async () => {
  const intentional = [
    { key: 'audio_0', start: '00:00:01.000', end: '00:00:04.000' },
    { key: 'audio_1', start: '00:00:05.000', end: '00:00:07.000' }
  ];
  const valid = await createSegments([
    { ttsDuration: 2.8 },
    { ttsDuration: 1.5 }
  ]);
  const segments = await buildAndValidateSegments.build(valid.files, intentional);
  assert.equal(segments[0].ttsDuration > 2.7, true);
  assert.equal(segments[1].placementSeconds, 5);
  buildAndValidateSegments.validate(segments, 7);

  const overrun = await createSegments([{ ttsDuration: 1 }]);
  const overrunMetadata = [{ key: 'audio_0', start: '00:00:01.000', end: '00:00:01.100' }];
  await assert.rejects(
    () => buildAndValidateSegments.build(overrun.files, overrunMetadata),
    /TTS audio is too long/
  );
});

test('builds an FFmpeg filter that burns SRT subtitles with Khmer fonts', () => {
  const srtPath = '/tmp/a subtitle.srt';
  const filter = buildAndValidateSegments.buildSubtitleVideoFilter(srtPath);
  assert.match(filter, /^subtitles='/);
  assert.match(filter, /fontsdir='[^']*\/fonts'/);
  assert.match(filter, /FontName=Noto Sans Khmer/);
  assert.equal(buildAndValidateSegments.escapeFFmpegFilterPath(srtPath), '/tmp/a subtitle.srt');
});
