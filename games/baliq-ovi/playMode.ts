// The play modes of "Baliq ovi": "Ovozsiz o‘ynash" (silent, hand movements: the only one working now) and
// "Ovoz bilan o‘ynash" (voice: built, but switched off until it is ready).

/**
 * The single switch for the voice mode. While false: the start screen shows voice as "Tez orada" (not selectable), the
 * voice toggle / the `?voice=1` link / the saved preference are ignored and the microphone and the speech recogniser are
 * never created or requested. Set to true to bring the voice option (its panel, the [V] key and the microphone) back.
 */
export const VOICE_PLAY_AVAILABLE = false;
