"use client";
import { useState } from "react";
import Link from "next/link";
import { useRequireAuth } from "@/lib/useAuth";
import { api } from "@/lib/api";
import type { SearchResult } from "@/lib/types";
import { SearchIcon } from "@/components/icons";
import { BottomNav } from "@/components/BottomNav";
import { formatMs } from "@/lib/format";
import styles from "./page.module.css";

export default function SearchPage() {
  const session = useRequireAuth();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    try {
      setResults(await api.search(q.trim()));
    } finally {
      setBusy(false);
    }
  };

  if (session === undefined) return null;

  return (
    <div className={styles.wrap}>
      <main className={styles.main}>
        <h1 className={styles.title}>ค้นหา</h1>
        <form onSubmit={run}>
          <label className="sr-only" htmlFor="q">
            ค้นหาทุกคาบเรียน
          </label>
          <div className={styles.inputWrap}>
            <SearchIcon />
            <input
              id="q"
              className={styles.input}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ค้นหาแนวคิดหรือคำในทุกคาบเรียน"
            />
          </div>
        </form>

        {busy && <p className={styles.empty}>กำลังค้นหา…</p>}
        {results && results.length === 0 && !busy && <p className={styles.empty}>ไม่พบผลลัพธ์</p>}
        {results && results.length > 0 && (
          <ul className={styles.results}>
            {results.map((r, i) => (
              <li key={i}>
                <Link href={`/lectures/${r.lecture_id}`} className={styles.result}>
                  <div className={`${styles.resultMeta} mono`}>{formatMs(r.start_ms)}</div>
                  <div>{r.text}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
      <BottomNav />
    </div>
  );
}
