import { findModuleProperty } from "@luna/core";
import { PlayState, redux } from "@luna/lib";

import { trace } from ".";

// Tidal's player SDK (@tidal-music/player) picks a player per track from a
// config. The desktop app sends lossless and hi-res tracks to "native" (a
// separate audio process a plugin can't touch). The web app sends everything
// to "shaka", which plays through ordinary <video> elements in the page.
// These two configs are copied from Tidal's own bundle.
interface PlayerConfig {
	events: boolean;
	outputDevices: boolean;
	players: { itemTypes: string[]; player: string; qualities?: string[] }[];
}

export const BROWSER_CONFIG: PlayerConfig = {
	events: true,
	outputDevices: true,
	players: [{ itemTypes: ["track", "video"], player: "shaka", qualities: ["LOW", "HIGH", "LOSSLESS", "HI_RES_LOSSLESS"] }],
};

export const DESKTOP_CONFIG: PlayerConfig = {
	events: true,
	outputDevices: true,
	players: [
		{ itemTypes: ["track", "video"], player: "shaka", qualities: ["LOW", "HIGH"] },
		{ itemTypes: ["track"], player: "native", qualities: ["LOSSLESS", "HI_RES", "HI_RES_LOSSLESS"] },
	],
};

interface SdkPlayer {
	name: string;
	mediaElement?: HTMLMediaElement;
}
interface SdkState {
	activePlayer?: SdkPlayer;
	preloadPlayer?: SdkPlayer;
}

const source = (value: unknown) => (typeof value === "function" ? Function.prototype.toString.call(value) : "");

// The SDK's names are minified and change between Tidal builds, so these are
// found by what the functions do rather than what they're called.
//   bootstrap:  function(e){...e.outputDevices===!0&&X({outputDevicesEnabled:!0}),Y(e.players)}
//   getMediaElement: switch(activePlayer.name){case`shakaPlayer`:return e.mediaElement ...}
let sdk: { bootstrap: (config: PlayerConfig) => void; getMediaElement: () => HTMLMediaElement | null; state: SdkState } | undefined;

export const getSdk = () => {
	if (sdk) return sdk;
	const bootstrap = findModuleProperty<(config: PlayerConfig) => void>((_, v) =>
		/outputDevicesEnabled:!0\}\),[\w$]+\([\w$]+\.players\)/.test(source(v)),
	)?.value;
	const getMediaElement = findModuleProperty<() => HTMLMediaElement | null>((_, v) =>
		/case`shakaPlayer`:return [\w$]+\.mediaElement/.test(source(v)),
	)?.value;
	const state = findModuleProperty<SdkState>(
		(_, v) => typeof v === "object" && v !== null && "activePlayer" in v && "preloadPlayer" in v,
	)?.value;
	if (!bootstrap || !getMediaElement || !state) {
		const missing = Object.entries({ bootstrap, getMediaElement, state })
			.filter(([, v]) => !v)
			.map(([k]) => k);
		throw new Error(`Couldn't find Tidal's player internals (${missing.join(", ")}). This Tidal version may not be supported.`);
	}
	sdk = { bootstrap, getMediaElement, state };
	return sdk;
};

export const activePlayerName = () => getSdk().state.activePlayer?.name;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Swap the SDK's player config. bootstrap() also forgets the active player, so
 * if a track is loaded on a player the new config won't use, reload it on the
 * new one at the same position.
 */
export const applyConfig = async (config: PlayerConfig) => {
	const { bootstrap, state } = getSdk();
	const current = state.activePlayer?.name;
	const wanted = new Set(config.players.map((p) => `${p.player}Player`));
	if (!current || wanted.has(current)) {
		// Nothing loaded, or the current player stays valid. Keep it active
		// so the play/pause buttons keep controlling it.
		const active = state.activePlayer;
		bootstrap(config);
		if (active) state.activePlayer = active;
		return;
	}

	const wasPlaying = PlayState.playing;
	const position = PlayState.currentTime;
	trace.log(`Moving current track from ${current} at ${position.toFixed(1)}s`);
	PlayState.pause();
	await sleep(150);
	bootstrap(config);
	PlayState.moveTo(PlayState.playQueue.currentIndex);
	await sleep(500);
	if (position > 1) PlayState.seek(position);
	if (wasPlaying) redux.actions["playbackControls/PLAY"]();
	else PlayState.pause();
};
