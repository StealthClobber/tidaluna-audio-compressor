import type { CompressorSettings } from "./defaults";

interface Graph {
	source: MediaElementAudioSourceNode;
	/** Whether the source feeds the compressor (true) or goes straight out (false); null until routed. */
	on: boolean | null;
}

/**
 * One compressor and gain stage shared by every element. Tidal alternates
 * between two elements for gapless playback; with a compressor each, the new
 * track's compressor started from rest and its makeup gain let the first
 * moment through too loud. A shared one carries on from the previous track.
 */
interface Chain {
	compressor: DynamicsCompressorNode;
	gain: GainNode;
}

// createMediaElementSource() can only ever be called once per element, and the
// element stays routed through that AudioContext for good. Keep the context and
// graphs on window so reloading or updating the plugin reuses them instead of
// hitting "already connected" (and so the old context is never closed, which
// would silence the element).
interface Shared {
	context?: AudioContext;
	graphs: Map<HTMLMediaElement, Graph>;
	chain?: Chain;
	/** HTMLMediaElement.prototype.play before hookOnPlay() wrapped it. */
	play?: HTMLMediaElement["play"];
	blocked: WeakSet<HTMLMediaElement>;
	/** The output device last handed to the context, so it's only switched when it really changes. */
	sinkId?: string;
	/** See installVolume(). */
	volume: { override: boolean; level: number; wanted: WeakMap<HTMLMediaElement, number> };
}
const KEY = "__lunaAudioCompressor";
const shared: Shared = ((window as any)[KEY] ??= { graphs: new Map(), blocked: new WeakSet() });
shared.volume ??= { override: false, level: 1, wanted: new WeakMap() };

const volumeProp = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "volume")!;

/**
 * Tidal's player sets each element's volume to (volume bar level) x (loudness
 * normalization) x (crossfade ramp). With the volume bar driving Gain, the bar
 * level must not also turn the compressor's input down, so divide it back
 * out. Normalization and crossfades keep working.
 */
const realVolume = (wanted: number) => {
	const { override, level } = shared.volume;
	if (!override) return wanted;
	return level > 0 ? Math.min(1, wanted / level) : 0;
};

const installVolume = (element: HTMLMediaElement) => {
	if (Object.prototype.hasOwnProperty.call(element, "volume")) return; // already done by an earlier load
	shared.volume.wanted.set(element, volumeProp.get!.call(element));
	Object.defineProperty(element, "volume", {
		configurable: true,
		get: () => shared.volume.wanted.get(element) ?? 1,
		set: (value: number) => {
			shared.volume.wanted.set(element, value);
			volumeProp.set!.call(element, realVolume(value));
		},
	});
};

const applyVolume = (element: HTMLMediaElement) => {
	installVolume(element); // elements hooked by an older version of the plugin
	const wanted = shared.volume.wanted.get(element);
	if (wanted !== undefined) volumeProp.set!.call(element, realVolume(wanted));
};

/**
 * @param override Whether the volume bar is driving Gain instead of the element volume.
 * @param level Tidal's volume bar, 0-1.
 */
export const setVolumeMode = (override: boolean, level: number) => {
	shared.volume.override = override;
	shared.volume.level = level;
	for (const element of shared.graphs.keys()) applyVolume(element);
};

type SinkContext = AudioContext & { sinkId?: string | object; setSinkId?: (id: string) => Promise<void> };

/** The context's sinkId is an object when it outputs nowhere; treat that as the default device. */
const normalizeSink = (id: string | object | undefined) => (typeof id !== "string" || id === "default" ? "" : id);
type SinkElement = HTMLMediaElement & { sinkId?: string };

const getContext = (): SinkContext => {
	// "playback" uses bigger buffers than the default "interactive", so the
	// audio doesn't drop out when Tidal's UI keeps the page busy.
	shared.context ??= new AudioContext({ latencyHint: "playback" });
	return shared.context;
};

const getChain = () => {
	if (!shared.chain) {
		const audio = getContext();
		const compressor = audio.createDynamicsCompressor();
		const gain = audio.createGain();
		compressor.connect(gain);
		gain.connect(audio.destination);
		shared.chain = { compressor, gain };
	}
	return shared.chain;
};

// Older versions of the plugin gave each element its own compressor. Forget
// how those elements were routed so applyAll() moves them onto the shared one.
for (const graph of shared.graphs.values()) graph.on = null;

const applyParameters = (s: CompressorSettings) => {
	const { compressor, gain } = getChain();
	compressor.threshold.value = s.threshold;
	compressor.knee.value = s.knee;
	compressor.ratio.value = s.ratio;
	compressor.attack.value = s.attack;
	compressor.release.value = s.release;
	gain.gain.value = s.gain / 100;
};

const route = (graph: Graph, on: boolean) => {
	if (graph.on === on) return;
	graph.source.disconnect();
	graph.source.connect(on ? getChain().compressor : getContext().destination);
	graph.on = on;
};

export type HookResult = "ok" | "drm" | "failed";

/**
 * Route an element through the compressor. DRM-protected media plays as
 * silence through Web Audio, so encrypted elements are left alone.
 */
export const hook = (element: HTMLMediaElement, s: CompressorSettings, on: boolean): HookResult => {
	// Already hooked: nothing to do. Settings changes go through applyAll().
	if (shared.graphs.has(element)) return "ok";
	if (shared.blocked.has(element)) return "failed";
	if (element.mediaKeys) return "drm";
	const audio = getContext();
	let source: MediaElementAudioSourceNode;
	try {
		source = audio.createMediaElementSource(element);
	} catch (error) {
		shared.blocked.add(element);
		throw error;
	}
	const graph: Graph = { source, on: null };
	shared.graphs.set(element, graph);
	applyVolume(element);
	applyParameters(s);
	route(graph, on);
	return "ok";
};

/** Put the elements' own volume back (plugin unloading). */
export const releaseVolume = () => {
	shared.volume.override = false;
	for (const element of shared.graphs.keys()) applyVolume(element);
};

export const applyAll = (s: CompressorSettings, on: boolean) => {
	applyParameters(s);
	for (const graph of shared.graphs.values()) route(graph, on);
};

/**
 * Call onPlay just before a not-yet-hooked element starts playing. Hooking
 * an element while it plays reroutes its audio mid-stream, which hitches; the
 * player's second (gapless) element is otherwise only found once it's playing.
 * Only MediaSource (blob:) elements count: that's how Tidal's player streams
 * (through a <source> child, so check currentSrc rather than src).
 */
export const hookOnPlay = (onPlay: (element: HTMLMediaElement) => void) => {
	const original = (shared.play ??= HTMLMediaElement.prototype.play);
	HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
		try {
			if (!shared.graphs.has(this) && !shared.blocked.has(this) && this.currentSrc.startsWith("blob:")) onPlay(this);
		} catch {
			// Never stop the track from playing.
		}
		return original.call(this);
	};
	return () => {
		HTMLMediaElement.prototype.play = original;
	};
};

export const isHooked = (element: HTMLMediaElement) => shared.graphs.has(element);

/**
 * Once routed through Web Audio, the element's own output device is ignored,
 * so mirror the playing element's device onto the context. Switching devices
 * reopens the audio output, so only do it when the element's device changes.
 */
export const syncOutput = (element: SinkElement, starting = false) => {
	const audio = getContext();
	if (audio.state === "suspended" && (starting || !element.paused)) audio.resume().catch(() => {});
	if (typeof audio.setSinkId !== "function" || element.sinkId === undefined) return;
	// "" and "default" both mean the default device, and Tidal's two elements
	// don't agree on which they report. Treating them as different reopened the
	// output (about 100 ms of silence) at the start of every other track.
	const sinkId = normalizeSink(element.sinkId);
	const current = normalizeSink(audio.sinkId ?? shared.sinkId);
	if (sinkId === current) return;
	shared.sinkId = sinkId;
	audio.setSinkId(sinkId).catch(() => {});
};
