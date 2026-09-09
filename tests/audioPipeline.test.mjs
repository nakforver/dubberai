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
