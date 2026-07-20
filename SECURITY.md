# Security Policy

## Supported Versions

`@essentianlabs/radar-lite` is currently BETA and released as `0.x.y`.
Security fixes are applied to the latest published version. Older versions
are not backported.

| Version | Support status |
|---------|---------------|
| `0.4.x` (current) | Actively supported — bug + security fixes |
| `0.3.x` | Deprecated — no further updates. Upgrade to `0.4.6+` |
| `< 0.3.0` | Unsupported |

## Reporting a Vulnerability

**Please do NOT open a public GitHub issue for security-sensitive reports.**

Two private channels:

1. **GitHub Private Vulnerability Reporting** (preferred)
   Open a private advisory at: <https://github.com/ktkorpela-prog/radar-lite/security/advisories/new>
   This creates a private issue only visible to maintainers.

2. **Email**
   `ktkorpela@essentianlabs.com` with subject line prefixed `[radar-lite security]`.
   Please describe: (a) what you found, (b) reproduction steps, (c) potential
   impact, and (d) any suggested mitigation.

## Response Commitment

`@essentianlabs/radar-lite` is maintained by a single operator (unfunded BETA).
No formal SLA. Realistic response profile:

- **Acknowledgement:** within 72 hours
- **Triage + severity assessment:** within 7 days
- **Fix + patch release:** timeline scales with severity. Critical issues
  (remote code execution, credential leakage, agent-safety bypass) are
  prioritised over cosmetic issues.

## In Scope

- The `radar-lite` npm package itself (all `src/*` code)
- The bundled dashboard (`src/dashboard/*.html`)
- The local SQLite audit trail (`~/.radar/register.db`) — write integrity, injection
- The `/dashboard/*` and `/assess` / `/strategy` HTTP endpoints served locally
- Prompt-injection resistance in the T3/T4 dual-LLM review path
- M7 principle: raw LLM errors must never surface to callers (see `README.md`)

## Out of Scope

- Vulnerabilities in upstream LLM providers (Anthropic, OpenAI, Google, xAI)
- User-controlled activity-type strings sent to a locally-running dashboard
  from a trusted operator context (localhost-only surface)
- Configuration mistakes exposing the dashboard to the internet (dashboard
  binds to `127.0.0.1` by default; binding to `0.0.0.0` is user responsibility)
- Bugs in downstream wrappers (`@essentianlabs/radar-mcp`,
  `@essentianlabs/openclaw-radar`) — please report those in their respective repos

## Disclosure Practices

Coordinated disclosure preferred:

1. Report privately (via one of the channels above)
2. Maintainer confirms + provides ETA for fix
3. Fix published as a patch release + `npm audit` advisory registered
4. Reporter credited in the CHANGELOG unless they request anonymity
5. Public disclosure after users have had a reasonable window to upgrade

## Known Non-Issues (Documented)

- **radar-lite does NOT send data to EssentianLabs.** All assessment happens
  locally, using operator-provided LLM keys. See `README.md` "Privacy and data flow".
- **BETA classification.** Not recommended for enterprise or production use
  without independent security review, per package description.
- **Dashboard XSS surface** was audited pre-v0.4.0 publish
  (`AUDIT-v0.4.0.md` in the parent RADAR repo). Findings F1 (activity name
  validation) and F2 (`</operator_policy>` tag rejection) shipped in v0.4.0.
