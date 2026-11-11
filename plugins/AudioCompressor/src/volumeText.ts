import type { LunaUnloads } from "@luna/core";
import { observe } from "@luna/lib";

// The HorizontalVolumeSlider plugin (@foukapik) replaces Tidal's volume bar
// with a range input followed by a 3-character text box showing the volume.
// While the bar is driving Gain, show Gain (0-200) in that box instead, and
// treat numbers typed into it as Gain.
const SLIDER = "input.horizontal-volume-slider";

let gainShown: () => number | null = () => null;
let setGain: (gain: number) => void = () => {};
const hooked = new WeakSet<HTMLInputElement>();

const textBoxFor = (slider: Element) => {
	const next = slider.nextElementSibling;
	return next instanceof HTMLInputElement && next.type === "text" ? next : null;
};

const onChange = (event: Event) => {
	if (gainShown() === null) return; // bar is plain volume: let the other plugin handle it
	// Runs before the other plugin's handler (capture listeners on the target
	// fire first), which would clamp the number to 0-100.
	event.stopImmediatePropagation();
	const box = event.currentTarget as HTMLInputElement;
	const gain = Math.max(0, Math.min(200, parseInt(box.value) || 0));
	setGain(gain);
	box.value = String(gain);
};

const attach = (slider: HTMLInputElement) => {
	const box = textBoxFor(slider);
	if (box && !hooked.has(box)) {
		hooked.add(box);
		box.addEventListener("change", onChange, { capture: true });
	}
	updateVolumeText();
};

/** Redraw the number and tooltip. Call after anything that moves the bar or switches modes. */
export const updateVolumeText = () => {
	const gain = gainShown();
	for (const slider of document.querySelectorAll<HTMLInputElement>(SLIDER)) {
		const label = gain === null ? "Volume" : "Gain";
		slider.title = label;
		slider.setAttribute("aria-label", label);
		const box = textBoxFor(slider);
		// Leave the box alone while someone is typing in it.
		if (!box || document.activeElement === box) continue;
		box.value = String(gain ?? slider.value);
		box.title = gain === null ? "" : "Gain (%)";
	}
};

/**
 * @param shown Gain to display, or null when the bar is plain volume.
 * @param set Called with a Gain (0-200) typed into the box.
 */
export const mountVolumeText = (unloads: LunaUnloads, shown: () => number | null, set: (gain: number) => void) => {
	gainShown = shown;
	setGain = set;
	observe<HTMLInputElement>(unloads, SLIDER, attach);
	document.querySelectorAll<HTMLInputElement>(SLIDER).forEach(attach);
	unloads.add(() => {
		gainShown = () => null;
		updateVolumeText();
		for (const slider of document.querySelectorAll<HTMLInputElement>(SLIDER)) {
			textBoxFor(slider)?.removeEventListener("change", onChange, { capture: true });
		}
	});
};
