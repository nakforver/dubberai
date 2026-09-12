export interface SpeakerProfile {
  id: string; // e.g. "speaker_001", "speaker_002"
  name: string; // e.g. "Speaker 1 (ស្រី)", "Speaker 2 (ប្រុស)"
  gender: 'female' | 'male';
  voiceSource: 'video' | 'upload' | 'clean_ai';
  referenceAudioBase64?: string | null;
  audioPreviewUrl?: string | null;
  refText?: string;
  refStart?: number;
  refEnd?: number;
  videoTimestamp?: { start: number; duration: number };
  videoTime?: string;
}

// Backward-compatible alias
export type CharacterProfile = SpeakerProfile;

export interface SubtitleLine {
  id: string;
  start: string;
  end: string;
  text: string;
  selected: boolean;
  generated: boolean;
  audioUrl?: string;
  audioDuration?: number;
  gender?: 'female' | 'male';
  speaker?: string; // e.g. "speaker_001"
  speakerName?: string; // e.g. "Speaker 1"
}

export type ViewState = 'home' | 'editor' | 'settings';
