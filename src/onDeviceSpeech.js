/**
 * On-device speech recognition support.
 *
 * This is a genuinely free upgrade path within the SAME Web Speech
 * API already in use elsewhere in this app — not a different system,
 * not a paid API, no server, no API key. Chrome 139+ can run speech
 * recognition entirely on the device instead of sending audio to a
 * cloud service, via `recognition.options = { langs, processLocally:
 * true }`. See: https://github.com/WebAudio/web-speech-api/blob/main/explainers/on-device-speech-recognition.md
 *
 * Honest limitations, not hidden:
 *  - This is Chrome's general-purpose on-device model, not a model
 *    tuned for gym/fitness vocabulary. Contextual biasing (the
 *    feature that WOULD let an app bias recognition toward specific
 *    words like "RPE" or exercise names) is still unshipped at the
 *    time this was written — so acronym/jargon mishearing may not
 *    improve. The real fix for that needs a paid API (see the cost
 *    breakdown given separately).
 *  - Requires a one-time language pack download per device. This
 *    module always asks before downloading anything — it never
 *    triggers a silent download.
 *  - Falls back to whatever the browser already does (cloud-based
 *    recognition) automatically if on-device isn't available or
 *    isn't installed — there is no regression risk from trying this.
 */

const LANG = 'en-US';

function getSpeechRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition;
}

/**
 * Checks whether the on-device availability API exists at all (older
 * browsers / non-Chrome simply won't have SpeechRecognition.available).
 */
export function supportsOnDeviceCheck() {
  const Ctor = getSpeechRecognitionCtor();
  return Boolean(Ctor && typeof Ctor.available === 'function');
}

/**
 * Returns one of: 'available', 'downloadable', 'downloading',
 * 'unavailable', or 'unsupported' (this browser has no concept of
 * on-device recognition at all — e.g. Firefox, Safari, older Chrome).
 */
export async function checkOnDeviceAvailability() {
  if (!supportsOnDeviceCheck()) return 'unsupported';
  try {
    const Ctor = getSpeechRecognitionCtor();
    const status = await Ctor.available({ langs: [LANG], processLocally: true });
    return status;
  } catch (e) {
    return 'unsupported';
  }
}

/**
 * Triggers the language pack download. Returns true on success. This
 * should only ever be called from a direct user action (a button
 * tap), never automatically — downloading anything without the
 * person's explicit go-ahead isn't something this app does.
 */
export async function installOnDeviceSpeech() {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor || typeof Ctor.install !== 'function') return false;
  try {
    const result = await Ctor.install({ langs: [LANG], processLocally: true });
    return Boolean(result);
  } catch (e) {
    return false;
  }
}

/**
 * Applies on-device options to a recognition instance if the device
 * has on-device recognition installed and ready ('available' status).
 * Safe to call even when unsupported — it's a no-op in that case, and
 * the recognition instance behaves exactly as it did before (cloud-
 * based, via whatever the browser already does by default).
 */
export function applyOnDeviceOptionsIfReady(recognition, availabilityStatus) {
  if (availabilityStatus !== 'available') return false;
  try {
    recognition.options = { langs: [LANG], processLocally: true };
    return true;
  } catch (e) {
    // Some browsers may not support assigning .options even if the
    // static availability check passed in a future spec revision —
    // fail safe rather than throw and break voice input entirely.
    return false;
  }
}
