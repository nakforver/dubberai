export interface CharacterProfile {
  id: string;
  name: string;
  gender: 'female' | 'male';
  voiceSource: 'video' | 'upload' | 'clean_ai';
  referenceAudioBase64?: string | null;
  audioPreviewUrl?: string | null;
  videoTimestamp?: { start: number; duration: number };
  videoTime?: string;
}

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
}

export type ViewState = 'home' | 'editor' | 'settings';
