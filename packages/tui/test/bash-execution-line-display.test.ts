import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import type { TUI } from "@oh-my-pi/pi-tui";
import { BashExecutionComponent } from "@oh-my-pi/pi-tui/chat/bash-execution";
import { setChatTranscriptDisplayPreferences } from "@oh-my-pi/pi-tui/chat/display-preferences";
import { getThemeByName, setThemeInstance, type Theme } from "@oh-my-pi/pi-tui/theme";

const ui = { requestRender: () => {}, requestComponentRender: () => {} } as unknown as TUI;

// `#chunkGate` drops chunks arriving within CHUNK_THROTTLE_MS (50ms) of the last
// processed one; advancing the fake clock by this much reopens it.
const CHUNK_THROTTLE_MS = 50;

let darkTheme: Theme;

beforeAll(async () => {
	const loaded = await getThemeByName("dark");
	expect(loaded).toBeDefined();
	darkTheme = loaded!;
});

afterAll(() => {
	setChatTranscriptDisplayPreferences({ lineDisplay: false });
});

describe("BashExecutionComponent line-based display (bash.lineDisplay)", () => {
	beforeEach(() => {
		setThemeInstance(darkTheme);
		// Reset the shared preference so cases do not leak into each other or
		// into other files rendering bash blocks in the same process.
		setChatTranscriptDisplayPreferences({ lineDisplay: false });
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("holds back an incomplete trailing line until a newline arrives", () => {
		setChatTranscriptDisplayPreferences({ lineDisplay: true });

		const component = new BashExecutionComponent("test", ui, false);
		component.appendOutput("hello");
		expect(component.getOutput()).toBe("");

		vi.advanceTimersByTime(CHUNK_THROTTLE_MS);
		component.appendOutput(" world\n");
		expect(component.getOutput()).toBe("hello world");
	});

	it("flushes the buffered trailing line on completion without a newline", () => {
		setChatTranscriptDisplayPreferences({ lineDisplay: true });

		const component = new BashExecutionComponent("test", ui, false);
		component.appendOutput("partial");
		expect(component.getOutput()).toBe("");
		component.setComplete(0, false);
		expect(component.getOutput()).toBe("partial");
	});

	it("flushes each complete line as it arrives and keeps partial ones pending", () => {
		setChatTranscriptDisplayPreferences({ lineDisplay: true });

		const component = new BashExecutionComponent("test", ui, false);
		component.appendOutput("line1\nline2\n");
		expect(component.getOutput()).toBe("line1\nline2");

		vi.advanceTimersByTime(CHUNK_THROTTLE_MS);
		component.appendOutput("line3");
		expect(component.getOutput()).toBe("line1\nline2");

		vi.advanceTimersByTime(CHUNK_THROTTLE_MS);
		component.appendOutput("\nline4\n");
		expect(component.getOutput()).toBe("line1\nline2\nline3\nline4");
	});

	it("merges a line split across chunk boundaries in line mode", () => {
		setChatTranscriptDisplayPreferences({ lineDisplay: true });

		const component = new BashExecutionComponent("test", ui, false);
		component.appendOutput("split-across");
		vi.advanceTimersByTime(CHUNK_THROTTLE_MS);
		component.appendOutput("-chunks\n");
		expect(component.getOutput()).toBe("split-across-chunks");
	});

	it("streams character-by-character while the preference is off", () => {
		const component = new BashExecutionComponent("test", ui, false);
		component.appendOutput("hello");
		expect(component.getOutput()).toBe("hello");
	});
});
