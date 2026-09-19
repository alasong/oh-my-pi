/** Process-wide display preferences applied by the host settings hooks. */
export interface ChatTranscriptDisplayPreferences {
	hideToolActivity: boolean;
	readToolResultPreview: boolean;
	showImages: boolean;
	cacheMissMarker: boolean;
	showTokenUsage: boolean;
	showTurnTime: boolean;
	/**
	 * Stream bash output line-by-line instead of char-by-char. Mirrors the host's
	 * `bash.lineDisplay`; the tui keeps the upstream default so it renders the
	 * same character-by-character stream with no host attached.
	 */
	lineDisplay: boolean;
}

/** Current transcript display preferences. */
export const chatTranscriptDisplayPreferences: ChatTranscriptDisplayPreferences = {
	hideToolActivity: false,
	readToolResultPreview: false,
	showImages: true,
	cacheMissMarker: false,
	showTokenUsage: false,
	showTurnTime: false,
	lineDisplay: false,
};

/** Apply host display preferences without pulling settings into the renderer. */
export function setChatTranscriptDisplayPreferences(preferences: Partial<ChatTranscriptDisplayPreferences>): void {
	Object.assign(chatTranscriptDisplayPreferences, preferences);
}
