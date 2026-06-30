/**
 * Minimal single-utterance speech capture — records one phrase and
 * resolves with the raw transcript. This is intentionally much
 * simpler than the voice pipeline in pages/log.js (no dropset
 * detection, no maxAlternatives scoring, no exercise parsing) since
 * the pronunciation training module just needs "what did the
 * recognizer actually hear", nothing more.
 */

export function getSpeechRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition;
}

export function isVoiceCaptureSupported() {
  return Boolean(getSpeechRecognitionCtor());
}

/**
 * Starts listening and resolves with the transcript once the
 * recognizer finishes (on silence/end), or rejects if no speech was
 * captured or an error occurred. The returned object also exposes a
 * `stop()` method so the caller can let the person manually end
 * listening early, same as the mic button pattern used elsewhere.
 */
export function captureOneUtterance({ onListeningChange } = {}) {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    return { promise: Promise.reject(new Error('Speech recognition not supported')), stop: () => {} };
  }

  const recognition = new Ctor();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = 'en-US';

  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  let finalTranscript = '';

  recognition.onresult = (event) => {
    for (let i = 0; i < event.results.length; i++) {
      finalTranscript += event.results[i][0].transcript;
    }
  };

  recognition.onerror = (event) => {
    if (onListeningChange) onListeningChange(false);
    rejectPromise(new Error(event.error || 'Speech recognition error'));
  };

  recognition.onend = () => {
    if (onListeningChange) onListeningChange(false);
    if (finalTranscript.trim()) {
      resolvePromise(finalTranscript.trim());
    } else {
      rejectPromise(new Error('No speech detected'));
    }
  };

  try {
    recognition.start();
    if (onListeningChange) onListeningChange(true);
  } catch (e) {
    rejectPromise(e);
  }

  return { promise, stop: () => recognition.stop() };
}
