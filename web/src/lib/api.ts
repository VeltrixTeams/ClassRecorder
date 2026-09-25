import { getAccessToken } from "./supabase";
import { consumeSseStream } from "./sse";
import type {
  Course,
  Lecture,
  TranscriptSegment,
  Summary,
  Bookmark,
  SearchResult,
  VocabularyItem,
  Profile,
  ChatMessage,
  Citation,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL!;

export class ApiClientError extends Error {
  code: string;
  status: number;
  /** Raw JSON body of the error response (e.g. {missing:[idx]} on 409). */
  body: unknown;
  constructor(status: number, code: string, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token ?? ""}`);
  if (init.body && !(init.body instanceof Blob)) headers.set("Content-Type", "application/json");
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (res.status === 204) return undefined as T;
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : undefined;
  if (!res.ok) {
    const err = data?.error ?? { code: "unknown", message: res.statusText };
    throw new ApiClientError(res.status, err.code, err.message, data);
  }
  return data as T;
}

const j = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

export const api = {
  // courses
  listCourses: () => request<Course[]>("/courses"),
  createCourse: (body: Partial<Course>) => request<Course>("/courses", { method: "POST", ...j(body) }),
  updateCourse: (id: string, body: Partial<Course>) =>
    request<Course>(`/courses/${id}`, { method: "PATCH", ...j(body) }),
  deleteCourse: (id: string) => request<void>(`/courses/${id}`, { method: "DELETE" }),

  // lectures
  createLecture: (body: { course_id?: string; title?: string; recorded_at: string }) =>
    request<Lecture>("/lectures", { method: "POST", ...j(body) }),
  uploadUrls: (lectureId: string, indices: number[]) =>
    request<{ urls: { idx: number; url: string; path: string }[] }>(
      `/lectures/${lectureId}/upload-urls`,
      { method: "POST", ...j({ indices }) }
    ),
  completeLecture: (lectureId: string, chunk_count: number, checksums: string[]) =>
    request<Lecture>(`/lectures/${lectureId}/complete`, {
      method: "POST",
      ...j({ chunk_count, checksums }),
    }),
  listLectures: (params?: { course_id?: string; cursor?: string }) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return request<Lecture[]>(`/lectures${qs ? `?${qs}` : ""}`);
  },
  getLecture: (id: string) => request<Lecture>(`/lectures/${id}`),
  audioUrl: (id: string) => request<{ url: string }>(`/lectures/${id}/audio-url`),
  transcript: (id: string, afterMs?: number, limit = 200) => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (afterMs != null) qs.set("after_ms", String(afterMs));
    return request<TranscriptSegment[]>(`/lectures/${id}/transcript?${qs}`);
  },
  summary: (id: string, lang: "th" | "en" = "th") =>
    request<Summary>(`/lectures/${id}/summary?lang=${lang}`),
  updateSummary: (id: string, content: unknown) =>
    request<Summary>(`/lectures/${id}/summary`, { method: "PATCH", ...j({ content }) }),
  addBookmark: (id: string, body: { t_ms: number; note?: string; image_path?: string }) =>
    request<Bookmark>(`/lectures/${id}/bookmarks`, { method: "POST", ...j(body) }),
  retryLecture: (id: string) => request<void>(`/lectures/${id}/retry`, { method: "POST" }),
  deleteLecture: (id: string) => request<void>(`/lectures/${id}`, { method: "DELETE" }),

  // search
  search: (q: string, params?: { course_id?: string; from?: string; to?: string }) => {
    const qs = new URLSearchParams({ q, ...(params as Record<string, string>) });
    return request<SearchResult[]>(`/search?${qs}`);
  },

  // vocabulary
  listVocabulary: () => request<VocabularyItem[]>("/vocabulary"),
  addVocabulary: (body: Partial<VocabularyItem>) =>
    request<VocabularyItem>("/vocabulary", { method: "POST", ...j(body) }),
  deleteVocabulary: (id: string) => request<void>(`/vocabulary/${id}`, { method: "DELETE" }),

  // profile
  getMe: () => request<Profile>("/me"),
  updateMe: (body: Partial<Profile>) => request<Profile>("/me", { method: "PUT", ...j(body) }),
  deleteMe: () => request<void>("/me", { method: "DELETE" }),

  // chat (SSE)
  async chat(
    body: { question: string; scope: "lecture" | "course" | "all"; scope_id?: string; history: ChatMessage[] },
    handlers: { onDelta: (text: string) => void; onCitations: (c: Citation[]) => void; onDone: () => void }
  ) {
    const token = await getAccessToken();
    const res = await fetch(`${API_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => null);
      throw new ApiClientError(res.status, data?.error?.code ?? "unknown", data?.error?.message ?? res.statusText);
    }
    await consumeSseStream(res.body, (evt) => {
      if (evt.type === "delta") handlers.onDelta(evt.delta);
      else if (evt.type === "citations") handlers.onCitations(evt.citations);
      else handlers.onDone();
    });
  },
};
