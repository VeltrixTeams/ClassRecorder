export type LectureStatus =
  | "uploading"
  | "queued"
  | "preparing"
  | "transcribing"
  | "summarizing"
  | "indexing"
  | "ready"
  | "failed";

export interface Course {
  id: string;
  name: string;
  instructor?: string | null;
  color: number;
  schedule: { dow: number; start: string; end: string }[];
  vocabulary: string[];
  created_at: string;
}

export interface Lecture {
  id: string;
  course_id: string | null;
  title: string | null;
  recorded_at: string;
  duration_ms: number | null;
  status: LectureStatus;
  progress: { step: string; done: number; total: number } | null;
  error: string | null;
  chunk_count: number | null;
  audio_path: string | null;
  mime_type: string | null;
  created_at: string;
}

export interface TranscriptSegment {
  id: number;
  lecture_id: string;
  start_ms: number;
  end_ms: number;
  speaker: "lecturer" | "student";
  text: string;
  words?: unknown;
}

export interface SummaryPoint {
  text: string;
  t: number;
}
export interface SummaryContent {
  overview: string;
  topics: { title: string; points: SummaryPoint[] }[];
  definitions: { term: string; meaning: string; t: number }[];
  examples: SummaryPoint[];
  emphasized: SummaryPoint[];
  assignments: { task: string; due: string | null; t: number }[];
}
export interface Summary {
  lecture_id: string;
  lang: "th" | "en";
  content: SummaryContent;
  edited: boolean;
  stale: boolean;
}

export interface Bookmark {
  id: string;
  lecture_id: string;
  t_ms: number;
  note?: string | null;
  image_path?: string | null;
  created_at: string;
}

export interface SearchResult {
  lecture_id: string;
  course_id: string | null;
  start_ms: number;
  end_ms: number;
  text: string;
  score: number;
}

export interface VocabularyItem {
  id: string;
  course_id: string | null;
  term: string;
  meaning: string;
  lecture_id: string | null;
  t_ms: number | null;
}

export interface Profile {
  user_id: string;
  timezone: string;
  retention_days: number;
  push_subscription?: unknown;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface Citation {
  lecture_id: string;
  start_ms: number;
}

export interface ApiError {
  error: { code: string; message: string };
}
