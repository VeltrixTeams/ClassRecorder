"use client";
import { useEffect, useRef, useState, use as usePromise } from "react";
import { useRouter } from "next/navigation";
import { useRequireAuth } from "@/lib/useAuth";
import { api, ApiClientError } from "@/lib/api";
import type { Lecture, Summary, TranscriptSegment, ChatMessage, Citation } from "@/lib/types";
import { TimeChip } from "@/components/TimeChip";
import { usePlayer } from "@/components/AudioPlayer";
import { StatusBadge } from "@/components/StatusBadge";
import { ChevronLeftIcon, SparkleIcon, StarIcon, ClipboardIcon } from "@/components/icons";
import { formatSec } from "@/lib/format";
import styles from "./page.module.css";

const RUNNING_STATUSES = ["uploading", "queued", "preparing", "transcribing", "summarizing", "indexing"];

type Tab = "summary" | "transcript" | "chat";

export default function LecturePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const session = useRequireAuth();
  const router = useRouter();
  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [tab, setTab] = useState<Tab>("summary");
  const [lang, setLang] = useState<"th" | "en">("th");

  // poll GET /lectures/{id} every 5s while not ready/failed
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const load = async () => {
      const l = await api.getLecture(id);
      if (!cancelled) setLecture(l);
      return l;
    };
    load();
    const interval = setInterval(async () => {
      const l = await load();
      if (l.status === "ready" || l.status === "failed") clearInterval(interval);
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [id, session]);

  const { setSrc } = usePlayer();
  useEffect(() => {
    if (lecture?.status === "ready") {
      api.audioUrl(id).then((r) => setSrc(r.url));
    }
  }, [lecture?.status, id, setSrc]);

  if (session === undefined || !lecture) return null;

  const isRunning = RUNNING_STATUSES.includes(lecture.status);
  const isFailed = lecture.status === "failed";

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <div className={styles.crumb}>
          <button className={styles.iconBtn} aria-label="กลับ" onClick={() => router.push("/")}>
            <ChevronLeftIcon />
          </button>
          <span className={styles.meta}>คาบเรียน</span>
        </div>
        <h1 className={styles.title}>{lecture.title || "คาบเรียน"}</h1>
        <p className={styles.meta}>
          <span className={styles.dot} style={{ background: "#4C7BD9" }} />
          {new Date(lecture.recorded_at).toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short" })}
          {lecture.duration_ms ? ` · ${formatSec(lecture.duration_ms / 1000)}` : ""}
          {" · "}
          <StatusBadge status={lecture.status} progress={lecture.progress} />
        </p>

        {!isRunning && !isFailed && (
          <div className={styles.tabs} role="tablist">
            <button
              className={styles.tab}
              role="tab"
              aria-selected={tab === "summary"}
              onClick={() => setTab("summary")}
            >
              สรุป
            </button>
            <button
              className={styles.tab}
              role="tab"
              aria-selected={tab === "transcript"}
              onClick={() => setTab("transcript")}
            >
              ถอดความ
            </button>
            <button className={styles.tab} role="tab" aria-selected={tab === "chat"} onClick={() => setTab("chat")}>
              ถามเอไอ
            </button>
            {tab === "summary" && (
              <div className={styles.lang} aria-label="ภาษาสรุป">
                <button aria-pressed={lang === "th"} onClick={() => setLang("th")}>
                  TH
                </button>
                <button aria-pressed={lang === "en"} onClick={() => setLang("en")}>
                  EN
                </button>
              </div>
            )}
          </div>
        )}
      </header>

      {isRunning && (
        <div className={styles.retryWrap}>
          <p>
            กำลังประมวลผล — <StatusBadge status={lecture.status} progress={lecture.progress} />
          </p>
        </div>
      )}

      {isFailed && (
        <div className={styles.retryWrap}>
          <p>{lecture.error || "เกิดข้อผิดพลาดระหว่างประมวลผล"}</p>
          <button
            className={styles.retryBtn}
            onClick={async () => {
              await api.retryLecture(id);
              const l = await api.getLecture(id);
              setLecture(l);
            }}
          >
            ลองอีกครั้ง
          </button>
        </div>
      )}

      {!isRunning && !isFailed && tab === "summary" && <SummaryPanel lectureId={id} lang={lang} />}
      {!isRunning && !isFailed && tab === "transcript" && <TranscriptPanel lectureId={id} />}
      {!isRunning && !isFailed && tab === "chat" && <ChatPanel lectureId={id} />}
    </div>
  );
}

function SummaryPanel({ lectureId, lang }: { lectureId: string; lang: "th" | "en" }) {
  // Tagged with the request key so a stale summary is never shown after lectureId/lang changes.
  const key = `${lectureId}:${lang}`;
  const [loaded, setLoaded] = useState<{ key: string; summary: Summary } | null>(null);
  useEffect(() => {
    api.summary(lectureId, lang).then((summary) => setLoaded({ key, summary }));
  }, [lectureId, lang, key]);
  const summary = loaded?.key === key ? loaded.summary : null;
  if (!summary) return <div className={styles.panel}>กำลังโหลด…</div>;
  const c = summary.content;
  return (
    <main className={styles.panel} role="tabpanel">
      <p className={styles.disclose}>
        <SparkleIcon />
        สรุปโดย AI — กดเวลาเพื่อฟังเสียงจริงตรงจุดนั้นได้ทุกข้อ
      </p>

      <section>
        <h2 className={styles.h2}>ภาพรวม</h2>
        <p className={styles.overview}>{c.overview}</p>
      </section>

      <section>
        <h2 className={styles.h2}>หัวข้อ</h2>
        {c.topics.map((topic) => (
          <div key={topic.title}>
            <h3 className={styles.h3}>{topic.title}</h3>
            <ul className={styles.pts}>
              {topic.points.map((p, i) => (
                <li key={i}>
                  <span>{p.text}</span>
                  <TimeChip tMs={p.t * 1000} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {c.definitions.length > 0 && (
        <section>
          <h2 className={styles.h2}>นิยาม</h2>
          <div className={styles.dl}>
            {c.definitions.map((d, i) => (
              <div key={i} className={styles.dlRow}>
                <div className={styles.dt}>{d.term}</div>
                <div className={styles.dd}>{d.meaning}</div>
                <div className={styles.dlChip}>
                  <TimeChip tMs={d.t * 1000} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {c.examples.length > 0 && (
        <section>
          <h2 className={styles.h2}>ตัวอย่าง</h2>
          <ul className={styles.pts}>
            {c.examples.map((e, i) => (
              <li key={i}>
                <span>{e.text}</span>
                <TimeChip tMs={e.t * 1000} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {c.emphasized.length > 0 && (
        <section>
          <h2 className={styles.h2}>
            <StarIcon />
            อาจารย์เน้น
          </h2>
          <ul className={`${styles.pts} ${styles.emph}`}>
            {c.emphasized.map((e, i) => (
              <li key={i}>
                <span>{e.text}</span>
                <TimeChip tMs={e.t * 1000} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {c.assignments.length > 0 && (
        <section>
          <h2 className={styles.h2}>
            <ClipboardIcon />
            งานที่สั่ง
          </h2>
          <ul className={styles.pts}>
            {c.assignments.map((t, i) => (
              <li key={i}>
                <label className={styles.task}>
                  <input type="checkbox" />
                  <span>
                    {t.task}
                    {t.due && (
                      <>
                        <br />
                        <span className={styles.due}>ส่ง {t.due}</span>
                      </>
                    )}
                  </span>
                </label>
                <TimeChip tMs={t.t * 1000} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function TranscriptPanel({ lectureId }: { lectureId: string }) {
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [follow, setFollow] = useState(true);
  const { currentTime, playing } = usePlayer();

  useEffect(() => {
    api.transcript(lectureId).then(setSegments);
  }, [lectureId]);

  const currentMs = currentTime * 1000;

  return (
    <main className={styles.panel} role="tabpanel">
      <div className={styles.follow}>
        <span>อาจารย์ · นักศึกษา</span>
        <label className={styles.switch}>
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          เลื่อนตามเสียง
        </label>
      </div>
      <div>
        {segments.map((s) => {
          const isNow = currentMs >= s.start_ms && currentMs < s.end_ms;
          return (
            <TranscriptLine key={s.id} segment={s} isNow={isNow} follow={follow && playing} />
          );
        })}
      </div>
    </main>
  );
}

function TranscriptLine({
  segment,
  isNow,
  follow,
}: {
  segment: TranscriptSegment;
  isNow: boolean;
  follow: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isNow && follow) {
      ref.current?.scrollIntoView({
        block: "center",
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    }
  }, [isNow, follow]);
  return (
    <div
      ref={ref}
      className={`${styles.tr} ${segment.speaker === "student" ? styles.trStu : ""} ${isNow ? styles.trNow : ""}`}
    >
      <span className={styles.trChip}>
        <TimeChip tMs={segment.start_ms} />
      </span>
      <span className={styles.who}>{segment.speaker === "lecturer" ? "อาจารย์" : "นักศึกษา"}</span>
      <p className={styles.trText} lang="en">
        {segment.text}
      </p>
    </div>
  );
}

function ChatPanel({ lectureId }: { lectureId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || busy) return;
    const question = input.trim();
    setInput("");
    const history = messages.slice(-6);
    setMessages((m) => [...m, { role: "user", content: question }, { role: "assistant", content: "" }]);
    setBusy(true);
    try {
      await api.chat(
        { question, scope: "lecture", scope_id: lectureId, history },
        {
          onDelta: (delta) =>
            setMessages((m) => {
              const copy = [...m];
              copy[copy.length - 1] = { ...copy[copy.length - 1], content: copy[copy.length - 1].content + delta };
              return copy;
            }),
          onCitations: (c) => setCitations(c),
          onDone: () => setBusy(false),
        }
      );
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : "เกิดข้อผิดพลาด";
      setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: msg }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={styles.panel} role="tabpanel">
      <p className={styles.disclose}>
        <SparkleIcon />
        ถามเกี่ยวกับคาบนี้ได้ — คำตอบอ้างอิงเวลาที่พูดจริงเสมอ
      </p>
      <div className={styles.chat}>
        {messages.map((m, i) => (
          <div key={i} className={`${styles.chatMsg} ${m.role === "user" ? styles.chatUser : styles.chatAssistant}`}>
            {m.content}
          </div>
        ))}
        {citations.length > 0 && (
          <div className={styles.pts}>
            {citations.map((c, i) => (
              <TimeChip key={i} tMs={c.start_ms} />
            ))}
          </div>
        )}
      </div>
      <form className={styles.chatForm} onSubmit={send}>
        <input
          className={styles.chatInput}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="ถามเกี่ยวกับคาบนี้…"
          aria-label="พิมพ์คำถาม"
        />
        <button className={styles.chatSend} type="submit" disabled={busy}>
          ส่ง
        </button>
      </form>
    </main>
  );
}
