from app.pipeline.worker import plan_steps


def test_plan_steps_fresh_job_runs_everything():
    steps = plan_steps(has_full_opus=False, has_transcript=False, has_th_summary=False, has_search_chunks=False)
    assert steps == ["prepare", "transcribe", "summarize", "index"]


def test_plan_steps_all_done_runs_nothing():
    steps = plan_steps(has_full_opus=True, has_transcript=True, has_th_summary=True, has_search_chunks=True)
    assert steps == []


def test_plan_steps_crash_mid_transcribing_resumes_from_transcribe():
    # full.opus was produced and uploaded before the crash; transcript,
    # summary and index were never written.
    steps = plan_steps(has_full_opus=True, has_transcript=False, has_th_summary=False, has_search_chunks=False)
    assert steps == ["transcribe", "summarize", "index"]


def test_plan_steps_retry_after_failed_summary_skips_prepare_and_transcribe():
    # prepare + transcribe succeeded and left their outputs behind; only
    # summarize (and the index step after it) need to run again.
    steps = plan_steps(has_full_opus=True, has_transcript=True, has_th_summary=False, has_search_chunks=False)
    assert steps == ["summarize", "index"]


def test_plan_steps_only_index_missing():
    steps = plan_steps(has_full_opus=True, has_transcript=True, has_th_summary=True, has_search_chunks=False)
    assert steps == ["index"]
