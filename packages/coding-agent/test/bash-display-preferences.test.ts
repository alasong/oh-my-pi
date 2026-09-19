import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import type { TUI } from "@oh-my-pi/pi-tui";
import { BashExecutionComponent } from "@oh-my-pi/pi-tui/chat/bash-execution";
import { setChatTranscriptDisplayPreferences } from "@oh-my-pi/pi-tui/chat/display-preferences";
import { getThemeByName, setThemeInstance, type Theme } from "@oh-my-pi/pi-tui/theme";
import { Settings, settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { beginSettingsTest, restoreSettingsTestState, type SettingsTestState } from "./helpers/settings-test-state";

const ui = { requestRender: () => {}, requestComponentRender: () => {} } as unknown as TUI;
const CHUNK_THROTTLE_MS = 50;

let darkTheme: Theme;
let settingsState: SettingsTestState | undefined;

beforeAll(async () => {
	const loaded = await getThemeByName("dark");
	expect(loaded).toBeDefined();
	darkTheme = loaded!;
});

beforeEach(async () => {
	settingsState = beginSettingsTest();
	await Settings.init({ inMemory: true });
	setThemeInstance(darkTheme);
});

afterEach(() => {
	// Restore the tui default so an override here cannot leak into the next file.
	setChatTranscriptDisplayPreferences({ lineDisplay: false });
	restoreSettingsTestState(settingsState);
	settingsState = undefined;
});

// The bash execution component lives in pi-tui, which has no settings access:
// the host pushes the resolved value into the shared display preferences. A
// dropped hook silently reverts the user's setting to the tui default, so this
// asserts the observable rendering, not the preference object.
describe("bash display settings reach the tui transcript", () => {
	it("buffers the incomplete trailing line only when line display is enabled", () => {
		vi.useFakeTimers();
		try {
			const immediate = new BashExecutionComponent("test", ui, false);
			immediate.appendOutput("partial");
			expect(immediate.getOutput()).toBe("partial");

			settings.override("bash.lineDisplay", true);

			const buffered = new BashExecutionComponent("test", ui, false);
			buffered.appendOutput("partial");
			expect(buffered.getOutput()).toBe("");

			vi.advanceTimersByTime(CHUNK_THROTTLE_MS);
			buffered.appendOutput(" line\n");
			expect(buffered.getOutput()).toBe("partial line");
		} finally {
			vi.useRealTimers();
		}
	});
});
