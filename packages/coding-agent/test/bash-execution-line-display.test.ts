import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { resetSettingsForTest, Settings, settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { BashExecutionComponent } from "@oh-my-pi/pi-coding-agent/modes/components/bash-execution";
import { getThemeByName, setThemeInstance, type Theme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { TUI } from "@oh-my-pi/pi-tui";

const ui = { requestRender: () => {}, requestComponentRender: () => {} } as unknown as TUI;

let darkTheme: Theme;

beforeAll(async () => {
	const loaded = await getThemeByName("dark");
	expect(loaded).toBeDefined();
	darkTheme = loaded!;
});

afterAll(() => {
	resetSettingsForTest();
});

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

// The component's `#chunkGate` drops chunks arriving within CHUNK_THROTTLE_MS
// (50ms) of the last processed one, so multi-chunk sequences must pace the
// appends across that window.
const CHUNK_WINDOW_MS = 60;

async function initSettings(lineDisplay: boolean): Promise<void> {
	resetSettingsForTest();
	await Settings.init({ inMemory: true });
	settings.override("bash.lineDisplay", lineDisplay);
}

describe("BashExecutionComponent line-based display (bash.lineDisplay)", () => {
	beforeEach(() => {
		setThemeInstance(darkTheme);
	});

	it("holds back an incomplete trailing line until a newline arrives", async () => {
		await initSettings(true);

		const component = new BashExecutionComponent("test", ui, false);
		component.appendOutput("hello");
		expect(component.getOutput()).toBe("");

		await sleep(CHUNK_WINDOW_MS);
		component.appendOutput(" world\n");
		expect(component.getOutput()).toBe("hello world");
	});

	it("flushes the buffered trailing line on completion without a newline", async () => {
		await initSettings(true);

		const component = new BashExecutionComponent("test", ui, false);
		component.appendOutput("partial");
		expect(component.getOutput()).toBe("");
		component.setComplete(0, false);
		expect(component.getOutput()).toBe("partial");
	});

	it("flushes each complete line as it arrives and keeps partial ones pending", async () => {
		await initSettings(true);

		const component = new BashExecutionComponent("test", ui, false);
		component.appendOutput("line1\nline2\n");
		expect(component.getOutput()).toBe("line1\nline2");

		await sleep(CHUNK_WINDOW_MS);
		component.appendOutput("line3");
		expect(component.getOutput()).toBe("line1\nline2");

		await sleep(CHUNK_WINDOW_MS);
		component.appendOutput("\nline4\n");
		expect(component.getOutput()).toBe("line1\nline2\nline3\nline4");
	});

	it("merges a line split across chunk boundaries in line mode", async () => {
		await initSettings(true);

		const component = new BashExecutionComponent("test", ui, false);
		component.appendOutput("split-across");
		await sleep(CHUNK_WINDOW_MS);
		component.appendOutput("-chunks\n");
		expect(component.getOutput()).toBe("split-across-chunks");
	});

	it("keeps the original char-by-char behavior when line display is off", async () => {
		await initSettings(false);

		const component = new BashExecutionComponent("test", ui, false);
		component.appendOutput("hello");
		expect(component.getOutput()).toBe("hello");
	});

	it("defaults to char-by-char when settings are not initialized", () => {
		resetSettingsForTest();

		const component = new BashExecutionComponent("test", ui, false);
		component.appendOutput("streamed");
		expect(component.getOutput()).toBe("streamed");
	});
});
