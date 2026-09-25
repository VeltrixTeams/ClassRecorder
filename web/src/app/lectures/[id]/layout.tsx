import { AudioPlayerProvider } from "@/components/AudioPlayer";

export default function LectureLayout({ children }: { children: React.ReactNode }) {
  return <AudioPlayerProvider>{children}</AudioPlayerProvider>;
}
