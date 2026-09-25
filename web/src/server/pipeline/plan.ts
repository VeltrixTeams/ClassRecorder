import "server-only";

/** PURE: given the lecture row + which outputs already exist, return the
 * single next step to run to make progress toward 'ready'. Port of
 * backend/app/pipeline/worker.py `plan_steps`, adapted to the v2.1
 * cron/webhook-driven step names (finalize/transcribe/waiting/segments/
 * summarize/index/ready) — no queue, one step per advance() call. */

export type Step =
  | "finalize"
  | "transcribe"
  | "waiting"
  | "segments"
  | "summarize"
  | "index"
  | "ready";

export interface PlanInputs {
  audioPath: string | null;
  sttRequestId: string | null;
  sttSubmittedAt: Date | null;
  hasSttResults: boolean;
  hasTranscriptSegments: boolean;
  hasThSummary: boolean;
  hasSearchChunks: boolean;
  now?: Date;
}

const WAIT_TIMEOUT_MS = 30 * 60 * 1000;

/** Returns the next step to run. 'ready' means nothing left to do. */
export function nextStep(inputs: PlanInputs): Step {
  if (!inputs.audioPath) return "finalize";
  if (!inputs.hasSttResults) {
    if (inputs.sttRequestId && inputs.sttSubmittedAt) {
      const elapsed = (inputs.now ?? new Date()).getTime() - inputs.sttSubmittedAt.getTime();
      if (elapsed < WAIT_TIMEOUT_MS) return "waiting";
    }
    return "transcribe";
  }
  if (!inputs.hasTranscriptSegments) return "segments";
  if (!inputs.hasThSummary) return "summarize";
  if (!inputs.hasSearchChunks) return "index";
  return "ready";
}
