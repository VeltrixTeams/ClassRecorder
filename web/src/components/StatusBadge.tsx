import type { LectureStatus } from "@/lib/types";
import { CheckIcon, AlertIcon, LoaderIcon } from "./icons";
import styles from "./StatusBadge.module.css";

const LABELS: Record<LectureStatus, string> = {
  uploading: "กำลังอัปโหลด",
  queued: "อยู่ในคิว",
  preparing: "กำลังเตรียมเสียง",
  transcribing: "กำลังถอดความ",
  summarizing: "กำลังสรุป",
  indexing: "กำลังจัดทำดัชนี",
  ready: "พร้อมแล้ว",
  failed: "ล้มเหลว",
};

/** Always icon + text, never colour alone. Optional progress "3/10". */
export function StatusBadge({
  status,
  progress,
}: {
  status: LectureStatus;
  progress?: { done: number; total: number } | null;
}) {
  const tone = status === "ready" ? "ok" : status === "failed" ? "err" : "warn";
  const Icon = status === "ready" ? CheckIcon : status === "failed" ? AlertIcon : LoaderIcon;
  return (
    <span className={`${styles.badge} ${styles[tone]}`}>
      <Icon className={styles.icon} />
      <span>{LABELS[status]}</span>
      {progress && status !== "ready" && status !== "failed" && (
        <span className="mono">
          {" "}
          {progress.done}/{progress.total}
        </span>
      )}
    </span>
  );
}
