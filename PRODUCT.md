# PRODUCT — LectureNote

## What it is
A mobile app that records university lectures, transcribes them, and writes a Thai summary. Every point in the summary links back to the second it was said.

## Who
Thai university students (18–24). The lectures are delivered in English and the students study in Thai. They use the app in lecture halls (low attention, need discretion) and at night (long reading, tired eyes).

## Promise
"Never miss what the lecturer said, and always be able to check it." Every AI output must be verifiable against the audio.

## Core jobs
1. Start recording within 2 s of sitting down, and never lose the audio.
2. Mark important moments during class without fuss.
3. After class, get a trustworthy Thai summary with timestamps.
4. Before an exam, find any concept across all lectures, or ask the AI with citations.

## Constraints
- Backend: `LectureNote-backend.md` (states uploading → queued → transcribing → summarizing → indexing → ready | failed).
- UI language is Thai. English technical terms are kept inline.
- Privacy: audio retention setting, full account deletion, recording-consent reminder.

## Platform
The mobile app is still to be decided: native is recommended for background recording. The design prototype is mobile web (`prototype/index.html`).

## Tone
Calm, precise, and reassuring. Speaks like a helpful senior student, never like a system log.
