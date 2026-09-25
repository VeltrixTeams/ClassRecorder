"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import styles from "./page.module.css";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const sendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({ email });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  };

  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({ email, token: otp, type: "email" });
    setBusy(false);
    if (error) setError(error.message);
    else router.replace("/");
  };

  return (
    <main className={styles.wrap}>
      <h1 className={styles.title}>LectureNote</h1>
      <p className={styles.sub}>บันทึกคาบเรียน ถอดความ และสรุปภาษาไทยพร้อมลิงก์เวลา</p>

      {!sent ? (
        <form onSubmit={sendOtp} className={styles.form}>
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
            {busy ? "กำลังส่ง…" : "ส่งรหัสเข้าสู่ระบบ"}
          </button>
        </form>
      ) : (
        <form onSubmit={verifyOtp} className={styles.form}>
          <label className={styles.label} htmlFor="otp">
            รหัส OTP จากอีเมล
          </label>
          <input
            id="otp"
            className={styles.input}
            inputMode="numeric"
            autoComplete="one-time-code"
            spellCheck={false}
            required
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            placeholder="123456"
          />
          <button className={styles.btn} type="submit" disabled={busy}>
            {busy ? "กำลังยืนยัน…" : "ยืนยันและเข้าสู่ระบบ"}
          </button>
        </form>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
