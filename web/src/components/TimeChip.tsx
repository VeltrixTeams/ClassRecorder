"use client";
import { formatMs } from "@/lib/format";
import { usePlayer } from "./AudioPlayer";
import styles from "./TimeChip.module.css";

/** Mono 13px chip on accent-wash. Tapping seeks + plays the shared AudioPlayer. */
export function TimeChip({ tMs, label }: { tMs: number; label?: string }) {
  const { seek, play, currentTime } = usePlayer();
  const isPlaying = Math.abs(currentTime - tMs / 1000) < 0.6;
  return (
    <button
      type="button"
      className={`${styles.chip} mono`}
      data-playing={isPlaying || undefined}
      onClick={() => {
        seek(tMs / 1000);
        play();
      }}
    >
      {label ?? formatMs(tMs)}
    </button>
  );
}
