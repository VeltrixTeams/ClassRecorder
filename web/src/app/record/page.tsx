"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useRequireAuth } from "@/lib/useAuth";
import { api } from "@/lib/api";
import { LectureRecorder, pickMimeType } from "@/lib/recorder";
import { processLectureQueue, markLectureStopped } from "@/lib/uploadQueue";
import { formatTimer, formatMs } from "@/lib/format";
import { ChevronDownIcon, PinIcon, CameraIcon, StopIcon, CheckIcon } from "@/components/icons";
import styles from "./page.module.css";

const CONSENT_KEY = "lecturenote_consent_acked";

export default function RecordPage() {
  const session = useRequireAuth();
  const router = useRouter();
  const [needsConsent, setNeedsConsent] = useState(false);
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [uploaded, setUploaded] = useState(0);
  const [pins, setPins] = useState<number[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const recRef = useRef<LectureRecorder | null>(null);
  const lectureIdRef = useRef<string | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [holding, setHolding] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!localStorage.getItem(CONSENT_KEY)) setNeedsConsent(true);
  }, []);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (recording) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    addEventListener("beforeunload", onBeforeUnload);
    return () => removeEventListener("beforeunload", onBeforeUnload);
  }, [recording]);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  };

  const startRecording = async () => {
    const mimeType = pickMimeType();
    const lecture = await api.createLecture({ recorded_at: new Date().toISOString(), mime_type: mimeType });
    lectureIdRef.current = lecture.id;
    const rec = new LectureRecorder(lecture.id);
    rec.onElapsed = (ms) => setElapsedSec(Math.floor(ms / 1000));
    rec.onSegmentUploaded = () => {
      setUploaded((n) => n + 1);
      processLectureQueue(lecture.id).catch(() => {});
    };
    rec.onError = (message) => {
      showToast(message);
      setRecording(false);
      setPaused(true);
      const id = lectureIdRef.current;
      if (id) {
        markLectureStopped(id).then(() => processLectureQueue(id)).catch(() => {});
      }
    };
    recRef.current = rec;
    await rec.start();
    setRecording(true);
  };

  const consentAndStart = () => {
    localStorage.setItem(CONSENT_KEY, "1");
    setNeedsConsent(false);
    startRecording().catch(() => showToast("เริ่มบันทึกไม่สำเร็จ — ตรวจสอบสิทธิ์ไมโครโฟน"));
  };

  const bookmark = () => {
    const b = recRef.current?.bookmark();
    if (!b) return;
    setPins((p) => [...p, b.t_ms]);
    navigator.vibrate?.(20);
    showToast(`ปักหมุดที่ ${formatMs(b.t_ms)}`);
  };

  const finish = async () => {
    setConfirmOpen(false);
    setPaused(true);
    setRecording(false);
    const rec = recRef.current;
    if (rec) await rec.stop();
    showToast("บันทึกแล้ว · กำลังอัปโหลดและสรุป");
    const id = lectureIdRef.current;
    if (id) {
      await markLectureStopped(id);
      processLectureQueue(id).finally(() => {
        router.push(`/lectures/${id}`);
      });
    }
  };

  const onStopDown = () => {
    setHolding(true);
    holdTimer.current = setTimeout(finish, 1000);
  };
  const onStopUp = () => {
    setHolding(false);
    if (holdTimer.current) clearTimeout(holdTimer.current);
  };

  if (session === undefined) return null;

  if (needsConsent) {
    return (
      <div className={styles.scrim}>
        <div className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="consent-t">
          <h2 id="consent-t">แจ้งเตือนก่อนบันทึก</h2>
          <p>
            แอปนี้จะบันทึกเสียงในห้องเรียน โปรดแจ้งผู้ที่เกี่ยวข้องหากจำเป็น
            และตรวจสอบนโยบายของสถาบันก่อนเริ่มบันทึก
          </p>
          <div className={styles.row}>
            <button className={styles.btn} onClick={() => router.push("/")}>
              ยกเลิก
            </button>
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={consentAndStart}>
              เข้าใจแล้ว เริ่มบันทึก
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <main className={`${styles.rec} scene-dark ${paused ? styles.paused : ""}`} data-theme="dark">
      <div className={styles.top}>
        <div className={styles.course}>
          <span className={styles.dot} style={{ background: "#6E8FF0" }} />
          กำลังบันทึก
        </div>
        <button className={styles.iconBtn} aria-label="ย่อหน้าจอ (ยังบันทึกต่อ)" onClick={() => router.push("/")}>
          <ChevronDownIcon />
        </button>
      </div>

      {!recording && !paused ? (
        <div className={styles.stage}>
          <button className={`${styles.big}`} onClick={() => startRecording().catch(() => showToast("เริ่มบันทึกไม่สำเร็จ"))}>
            เริ่มบันทึกคาบเรียน
          </button>
        </div>
      ) : (
        <>
          <div className={styles.stage}>
            <div className={`${styles.live} mono`}>
              <span className={styles.ring} aria-hidden="true" />
              <span>{paused ? "หยุดแล้ว" : "กำลังบันทึก"}</span>
            </div>
            <div className={`${styles.timer} mono`} role="timer" aria-label="เวลาที่บันทึก">
              {formatTimer(elapsedSec)}
            </div>
            <p className={styles.trust} aria-live="polite">
              <CheckIcon />
              <span>
                บันทึกในเครื่องแล้ว · อัปโหลด {uploaded}/{Math.max(uploaded, Math.floor(elapsedSec / 30))} ชิ้น
              </span>
            </p>
          </div>

          <div className={styles.actions}>
            <button className={styles.big} onClick={bookmark} disabled={paused}>
              <PinIcon />
              ปักหมุด
            </button>
            <button className={styles.big} onClick={() => showToast(`แนบรูปกระดานที่ ${formatMs(elapsedSec * 1000)}`)} disabled={paused}>
              <CameraIcon />
              ถ่ายกระดาน
            </button>
          </div>

          <div className={styles.pins}>
            {pins.length > 0 && <span>ปักหมุดแล้ว</span>}
            {pins.map((t) => (
              <span key={t} className={styles.pinChip}>
                {formatMs(t)}
              </span>
            ))}
          </div>

          <button
            className={`${styles.stop} ${holding ? styles.holding : ""}`}
            disabled={paused}
            onPointerDown={onStopDown}
            onPointerUp={onStopUp}
            onPointerLeave={onStopUp}
            onPointerCancel={onStopUp}
            onClick={(e) => {
              if (e.detail === 0) setConfirmOpen(true);
            }}
            onContextMenu={(e) => e.preventDefault()}
            aria-describedby="stopHint"
          >
            <span className={styles.fill} aria-hidden="true" />
            <StopIcon />
            <span>หยุดและบันทึก</span>
            <small id="stopHint" className={styles.stopHint}>
              กดค้าง 1 วินาที
            </small>
          </button>
        </>
      )}

      {confirmOpen && (
        <div className={styles.scrim}>
          <div className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="sh-t">
            <h2 id="sh-t">หยุดบันทึกคาบนี้?</h2>
            <p>
              ได้เสียง {formatTimer(elapsedSec)} · จะอัปโหลดส่วนที่เหลือแล้วเริ่มสรุปให้อัตโนมัติ
            </p>
            <div className={styles.row}>
              <button className={styles.btn} onClick={() => setConfirmOpen(false)}>
                บันทึกต่อ
              </button>
              <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={finish}>
                หยุดและบันทึก
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={`${styles.toast} ${toast ? styles.toastShow : ""}`} role="status" aria-live="polite">
        {toast}
      </div>
    </main>
  );
}
