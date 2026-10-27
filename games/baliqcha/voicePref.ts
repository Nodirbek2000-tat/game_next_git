// The "play with the voice" choice of Baliqcha: default ON (it is optional: the microphone asks for permission and the game
// is fully playable without it), kept on this device only. A tiny shared state between the on-screen mic button (React)
// and the game; audio never leaves the device (see games/baliq-ovi/voiceInput.ts).

const KEY = "harakat.baliqcha.voice";

export function loadVoicePref(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "0") return false;
    if (v === "1") return true;
  } catch {
    /* storage blocked: default */
  }
  return true;
}

export function saveVoicePref(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/** shared with the mic button: `on` is what the player wants, `label` is the short status text of the microphone */
export const voiceUi = {
  on: true,
  label: "",
  /** the running game registers here to be told when the button is pressed */
  onChange: null as ((on: boolean) => void) | null,
};

export function setVoiceWanted(on: boolean): void {
  voiceUi.on = on;
  saveVoicePref(on);
  voiceUi.onChange?.(on);
}
