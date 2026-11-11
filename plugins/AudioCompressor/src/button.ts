import { observe } from "@luna/lib";
import type { LunaUnloads } from "@luna/core";

// Sits right after Tidal's Repeat button in the player bar and borrows its
// classes, so it gets the same size, spacing, hover and "on" (aria-checked)
// styling as Repeat and Shuffle.
const REPEAT = `#playbackControlBar button[data-test="repeat"]`;
const MARK = "data-audio-compressor";

const SVG_NS = "http://www.w3.org/2000/svg";
// Same icon as the Chrome extension's on-video button.
const ICON_PATH = "M3 5h18M3 19h18M7 9.5v5M12 8v8M17 9.5v5";

const buttons = new Set<HTMLButtonElement>();
let isOn = () => false;
let onToggle = () => {};

const createButton = (repeat: HTMLButtonElement) => {
	const button = document.createElement("button");
	button.type = "button";
	button.className = repeat.className;
	button.setAttribute(MARK, "");
	button.setAttribute("role", "switch");
	button.addEventListener("click", (event) => {
		event.stopPropagation();
		onToggle();
	});

	const icon = document.createElementNS(SVG_NS, "svg");
	icon.setAttribute("viewBox", "0 0 24 24");
	icon.setAttribute("aria-hidden", "true");
	const repeatIcon = repeat.querySelector("svg")?.getBoundingClientRect();
	const size = repeatIcon && repeatIcon.width > 0 ? `${repeatIcon.width}px` : "24px";
	icon.style.cssText = `width:${size};height:${size};fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;`;
	const path = document.createElementNS(SVG_NS, "path");
	path.setAttribute("d", ICON_PATH);
	icon.append(path);
	button.append(icon);

	buttons.add(button);
	return button;
};

const attach = (repeat: HTMLButtonElement) => {
	const next = repeat.nextElementSibling;
	if (next?.hasAttribute(MARK)) return;
	const button = createButton(repeat);
	repeat.after(button);
	updateButtons();
};

/** Redraw every button's on/off state. */
export const updateButtons = () => {
	const on = isOn();
	const label = `Audio Compressor (${on ? "on" : "off"})`;
	for (const button of buttons) {
		if (!button.isConnected) {
			buttons.delete(button);
			continue;
		}
		button.setAttribute("aria-checked", String(on));
		button.setAttribute("aria-label", label);
		button.title = label;
		// Tidal's own "on" colour for switches comes from aria-checked; this
		// is a fallback in case its CSS keys off something else.
		button.style.color = on ? "var(--wave-color-solid-accent-fill, #33ffee)" : "";
	}
};

export const mountButtons = (unloads: LunaUnloads, getOn: () => boolean, toggle: () => void) => {
	isOn = getOn;
	onToggle = toggle;
	// React can re-create the player bar (e.g. leaving fullscreen), so keep
	// watching for Repeat buttons that don't have ours next to them.
	observe<HTMLButtonElement>(unloads, REPEAT, attach);
	document.querySelectorAll<HTMLButtonElement>(REPEAT).forEach(attach);
	unloads.add(() => {
		for (const button of buttons) button.remove();
		buttons.clear();
	});
};
