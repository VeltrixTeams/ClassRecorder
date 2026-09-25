"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { formatSec } from "@/lib/format";
import { PlayIcon, PauseIcon, RewindIcon } from "./icons";
import styles from "./AudioPlayer.module.css";

interface PlayerState {
  src: string | null;
  duration: number;
  currentTime: number;
  playing: boolean;
}

interface PlayerContextValue extends PlayerState {
  setSrc: (src: string) => void;
  seek: (sec: number) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within AudioPlayerProvider");
  return ctx;
}

/** Sticky bottom audio player + provider so TimeChip elsewhere in the tree can seek it. */
export function AudioPlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<PlayerState>({ src: null, duration: 0, currentTime: 0, playing: false });
  const [speed, setSpeed] = useState(1);
  const speeds = [1, 1.25, 1.5, 2];
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  const setSrc = useCallback((src: string) => {
    setState((s) => ({ ...s, src, currentTime: 0, playing: false }));
  }, []);
  const seek = useCallback((sec: number) => {
    if (audioRef.current) audioRef.current.currentTime = sec;
    setState((s) => ({ ...s, currentTime: sec }));
  }, []);
  const play = useCallback(() => {
    audioRef.current?.play();
  }, []);
  const pause = useCallback(() => audioRef.current?.pause(), []);
  const toggle = useCallback(() => {
    if (state.playing) pause();
    else play();
  }, [state.playing, play, pause]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setState((s) => ({ ...s, currentTime: el.currentTime }));
    const onMeta = () => setState((s) => ({ ...s, duration: el.duration || 0 }));
    const onPlay = () => setState((s) => ({ ...s, playing: true }));
    const onPause = () => setState((s) => ({ ...s, playing: false }));
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
    };
  }, []);

  const onBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    seek(((e.clientX - r.left) / r.width) * state.duration);
    play();
  };
  const onBarKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") seek(Math.min(state.duration, state.currentTime + 15));
    else if (e.key === "ArrowLeft") seek(Math.max(0, state.currentTime - 15));
    else return;
    e.preventDefault();
  };

  const pct = state.duration ? (state.currentTime / state.duration) * 100 : 0;

  return (
    <PlayerContext.Provider value={{ ...state, setSrc, seek, play, pause, toggle }}>
      {children}
      <audio ref={audioRef} src={state.src ?? undefined} className="sr-only" />
      {state.src && (
        <div className={styles.player} role="region" aria-label="เครื่องเล่นเสียง">
          <div
            className={styles.bar}
            role="slider"
            tabIndex={0}
            aria-label="ตำแหน่งเสียง"
            aria-valuemin={0}
            aria-valuemax={Math.floor(state.duration)}
            aria-valuenow={Math.floor(state.currentTime)}
            aria-valuetext={formatSec(state.currentTime)}
            onClick={onBarClick}
            onKeyDown={onBarKey}
          >
            <span className={styles.done} style={{ width: `${pct}%` }} />
            <span className={styles.knob} style={{ left: `${pct}%` }} />
          </div>
          <div className={styles.ctrl}>
            <span className={`${styles.t} mono`}>{formatSec(state.currentTime)}</span>
            <button
              className={styles.iconBtn}
              aria-label="ย้อน 15 วินาที"
              onClick={() => seek(Math.max(0, state.currentTime - 15))}
            >
              <RewindIcon />
            </button>
            <button className={styles.play} aria-label={state.playing ? "หยุดชั่วคราว" : "เล่น"} onClick={toggle}>
              {state.playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <span className={`${styles.t} mono`} style={{ textAlign: "right" }}>
              {formatSec(state.duration)}
            </span>
            <button
              className={`${styles.spd} mono`}
              aria-label="ความเร็วการเล่น"
              onClick={() => setSpeed(speeds[(speeds.indexOf(speed) + 1) % speeds.length])}
            >
              {speed}×
            </button>
          </div>
        </div>
      )}
    </PlayerContext.Provider>
  );
}
