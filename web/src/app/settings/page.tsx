"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useRequireAuth } from "@/lib/useAuth";
import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { subscribeToPush } from "@/lib/push";
import type { Profile } from "@/lib/types";
import { BottomNav } from "@/components/BottomNav";
import { BellIcon } from "@/components/icons";
import styles from "./page.module.css";

export default function SettingsPage() {
  const session = useRequireAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [pushStatus, setPushStatus] = useState<"idle" | "on" | "error">("idle");

  useEffect(() => {
    if (!session) return;
    api.getMe().then((p) => {
      setProfile(p);
      setPushStatus(p.push_subscription ? "on" : "idle");
    });
  }, [session]);

  if (session === undefined) return null;

  const updateRetention = async (days: number) => {
    const p = await api.updateMe({ retention_days: days });
    setProfile(p);
  };

  const enablePush = async () => {
    try {
      const sub = await subscribeToPush();
      if (!sub) {
        setPushStatus("error");
        return;
      }
      await api.updateMe({ push_subscription: sub });
      setPushStatus("on");
    } catch {
      setPushStatus("error");
    }
  };

  const deleteAccount = async () => {
    if (!confirm("ยืนยันลบบัญชีและข้อมูลทั้งหมดถาวร?")) return;
    await api.deleteMe();
    await supabase.auth.signOut();
    router.replace("/login");
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  return (
    <div className={styles.wrap}>
      <main className={styles.main}>
        <h1 className={styles.title}>ตั้งค่า</h1>

        <section>
          <h2 className={styles.h2}>ความเป็นส่วนตัว</h2>
          <p className={styles.notice}>
            การบันทึกเสียงในห้องเรียนควรได้รับความยินยอมตามความเหมาะสม โปรดตรวจสอบนโยบายของสถาบันก่อนบันทึก
          </p>
          <div className={styles.row}>
            <div>
              <div className={styles.rowLabel}>ระยะเวลาเก็บเสียง</div>
              <div className={styles.rowSub}>ลบไฟล์เสียงอัตโนมัติหลังครบกำหนด</div>
            </div>
            <select
              className={styles.select}
              value={profile?.retention_days ?? 180}
              onChange={(e) => updateRetention(Number(e.target.value))}
            >
              <option value={30}>30 วัน</option>
              <option value={90}>90 วัน</option>
              <option value={180}>180 วัน</option>
              <option value={365}>365 วัน</option>
            </select>
          </div>
        </section>

        <section>
          <h2 className={styles.h2}>การแจ้งเตือน</h2>
          <div className={styles.row}>
            <div>
              <div className={styles.rowLabel}>แจ้งเตือนเมื่อสรุปเสร็จ</div>
              <div className={styles.rowSub}>{pushStatus === "on" ? "เปิดใช้งานแล้ว" : "ยังไม่ได้เปิด"}</div>
            </div>
            <button className={styles.btn} onClick={enablePush}>
              <BellIcon /> เปิดแจ้งเตือน
            </button>
          </div>
        </section>

        <section>
          <h2 className={styles.h2}>บัญชี</h2>
          <div className={styles.row}>
            <span className={styles.rowLabel}>ออกจากระบบ</span>
            <button className={styles.btn} onClick={signOut}>
              ออกจากระบบ
            </button>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>ลบบัญชี</span>
            <button className={`${styles.btn} ${styles.btnDanger}`} onClick={deleteAccount}>
              ลบบัญชีถาวร
            </button>
          </div>
        </section>
      </main>
      <BottomNav />
    </div>
  );
}
