/**
 * Recognizes commands whose non-zero exit status is a normal, expected answer
 * rather than a failure.
 *
 * `grep` with no matches, `diff` with differences, a false `test` and their
 * relatives report their "negative answer" as a non-zero exit. The bash tool
 * keeps that exit code visible but reports the completion as a warning instead
 * of an error, so an expected answer is not read as a broken command (and the
 * failure-rate telemetry is not inflated).
 *
 * The whitelist is deliberately conservative: a command is recognized only when
 * it is the sole exit-status-determining segment, its executable and arguments
 * match a known family, and the exit code is one that family uses for its
 * normal negative answer. Any ambiguity — an `&&` chain, an interpreter
 * wrapper, an unexpected exit code — leaves the result an error.
 *
 * `find` is deliberately absent: matching nothing still exits 0, so a non-zero
 * exit means something went wrong (missing path, permission denied, invalid
 * expression) rather than answering "no".
 */
import { extractFlatShellCommandSegments, tokenizeShellSegments } from "./shell-tokenize";

/** Exit codes each command family uses for its normal negative answer. */
const EXPECTED_NEGATIVE_EXIT_CODES: Record<string, readonly number[]> = {
	grep: [1],
	egrep: [1],
	fgrep: [1],
	rg: [1],
	diff: [1],
	cmp: [1],
	// `ls` exits 1 for minor problems and 2 for an inaccessible operand; both are
	// how a missing path in a probe is reported.
	ls: [1, 2],
	test: [1],
	"[": [1],
	"[[": [1],
};

/** `sort` reports an unordered input as exit 1 only when it is checking. */
const SORT_CHECK_FLAG = /^(?:-[^-]*[cC][^-]*|--check)$/u;

/** `git diff` exits 1 for differences only when asked to report them that way. */
const GIT_DIFF_EXIT_FLAGS: Record<string, true> = {
	"--exit-code": true,
	"--quiet": true,
	"--no-index": true,
};

/** A `VAR=value` prefix in front of the executable. */
const ENVIRONMENT_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/u;

/**
 * True when `exitCode` is `command`'s normal negative answer. Callers still
 * surface the exit code; they only reclassify the failure state.
 */
export function isExpectedNegativeExit(command: string, exitCode: number): boolean {
	if (exitCode === 0) return false;
	const argv = exitStatusArgv(command);
	if (argv === undefined) return false;
	// The basename, so `/usr/bin/grep` names the same family as `grep`.
	const separator = Math.max(argv[0].lastIndexOf("/"), argv[0].lastIndexOf("\\"));
	const executable = argv[0].slice(separator + 1);
	if (executable === "git") {
		return (
			argv[1] === "diff" && exitCode === 1 && argv.slice(2).some(argument => GIT_DIFF_EXIT_FLAGS[argument] === true)
		);
	}
	if (executable === "sort") {
		return exitCode === 1 && argv.slice(1).some(argument => SORT_CHECK_FLAG.test(argument));
	}
	const codes = EXPECTED_NEGATIVE_EXIT_CODES[executable];
	return codes !== undefined && codes.includes(exitCode);
}

/**
 * The argv of the segment that determines the command's exit status, or
 * `undefined` when that segment cannot be attributed with confidence.
 *
 * In a `;`/newline/`|`/`||` list the last command always supplies the status,
 * so the final segment is used. An `&&` list can instead inherit an earlier
 * segment's failure, a redirection can fail on its own before the command runs,
 * and shell syntax beyond flat segments is not modeled here: all decline.
 */
function exitStatusArgv(command: string): string[] | undefined {
	if (hasExitCodeObscuringSyntax(command)) return undefined;
	const segments = extractFlatShellCommandSegments(command);
	if (segments.length === 0) return undefined;
	const tokens = tokenizeShellSegments(segments[segments.length - 1].text);
	if (tokens.length !== 1) return undefined;
	return stripEnvironmentAssignments(tokens[0]);
}

/**
 * Whether the command uses unquoted syntax that makes a non-zero exit
 * unattributable to the last segment: an `&&` list shares one exit status
 * across every segment, and a redirection can fail on its own before the
 * command even runs.
 */
function hasExitCodeObscuringSyntax(command: string): boolean {
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < command.length; i++) {
		const ch = command[i];
		if (inSingle) {
			if (ch === "'") inSingle = false;
			continue;
		}
		if (inDouble) {
			if (ch === "\\") {
				i++;
			} else if (ch === '"') {
				inDouble = false;
			}
			continue;
		}
		if (ch === "\\") {
			i++;
			continue;
		}
		if (ch === "'") {
			inSingle = true;
			continue;
		}
		if (ch === '"') {
			inDouble = true;
			continue;
		}
		if ((ch === "&" && command[i + 1] === "&") || ch === ">" || ch === "<") return true;
	}
	return false;
}

function stripEnvironmentAssignments(argv: string[]): string[] | undefined {
	let index = 0;
	while (index < argv.length && ENVIRONMENT_ASSIGNMENT.test(argv[index])) index++;
	return index < argv.length ? argv.slice(index) : undefined;
}
