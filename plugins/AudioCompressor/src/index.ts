import { interceptors, ReactiveStore, Tracer, type LunaUnload } from "@luna/core";
import { MediaItem, redux } from "@luna/lib";

import { applyAll, hook, releaseVolume, setVolumeMode, syncOutput, type HookResult } from "./audio";
import { mountButtons, updateButtons } from "./button";
import { mountVolumeText, updateVolumeText } from "./volumeText";
import { DEFAULTS } from "./defaults";
import { activePlayerName, applyConfig, BROWSER_CONFIG, DESKTOP_CONFIG, getSdk } from "./player";

export const { trace } = Tracer("[AudioCompressor]");
export const unloads = new Set<LunaUnload>();

export const storage = await ReactiveStore.getPluginStorage("AudioCompressor", {
	enabled: true,
	/** Tidal's volume bar sets Gain while the compressor is on. */
	volumeGain: true,
	/** Where the volume bar was before it started showing Gain, restored when it stops. */
	plainVolume: 100,
	/** Whether the bar is currently showing Gain (survives Tidal quitting mid-override). */
	volumeOverridden: false,
	...DEFAULTS,
});

export { Settings } from "./Settings";

/** What the settings page shows about the current track. */
export const status = { player: "none" as string, result: undefined as HookResult | undefined, error: undefined as string | undefined };

/** Lets the settings page redraw when the button or volume bar changes something. */
export const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

const settings = () => ({
	threshold: storage.threshold,
	knee: storage.knee,
	ratio: storage.ratio,
	attack: storage.attack,
	release: storage.release,
	gain: storage.gain,
});

// ---- Volume bar as Gain ----
// Bar 0-100% maps to Gain 0-200%, so the middle of the bar is no change.

const barVolume = () => redux.store.getState().playbackControls.volume;

/**
 * Move Tidal's volume bar. redux.actions skips Luna's interceptors (they only
 * wrap Tidal's own dispatches), so run them here too: other plugins, such as
 * volume-slider replacements, redraw their sliders from them.
 */
const setBar = (volume: number) => {
	const type = "playbackControls/SET_VOLUME";
	const payload = { volume };
	let cancelled = false;
	for (const interceptor of interceptors[type] ?? []) {
		try {
			if (interceptor(payload, type) === true) cancelled = true;
		} catch (error) {
			trace.err.withContext("Volume interceptor")(error);
		}
	}
	if (!cancelled) redux.actions[type](payload);
	updateVolumeText();
};
let barIsGain = false;

const updateVolumeMode = () => {
	const wanted = storage.enabled && storage.volumeGain;
	if (wanted === barIsGain) return;
	barIsGain = wanted;
	if (wanted) {
		// Don't overwrite the saved volume if the bar was already showing Gain
		// when Tidal last closed.
		if (!storage.volumeOverridden) storage.plainVolume = barVolume();
		storage.volumeOverridden = true;
		setVolumeMode(true, barVolume() / 100);
		setBar(storage.gain / 2);
	} else {
		storage.volumeOverridden = false;
		setVolumeMode(false, barVolume() / 100);
		setBar(storage.plainVolume);
	}
};

// Watch the stored volume rather than intercepting SET_VOLUME: plugins (and
// this one) change it through redux.actions, which interceptors never see.
// Store listeners run right after the reducer, before Tidal's saga hands the
// new level to the player, so the elements' volume is corrected first.
let lastBar = barVolume();
const unsubscribe = redux.store.subscribe(() => {
	const volume = barVolume();
	if (volume === lastBar) return;
	lastBar = volume;
	setVolumeMode(barIsGain, volume / 100);
	if (barIsGain) {
		storage.gain = Math.round(volume * 2);
		applyAll(settings(), storage.enabled);
		notify();
	}
	// After the slider plugin has written the bar value into its number box.
	updateVolumeText();
});
unloads.add(unsubscribe);

// Show Gain (0-200) instead of the bar value in a volume-slider plugin's number box.
mountVolumeText(
	unloads,
	() => (barIsGain ? storage.gain : null),
	(gain) => setBar(gain / 2),
);

/** Called by the settings page when Gain changes, so the bar follows it. */
export const gainChanged = () => {
	if (barIsGain) setBar(storage.gain / 2);
};

// ---- Following the player ----

let switching = false;
let warnedDrm = false;
let lastReapply = 0;

/** Find the element the current track is playing from and route it through the compressor. */
const sync = async () => {
	if (switching || status.error) return;
	const { getMediaElement } = getSdk();
	status.player = activePlayerName() ?? "none";

	// Something (sign-in, a device change) re-ran Tidal's own setup and put
	// lossless tracks back on the native player. Moving the track restarts
	// it, so never do this more than once every 30 seconds.
	if (status.player === "nativePlayer") {
		if (Date.now() - lastReapply < 30_000) return;
		lastReapply = Date.now();
		trace.warn("Tidal switched back to the native player; switching to the browser player again.");
		switching = true;
		try {
			await applyConfig(BROWSER_CONFIG);
		} finally {
			switching = false;
		}
		return;
	}

	const element = getMediaElement();
	if (!element) return;
	try {
		status.result = hook(element, settings(), storage.enabled);
	} catch (error) {
		status.result = "failed";
		trace.err.withContext("Couldn't route audio through the compressor")(error);
	}
	if (status.result === "drm" && !warnedDrm) {
		warnedDrm = true;
		trace.msg.warn("This track is DRM-protected, so it can't be compressed. It plays normally.");
	}
	if (status.result === "ok") syncOutput(element);
};

/** Apply the current settings everywhere. Called after any change. */
export const refresh = () => {
	applyAll(settings(), storage.enabled);
	updateVolumeMode();
	updateButtons();
	notify();
	sync().catch(trace.err.withContext("sync"));
};

export const toggleCompressor = () => {
	storage.enabled = !storage.enabled;
	refresh();
};

// ---- Start ----

// A failure here must not stop the module from finishing: Luna only shows the
// settings page once the plugin has loaded.
switching = true;
try {
	await applyConfig(BROWSER_CONFIG);
	trace.log("Tidal is now using its browser player.");
} catch (error) {
	status.error = error instanceof Error ? error.message : String(error);
	trace.msg.err.withContext("Couldn't switch Tidal to its browser player")(error);
} finally {
	switching = false;
}

MediaItem.onMediaTransition(unloads, () => sync());
redux.intercept("playbackControls/SET_PLAYBACK_STATE", unloads, () => {
	// Let the SDK swap elements first (gapless playback alternates two).
	setTimeout(() => sync().catch(trace.err.withContext("sync")), 50);
});
const timer = setInterval(() => sync().catch(trace.err.withContext("sync")), 1000);
unloads.add(() => clearInterval(timer));

mountButtons(unloads, () => storage.enabled, toggleCompressor);
if (!status.error) updateVolumeMode();
sync().catch(trace.err.withContext("sync"));

unloads.add(async () => {
	// Elements stay routed through Web Audio for good; pass them straight through.
	applyAll(settings(), false);
	releaseVolume();
	if (barIsGain) {
		barIsGain = false;
		storage.volumeOverridden = false;
		setBar(storage.plainVolume);
	}
	await applyConfig(DESKTOP_CONFIG).catch(trace.err.withContext("Restoring the native player"));
});
