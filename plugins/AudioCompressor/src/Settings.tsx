import React from "react";

import { LunaButtonSetting, LunaSetting, LunaSettings, LunaSwitchSetting } from "@luna/ui";

import Slider from "@mui/material/Slider";
import Typography from "@mui/material/Typography";

import { gainChanged, listeners, refresh, status, storage } from ".";
import { DEFAULTS, SLIDERS, type CompressorSettings } from "./defaults";

const readValues = () => {
	const current = { ...DEFAULTS };
	for (const key of Object.keys(DEFAULTS) as (keyof CompressorSettings)[]) current[key] = storage[key];
	return current;
};

const describe = () => {
	if (status.error) return `Not working: ${status.error}`;
	if (status.result === "drm") return "This track is DRM-protected and plays without compression.";
	if (status.result === "failed") return "Couldn't attach to this track's audio. See the console for details.";
	if (status.player === "none") return "Start playing something to hear the compressor.";
	return `Playing through Tidal's browser player (${status.player}).`;
};

export const Settings = () => {
	const [enabled, setEnabled] = React.useState(storage.enabled);
	const [volumeGain, setVolumeGain] = React.useState(storage.volumeGain);
	const [values, setValues] = React.useState<CompressorSettings>(readValues);
	const [note, setNote] = React.useState(describe);

	React.useEffect(() => {
		const timer = setInterval(() => setNote(describe()), 1000);
		// The player-bar button and the volume bar change these too.
		const listener = () => {
			setEnabled(storage.enabled);
			setValues(readValues());
		};
		listeners.add(listener);
		return () => {
			clearInterval(timer);
			listeners.delete(listener);
		};
	}, []);

	const setValue = (key: keyof CompressorSettings, value: number) => {
		storage[key] = value;
		setValues((prev) => ({ ...prev, [key]: value }));
		if (key === "gain") gainChanged();
		refresh();
	};

	return (
		<>
			<LunaSettings title="Audio Compressor" desc={note}>
				<LunaSwitchSetting
					title="Compressor"
					desc="Evens out loud and quiet parts. Gain only applies while this is on."
					checked={enabled}
					onChange={(_, checked) => {
						setEnabled((storage.enabled = checked));
						refresh();
					}}
				/>
				<LunaSwitchSetting
					title="Volume bar controls Gain"
					desc="While the compressor is on, Tidal's volume bar sets Gain: the middle is no change, the top is 200%. Your normal volume comes back when the compressor is off."
					checked={volumeGain}
					onChange={(_, checked) => {
						setVolumeGain((storage.volumeGain = checked));
						refresh();
					}}
				/>
				{SLIDERS.map((def) => (
					<LunaSetting key={def.key} title={def.label} desc={def.hint}>
						<Slider
							sx={{ marginLeft: 4, marginRight: 2 }}
							size="small"
							min={def.min}
							max={def.max}
							step={def.step}
							value={values[def.key]}
							onChange={(_, value) => setValue(def.key, value as number)}
						/>
						<Typography sx={{ minWidth: 64, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{def.format(values[def.key])}</Typography>
					</LunaSetting>
				))}
				<LunaButtonSetting
					title="Reset"
					desc="Back to the FrankerFaceZ defaults."
					children="Reset to defaults"
					onClick={() => {
						for (const key of Object.keys(DEFAULTS) as (keyof CompressorSettings)[]) storage[key] = DEFAULTS[key];
						setValues({ ...DEFAULTS });
						gainChanged();
						refresh();
					}}
				/>
			</LunaSettings>
			<LunaSettings title="About the browser player">
				<Typography variant="body2" sx={{ opacity: 0.8 }}>
					Tidal normally plays lossless and hi-res tracks through a native player outside the app, where plugins can't reach the sound. While this plugin is on,
					Tidal uses its browser player for every quality, the same one the Tidal web app uses. Exclusive mode isn't available on the browser player. Turning the
					plugin off switches back to the native player.
				</Typography>
			</LunaSettings>
		</>
	);
};
