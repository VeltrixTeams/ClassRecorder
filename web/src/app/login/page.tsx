"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import styles from "./page.module.css";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  // The magic link lands back here; supabase-js picks the session out of the URL
  // on init, so just wait for it (or an error in the hash) and move on.
  useEffect(() => {
    const linkError = new URLSearchParams(window.location.hash.slice(1)).get("error_description");

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/");
      else if (linkError) setError(`ลิงก์ใช้ไม่ได้ (${linkError}) กรุณาขอลิงก์ใหม่`);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (s) router.replace("/");
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  const sendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/login` },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  };

  return (
    <main className={styles.wrap}>
      <h1 className={styles.title}>LectureNote</h1>
      <p className={styles.sub}>บันทึกคาบเรียน ถอดความ และสรุปภาษาไทยพร้อมลิงก์เวลา</p>

      {!sent ? (
        <form onSubmit={sendLink} className={styles.form}>
          <label className={styles.label} htmlFor="email">
            อีเมล
          </label>
          <input
            id="email"
            className={styles.input}
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@university.ac.th"
          />
          <button className={styles.btn} type="submit" disabled={busy}>
            {busy ? "กำลังส่ง…" : "ส่งลิงก์เข้าสู่ระบบ"}
          </button>
        </form>
      ) : (
        <div className={styles.form}>
          <p>
            ส่งลิงก์ไปที่ <strong>{email}</strong> แล้ว เปิดอีเมลแล้วกด &quot;Sign in&quot;
            บนเครื่องและเบราว์เซอร์นี้เพื่อเข้าสู่ระบบ
          </p>
          <button className={styles.btn} type="button" onClick={() => setSent(false)}>
            ใช้อีเมลอื่น / ส่งใหม่
          </button>
        </div>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
