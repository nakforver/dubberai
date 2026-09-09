import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const helpers = require('../dist/server.test.cjs');
export const buildAndValidateSegments = {
  parseTimestamp: helpers.parseTimestamp,
  build: helpers.buildRenderedAudioSegments,
  validate: helpers.validateSegmentTimeline,
  escapeFFmpegFilterPath: helpers.escapeFFmpegFilterPath,
  buildSubtitleVideoFilter: helpers.buildSubtitleVideoFilter,
  validateSubtitleLines: helpers.validateSubtitleLines,
  mergeTranslatedSubtitleLine: helpers.mergeTranslatedSubtitleLine,
  validateExportAudioMetadata: helpers.validateExportAudioMetadata,
  buildFinalAudioMap: helpers.buildFinalAudioMap
};
