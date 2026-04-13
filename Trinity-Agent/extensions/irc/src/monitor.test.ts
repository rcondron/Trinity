import { describe, expect, it } from "vitest";
import { resolveIrcInboundTarget } from "./monitor.js";

describe("irc monitor inbound target", () => {
  it("keeps channel target for group messages", () => {
    expect(
      resolveIrcInboundTarget({
        target: "#Trinity",
        senderNick: "alice",
      }),
    ).toEqual({
      isGroup: true,
      target: "#Trinity",
      rawTarget: "#Trinity",
    });
  });

  it("maps DM target to sender nick and preserves raw target", () => {
    expect(
      resolveIrcInboundTarget({
        target: "Trinity-bot",
        senderNick: "alice",
      }),
    ).toEqual({
      isGroup: false,
      target: "alice",
      rawTarget: "Trinity-bot",
    });
  });

  it("falls back to raw target when sender nick is empty", () => {
    expect(
      resolveIrcInboundTarget({
        target: "Trinity-bot",
        senderNick: " ",
      }),
    ).toEqual({
      isGroup: false,
      target: "Trinity-bot",
      rawTarget: "Trinity-bot",
    });
  });
});

