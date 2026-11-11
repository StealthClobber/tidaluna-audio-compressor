import type { CompressorSettings } from "./defaults";

interface Graph {
	source: MediaElementAudioSourceNode;
	compressor: DynamicsCompressorNode;
	gain: GainNode;
	on: boolean | null;
}

// createMediaElementSource() can only ever be called once per element, and the
// element stays routed through that AudioContext for good. Keep the context and
// graphs on window so reloading or updating the plugin reuses them instead of
// hitting "already connected" (and so the old context is never closed, which
// would silence the element).
interface Shared {
	context?: AudioContext;
	graphs: Map<HTMLMediaElement, Graph>;
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

type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void> };
type SinkElement = HTMLMediaElement & { sinkId?: string };

const getContext = (): SinkContext => {
	// "playback" uses bigger buffers than the default "interactive", so the
	// audio doesn't drop out when Tidal's UI keeps the page busy.
	shared.context ??= new AudioContext({ latencyHint: "playback" });
	return shared.context;
};

const applyParameters = (graph: Graph, s: CompressorSettings) => {
	graph.compressor.threshold.value = s.threshold;
	graph.compressor.knee.value = s.knee;
	graph.compressor.ratio.value = s.ratio;
	graph.compressor.attack.value = s.attack;
	graph.compressor.release.value = s.release;
	graph.gain.gain.value = s.gain / 100;
};

const route = (graph: Graph, on: boolean) => {
	if (graph.on === on) return;
	const destination = getContext().destination;
	graph.source.disconnect();
	graph.source.connect(on ? graph.compressor : destination);
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
	const compressor = audio.createDynamicsCompressor();
	const gain = audio.createGain();
	compressor.connect(gain);
	gain.connect(audio.destination);
	const graph: Graph = { source, compressor, gain, on: null };
	shared.graphs.set(element, graph);
	applyVolume(element);
	applyParameters(graph, s);
	route(graph, on);
	return "ok";
};

/** Put the elements' own volume back (plugin unloading). */
export const releaseVolume = () => {
	shared.volume.override = false;
	for (const element of shared.graphs.keys()) applyVolume(element);
};

export const applyAll = (s: CompressorSettings, on: boolean) => {
	for (const graph of shared.graphs.values()) {
		applyParameters(graph, s);
		route(graph, on);
	}
};

export const isHooked = (element: HTMLMediaElement) => shared.graphs.has(element);

/**
 * Once routed through Web Audio, the element's own output device is ignored,
 * so mirror the playing element's device onto the context. Switching devices
 * reopens the audio output, so only do it when the element's device changes.
 */
export const syncOutput = (element: SinkElement) => {
	const audio = getContext();
	if (audio.state === "suspended" && !element.paused) audio.resume().catch(() => {});
	const sinkId = element.sinkId;
	if (typeof audio.setSinkId !== "function" || sinkId === undefined || sinkId === shared.sinkId) return;
	shared.sinkId = sinkId;
	audio.setSinkId(sinkId).catch(() => {});
};
