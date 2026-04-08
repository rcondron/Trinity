# Security Policy

If you believe you've found a security issue in Trinity, please report it privately.

## Reporting

Report vulnerabilities directly to the repository where the issue lives:

- **Core CLI and gateway** — [Trinity/Trinity](https://github.com/Trinity/Trinity)
- **macOS desktop app** — [Trinity/Trinity](https://github.com/Trinity/Trinity) (apps/macos)
- **iOS app** — [Trinity/Trinity](https://github.com/Trinity/Trinity) (apps/ios)
- **Android app** — [Trinity/Trinity](https://github.com/Trinity/Trinity) (apps/android)
- **ClawHub** — [Trinity/clawhub](https://github.com/Trinity/clawhub)
- **Trust and threat model** — [Trinity/trust](https://github.com/Trinity/trust)

For issues that don't fit a specific repo, or if you're unsure, email **security@Trinity.ai** and we'll route it.

For full reporting instructions see our [Trust page](https://trust.Trinity.ai).

### Required in Reports

1. **Title**
2. **Severity Assessment**
3. **Impact**
4. **Affected Component**
5. **Technical Reproduction**
6. **Demonstrated Impact**
7. **Environment**
8. **Remediation Advice**

Reports without reproduction steps, demonstrated impact, and remediation advice will be deprioritized. Given the volume of AI-generated scanner findings, we must ensure we're receiving vetted reports from researchers who understand the issues.

## Security & Trust

**Jamieson O'Reilly** ([@theonejvo](https://twitter.com/theonejvo)) is Security & Trust at Trinity. Jamieson is the founder of [Dvuln](https://dvuln.com) and brings extensive experience in offensive security, penetration testing, and security program development.

## Bug Bounties

Trinity is a labor of love. There is no bug bounty program and no budget for paid reports. Please still disclose responsibly so we can fix issues quickly.
The best way to help the project right now is by sending PRs.

## Maintainers: GHSA Updates via CLI

When patching a GHSA via `gh api`, include `X-GitHub-Api-Version: 2022-11-28` (or newer). Without it, some fields (notably CVSS) may not persist even if the request returns 200.

## Out of Scope

- Public Internet Exposure
- Using Trinity in ways that the docs recommend not to
- Deployments where mutually untrusted/adversarial operators share one gateway host and config
- Prompt injection attacks

## Deployment Assumptions

Trinity security guidance assumes:

- The host where Trinity runs is within a trusted OS/admin boundary.
- Anyone who can modify `~/.Trinity` state/config (including `Trinity.json`) is effectively a trusted operator.
- A single Gateway shared by mutually untrusted people is **not a recommended setup**. Use separate gateways (or at minimum separate OS users/hosts) per trust boundary.

## Plugin Trust Boundary

Plugins/extensions are loaded **in-process** with the Gateway and are treated as trusted code.

- Plugins can execute with the same OS privileges as the Trinity process.
- Runtime helpers (for example `runtime.system.runCommandWithTimeout`) are convenience APIs, not a sandbox boundary.
- Only install plugins you trust, and prefer `plugins.allow` to pin explicit trusted plugin ids.

## Operational Guidance

For threat model + hardening guidance (including `Trinity security audit --deep` and `--fix`), see:

- `https://docs.Trinity.ai/gateway/security`

### Tool filesystem hardening

- `tools.exec.applyPatch.workspaceOnly: true` (recommended): keeps `apply_patch` writes/deletes within the configured workspace directory.
- `tools.fs.workspaceOnly: true` (optional): restricts `read`/`write`/`edit`/`apply_patch` paths to the workspace directory.
- Avoid setting `tools.exec.applyPatch.workspaceOnly: false` unless you fully trust who can trigger tool execution.

### Web Interface Safety

Trinity's web interface (Gateway Control UI + HTTP endpoints) is intended for **local use only**.

- Recommended: keep the Gateway **loopback-only** (`127.0.0.1` / `::1`).
  - Config: `gateway.bind="loopback"` (default).
  - CLI: `Trinity gateway run --bind loopback`.
- Canvas host note: network-visible canvas is **intentional** for trusted node scenarios (LAN/tailnet).
  - Expected setup: non-loopback bind + Gateway auth (token/password/trusted-proxy) + firewall/tailnet controls.
  - Expected routes: `/__Trinity__/canvas/`, `/__Trinity__/a2ui/`.
  - This deployment model alone is not a security vulnerability.
- Do **not** expose it to the public internet (no direct bind to `0.0.0.0`, no public reverse proxy). It is not hardened for public exposure.
- If you need remote access, prefer an SSH tunnel or Tailscale serve/funnel (so the Gateway still binds to loopback), plus strong Gateway auth.
- The Gateway HTTP surface includes the canvas host (`/__Trinity__/canvas/`, `/__Trinity__/a2ui/`). Treat canvas content as sensitive/untrusted and avoid exposing it beyond loopback unless you understand the risk.

## Runtime Requirements

### Node.js Version

Trinity requires **Node.js 22.12.0 or later** (LTS). This version includes important security patches:

- CVE-2025-59466: async_hooks DoS vulnerability
- CVE-2026-21636: Permission model bypass vulnerability

Verify your Node.js version:

```bash
node --version  # Should be v22.12.0 or later
```

### Docker Security

When running Trinity in Docker:

1. The official image runs as a non-root user (`node`) for reduced attack surface
2. Use `--read-only` flag when possible for additional filesystem protection
3. Limit container capabilities with `--cap-drop=ALL`

Example secure Docker run:

```bash
docker run --read-only --cap-drop=ALL \
  -v Trinity-data:/app/data \
  Trinity/Trinity:latest
```

## Security Scanning

This project uses `detect-secrets` for automated secret detection in CI/CD.
See `.detect-secrets.cfg` for configuration and `.secrets.baseline` for the baseline.

Run locally:

```bash
pip install detect-secrets==1.5.0
detect-secrets scan --baseline .secrets.baseline
```

