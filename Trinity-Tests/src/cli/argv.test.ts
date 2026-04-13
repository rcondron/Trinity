import { describe, expect, it } from "vitest";
import {
  buildParseArgv,
  getFlagValue,
  getCommandPath,
  getPrimaryCommand,
  getPositiveIntFlagValue,
  getVerboseFlag,
  hasHelpOrVersion,
  hasFlag,
  shouldMigrateState,
  shouldMigrateStateFromPath,
} from "./argv.js";

describe("argv helpers", () => {
  it.each([
    {
      name: "help flag",
      argv: ["node", "Trinity", "--help"],
      expected: true,
    },
    {
      name: "version flag",
      argv: ["node", "Trinity", "-V"],
      expected: true,
    },
    {
      name: "normal command",
      argv: ["node", "Trinity", "status"],
      expected: false,
    },
    {
      name: "root -v alias",
      argv: ["node", "Trinity", "-v"],
      expected: true,
    },
    {
      name: "root -v alias with profile",
      argv: ["node", "Trinity", "--profile", "work", "-v"],
      expected: true,
    },
    {
      name: "subcommand -v should not be treated as version",
      argv: ["node", "Trinity", "acp", "-v"],
      expected: false,
    },
    {
      name: "root -v alias with equals profile",
      argv: ["node", "Trinity", "--profile=work", "-v"],
      expected: true,
    },
    {
      name: "subcommand path after global root flags should not be treated as version",
      argv: ["node", "Trinity", "--dev", "skills", "list", "-v"],
      expected: false,
    },
  ])("detects help/version flags: $name", ({ argv, expected }) => {
    expect(hasHelpOrVersion(argv)).toBe(expected);
  });

  it.each([
    {
      name: "single command with trailing flag",
      argv: ["node", "Trinity", "status", "--json"],
      expected: ["status"],
    },
    {
      name: "two-part command",
      argv: ["node", "Trinity", "agents", "list"],
      expected: ["agents", "list"],
    },
    {
      name: "terminator cuts parsing",
      argv: ["node", "Trinity", "status", "--", "ignored"],
      expected: ["status"],
    },
  ])("extracts command path: $name", ({ argv, expected }) => {
    expect(getCommandPath(argv, 2)).toEqual(expected);
  });

  it.each([
    {
      name: "returns first command token",
      argv: ["node", "Trinity", "agents", "list"],
      expected: "agents",
    },
    {
      name: "returns null when no command exists",
      argv: ["node", "Trinity"],
      expected: null,
    },
  ])("returns primary command: $name", ({ argv, expected }) => {
    expect(getPrimaryCommand(argv)).toBe(expected);
  });

  it.each([
    {
      name: "detects flag before terminator",
      argv: ["node", "Trinity", "status", "--json"],
      flag: "--json",
      expected: true,
    },
    {
      name: "ignores flag after terminator",
      argv: ["node", "Trinity", "--", "--json"],
      flag: "--json",
      expected: false,
    },
  ])("parses boolean flags: $name", ({ argv, flag, expected }) => {
    expect(hasFlag(argv, flag)).toBe(expected);
  });

  it.each([
    {
      name: "value in next token",
      argv: ["node", "Trinity", "status", "--timeout", "5000"],
      expected: "5000",
    },
    {
      name: "value in equals form",
      argv: ["node", "Trinity", "status", "--timeout=2500"],
      expected: "2500",
    },
    {
      name: "missing value",
      argv: ["node", "Trinity", "status", "--timeout"],
      expected: null,
    },
    {
      name: "next token is another flag",
      argv: ["node", "Trinity", "status", "--timeout", "--json"],
      expected: null,
    },
    {
      name: "flag appears after terminator",
      argv: ["node", "Trinity", "--", "--timeout=99"],
      expected: undefined,
    },
  ])("extracts flag values: $name", ({ argv, expected }) => {
    expect(getFlagValue(argv, "--timeout")).toBe(expected);
  });

  it("parses verbose flags", () => {
    expect(getVerboseFlag(["node", "Trinity", "status", "--verbose"])).toBe(true);
    expect(getVerboseFlag(["node", "Trinity", "status", "--debug"])).toBe(false);
    expect(getVerboseFlag(["node", "Trinity", "status", "--debug"], { includeDebug: true })).toBe(
      true,
    );
  });

  it.each([
    {
      name: "missing flag",
      argv: ["node", "Trinity", "status"],
      expected: undefined,
    },
    {
      name: "missing value",
      argv: ["node", "Trinity", "status", "--timeout"],
      expected: null,
    },
    {
      name: "valid positive integer",
      argv: ["node", "Trinity", "status", "--timeout", "5000"],
      expected: 5000,
    },
    {
      name: "invalid integer",
      argv: ["node", "Trinity", "status", "--timeout", "nope"],
      expected: undefined,
    },
  ])("parses positive integer flag values: $name", ({ argv, expected }) => {
    expect(getPositiveIntFlagValue(argv, "--timeout")).toBe(expected);
  });

  it("builds parse argv from raw args", () => {
    const cases = [
      {
        rawArgs: ["node", "Trinity", "status"],
        expected: ["node", "Trinity", "status"],
      },
      {
        rawArgs: ["node-22", "Trinity", "status"],
        expected: ["node-22", "Trinity", "status"],
      },
      {
        rawArgs: ["node-22.2.0.exe", "Trinity", "status"],
        expected: ["node-22.2.0.exe", "Trinity", "status"],
      },
      {
        rawArgs: ["node-22.2", "Trinity", "status"],
        expected: ["node-22.2", "Trinity", "status"],
      },
      {
        rawArgs: ["node-22.2.exe", "Trinity", "status"],
        expected: ["node-22.2.exe", "Trinity", "status"],
      },
      {
        rawArgs: ["/usr/bin/node-22.2.0", "Trinity", "status"],
        expected: ["/usr/bin/node-22.2.0", "Trinity", "status"],
      },
      {
        rawArgs: ["nodejs", "Trinity", "status"],
        expected: ["nodejs", "Trinity", "status"],
      },
      {
        rawArgs: ["node-dev", "Trinity", "status"],
        expected: ["node", "Trinity", "node-dev", "Trinity", "status"],
      },
      {
        rawArgs: ["Trinity", "status"],
        expected: ["node", "Trinity", "status"],
      },
      {
        rawArgs: ["bun", "src/entry.ts", "status"],
        expected: ["bun", "src/entry.ts", "status"],
      },
    ] as const;

    for (const testCase of cases) {
      const parsed = buildParseArgv({
        programName: "Trinity",
        rawArgs: [...testCase.rawArgs],
      });
      expect(parsed).toEqual([...testCase.expected]);
    }
  });

  it("builds parse argv from fallback args", () => {
    const fallbackArgv = buildParseArgv({
      programName: "Trinity",
      fallbackArgv: ["status"],
    });
    expect(fallbackArgv).toEqual(["node", "Trinity", "status"]);
  });

  it("decides when to migrate state", () => {
    const nonMutatingArgv = [
      ["node", "Trinity", "status"],
      ["node", "Trinity", "health"],
      ["node", "Trinity", "sessions"],
      ["node", "Trinity", "config", "get", "update"],
      ["node", "Trinity", "config", "unset", "update"],
      ["node", "Trinity", "models", "list"],
      ["node", "Trinity", "models", "status"],
      ["node", "Trinity", "memory", "status"],
      ["node", "Trinity", "agent", "--message", "hi"],
    ] as const;
    const mutatingArgv = [
      ["node", "Trinity", "agents", "list"],
      ["node", "Trinity", "message", "send"],
    ] as const;

    for (const argv of nonMutatingArgv) {
      expect(shouldMigrateState([...argv])).toBe(false);
    }
    for (const argv of mutatingArgv) {
      expect(shouldMigrateState([...argv])).toBe(true);
    }
  });

  it.each([
    { path: ["status"], expected: false },
    { path: ["config", "get"], expected: false },
    { path: ["models", "status"], expected: false },
    { path: ["agents", "list"], expected: true },
  ])("reuses command path for migrate state decisions: $path", ({ path, expected }) => {
    expect(shouldMigrateStateFromPath(path)).toBe(expected);
  });
});

