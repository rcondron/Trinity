import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatCliCommand } from "./command-format.js";
import { applyCliProfileEnv, parseCliProfileArgs } from "./profile.js";

describe("parseCliProfileArgs", () => {
  it("leaves gateway --dev for subcommands", () => {
    const res = parseCliProfileArgs([
      "node",
      "Trinity",
      "gateway",
      "--dev",
      "--allow-unconfigured",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual(["node", "Trinity", "gateway", "--dev", "--allow-unconfigured"]);
  });

  it("still accepts global --dev before subcommand", () => {
    const res = parseCliProfileArgs(["node", "Trinity", "--dev", "gateway"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("dev");
    expect(res.argv).toEqual(["node", "Trinity", "gateway"]);
  });

  it("parses --profile value and strips it", () => {
    const res = parseCliProfileArgs(["node", "Trinity", "--profile", "work", "status"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "Trinity", "status"]);
  });

  it("rejects missing profile value", () => {
    const res = parseCliProfileArgs(["node", "Trinity", "--profile"]);
    expect(res.ok).toBe(false);
  });

  it.each([
    ["--dev first", ["node", "Trinity", "--dev", "--profile", "work", "status"]],
    ["--profile first", ["node", "Trinity", "--profile", "work", "--dev", "status"]],
  ])("rejects combining --dev with --profile (%s)", (_name, argv) => {
    const res = parseCliProfileArgs(argv);
    expect(res.ok).toBe(false);
  });
});

describe("applyCliProfileEnv", () => {
  it("fills env defaults for dev profile", () => {
    const env: Record<string, string | undefined> = {};
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    const expectedStateDir = path.join(path.resolve("/home/peter"), ".Trinity-dev");
    expect(env.Trinity_PROFILE).toBe("dev");
    expect(env.Trinity_STATE_DIR).toBe(expectedStateDir);
    expect(env.Trinity_CONFIG_PATH).toBe(path.join(expectedStateDir, "Trinity.json"));
    expect(env.Trinity_GATEWAY_PORT).toBe("19001");
  });

  it("does not override explicit env values", () => {
    const env: Record<string, string | undefined> = {
      Trinity_STATE_DIR: "/custom",
      Trinity_GATEWAY_PORT: "19099",
    };
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    expect(env.Trinity_STATE_DIR).toBe("/custom");
    expect(env.Trinity_GATEWAY_PORT).toBe("19099");
    expect(env.Trinity_CONFIG_PATH).toBe(path.join("/custom", "Trinity.json"));
  });

  it("uses Trinity_HOME when deriving profile state dir", () => {
    const env: Record<string, string | undefined> = {
      Trinity_HOME: "/srv/Trinity-home",
      HOME: "/home/other",
    };
    applyCliProfileEnv({
      profile: "work",
      env,
      homedir: () => "/home/fallback",
    });

    const resolvedHome = path.resolve("/srv/Trinity-home");
    expect(env.Trinity_STATE_DIR).toBe(path.join(resolvedHome, ".Trinity-work"));
    expect(env.Trinity_CONFIG_PATH).toBe(
      path.join(resolvedHome, ".Trinity-work", "Trinity.json"),
    );
  });
});

describe("formatCliCommand", () => {
  it.each([
    {
      name: "no profile is set",
      cmd: "Trinity doctor --fix",
      env: {},
      expected: "Trinity doctor --fix",
    },
    {
      name: "profile is default",
      cmd: "Trinity doctor --fix",
      env: { Trinity_PROFILE: "default" },
      expected: "Trinity doctor --fix",
    },
    {
      name: "profile is Default (case-insensitive)",
      cmd: "Trinity doctor --fix",
      env: { Trinity_PROFILE: "Default" },
      expected: "Trinity doctor --fix",
    },
    {
      name: "profile is invalid",
      cmd: "Trinity doctor --fix",
      env: { Trinity_PROFILE: "bad profile" },
      expected: "Trinity doctor --fix",
    },
    {
      name: "--profile is already present",
      cmd: "Trinity --profile work doctor --fix",
      env: { Trinity_PROFILE: "work" },
      expected: "Trinity --profile work doctor --fix",
    },
    {
      name: "--dev is already present",
      cmd: "Trinity --dev doctor",
      env: { Trinity_PROFILE: "dev" },
      expected: "Trinity --dev doctor",
    },
  ])("returns command unchanged when $name", ({ cmd, env, expected }) => {
    expect(formatCliCommand(cmd, env)).toBe(expected);
  });

  it("inserts --profile flag when profile is set", () => {
    expect(formatCliCommand("Trinity doctor --fix", { Trinity_PROFILE: "work" })).toBe(
      "Trinity --profile work doctor --fix",
    );
  });

  it("trims whitespace from profile", () => {
    expect(formatCliCommand("Trinity doctor --fix", { Trinity_PROFILE: "  jbTrinity  " })).toBe(
      "Trinity --profile jbTrinity doctor --fix",
    );
  });

  it("handles command with no args after Trinity", () => {
    expect(formatCliCommand("Trinity", { Trinity_PROFILE: "test" })).toBe(
      "Trinity --profile test",
    );
  });

  it("handles pnpm wrapper", () => {
    expect(formatCliCommand("pnpm Trinity doctor", { Trinity_PROFILE: "work" })).toBe(
      "pnpm Trinity --profile work doctor",
    );
  });
});

