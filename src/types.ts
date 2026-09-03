export interface SubtitleLine {
  id: string;
  start: string;
  end: string;
  text: string;
  selected: boolean;
  generated: boolean;
  audioUrl?: string;
}

export type ViewState = 'home' | 'editor' | 'settings';
