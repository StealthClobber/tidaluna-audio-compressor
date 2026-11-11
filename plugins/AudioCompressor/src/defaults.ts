// Compressor values match the FrankerFaceZ defaults (same as the Chrome extension).
export const DEFAULTS = {
	threshold: -50,
	knee: 40,
	ratio: 12,
	attack: 0,
	release: 0.25,
	gain: 100,
};

export type CompressorSettings = typeof DEFAULTS;

export interface SliderDef {
	key: keyof CompressorSettings;
	label: string;
	min: number;
	max: number;
	step: number;
	format: (v: number) => string;
	hint: string;
}

export const SLIDERS: readonly SliderDef[] = [
	{ key: "gain", label: "Gain", min: 0, max: 200, step: 1, format: (v) => `${v}%`, hint: "Volume after compression. 100% is no change." },
	{ key: "threshold", label: "Threshold", min: -100, max: 0, step: 1, format: (v) => `${v} dB`, hint: "Level above which compression starts." },
	{ key: "knee", label: "Knee", min: 0, max: 40, step: 1, format: (v) => `${v} dB`, hint: "Range over which compression fades in." },
	{ key: "ratio", label: "Ratio", min: 1, max: 20, step: 1, format: (v) => `${v}:1`, hint: "Input dB needed for 1 dB more output." },
	{ key: "attack", label: "Attack", min: 0, max: 1, step: 0.01, format: (v) => `${v} s`, hint: "Time taken to turn the volume down by 10 dB." },
	{ key: "release", label: "Release", min: 0, max: 1, step: 0.01, format: (v) => `${v} s`, hint: "Time taken to turn the volume back up by 10 dB." },
];
