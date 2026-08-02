# Auth Baseline

> **Pack role:** the application-auth floor for any app with real user accounts. The pack
> already carries auth *pieces* in three places — the JWT + refresh-rotation shape
> ([`script-library.md`](script-library.md) §10), the full account-lifecycle flows
> (invite / email-OTP / reset — [`deploy-to-public.md`](deploy-to-public.md) Part 2B), and
> rate-limit/enumeration rules scattered through both. This doc owns the **standing
> choices** those flows assume, so they're decided once instead of re-derived per project.
> Isolation (who may see whose data) is a separate concern:
> [`multi-tenancy-baseline.md`](multi-tenancy-baseline.md) / the project's own model.
>
> **Last reviewed:** 2026-07-16.

## 1. Passwords at rest

- **argon2id** via a maintained library (or bcrypt with cost ≥ 12 where argon2 isn't
  practical). Never a hand-rolled hash, never a fast hash (SHA-*) even salted.
- Mind bcrypt's **72-byte truncation** if you use it — either enforce a max length below
  it or pre-hash deliberately; silent truncation means two different passwords verify.
- No composition rules ("1 uppercase + 1 symbol") — a **minimum length (≥ 10) + a
  breached-password check where cheap** beats complexity theater. Never a maximum that
  forces truncation.
- Verify with the library's constant-time comparison; never roll your own.

## 2. Sessions & tokens (the shape script-library §10 sketches)

- **Short-lived access token (~30 min) + longer refresh token (~7 d)** in an `httpOnly`,
  `Secure`, `SameSite` cookie. **Rotate the refresh token on every use.**
- **Reuse of an already-rotated refresh token = theft signal** — revoke the whole token
  family, not just the presented token, and force re-login.
- **Password change or reset revokes all sessions** (deploy-to-public Phase 3 builds this
  into the reset flow — it's the rule, not a feature of that flow).
- **Deactivating a user cuts login *and* refresh.** An access-token check alone leaves a
  deactivated user alive for the refresh window — the `security-reviewer` agent checks
  this because it's the common miss.
- Tokens carry the **enforced identity claims** (user id; tenant claim on multi-tenant
  projects — the claim is authority, the subdomain is routing).

## 3. Login-endpoint hygiene

- **Rate-limit on the real client IP** (`CF-Connecting-IP` resolution behind an edge —
  deploy-to-public 1.4) **and per-account**: an attacker with many IPs still hits the
  per-account counter.
- **Prefer escalating delays / temporary throttling over a hard lockout.** A hard
  lockout hands an attacker a denial-of-service button against any user whose email they
  know. Lock hard only after sustained abuse, and alert on it.
- **Uniform errors everywhere an account might or might not exist:** login, registration,
  forgot-password all return the same shape/status regardless ("if an account exists,
  we've emailed it"). The invite gate's uniform 400 (deploy-to-public Phase 1.1) is the
  same rule. Account enumeration is a real finding, not a nicety.
- Log auth failures **structured** (real IP, account id if known, outcome) — the
  observability baseline's tier-0 rules apply; these are the log lines an incident
  actually needs.

## 4. Account-lifecycle flows

The worked implementations live in deploy-to-public Part 2B (built once, reusable); the
invariants they encode:

- **Verification / reset codes:** stored **hashed** (sha256), single-use, short expiry
  (~15 min), attempt-capped, with a resend cooldown.
- **Reset revokes all sessions** (§2) and never confirms account existence (§3).
- **Email delivery is testable dormant:** when the email API key is unset, log the code
  instead of sending — the whole flow works in dev with no email service.
- Admin user management needs **self-lockout and last-admin guards** (you can't demote or
  disable the only admin — deploy-to-public 3.1).

## 5. 2FA posture (proportionate, decided not defaulted)

- **Baseline for this pack's scope:** no mandatory 2FA for ordinary end users in v1 —
  friction the product usually can't spend. Revisit per project when the data warrants.
- **Admin and platform surfaces are different:** anything cross-tenant or destructive
  (the platform-admin surface, a fleet dashboard) gets a second factor as soon as more
  than one person holds an account — TOTP in-app, or push the problem to the edge and put
  the surface behind SSO/Access (Branch A), which is 2FA you don't have to build.
- Email-OTP-at-login is a pragmatic middle step where TOTP is too much — reuse the
  verification-code machinery from §4.

## 6. What lives where

| Concern | Owner |
|---|---|
| Hashing, token shape, lockout, enumeration | this doc |
| Invite / verify / reset flow implementations | [`deploy-to-public.md`](deploy-to-public.md) Part 2B |
| Edge gate (Access), service tokens for machines | deploy-to-public Part 2A + [`public-edge-baseline.md`](public-edge-baseline.md) |
| Who may read whose data (isolation) | the project's model / [`multi-tenancy-baseline.md`](multi-tenancy-baseline.md) |
| Secrets that back all of this (`JWT_SECRET` etc.) | [`security-baseline.md`](security-baseline.md) §1–3 |

## 7. Tests (tier-2 — this is "logic that loses money or data")

Per [`testing-and-ci.md`](testing-and-ci.md), auth changes ship with tests for: uniform
error shapes (no enumeration), refresh rotation + family revocation on reuse, revocation
on password change and on deactivation, and the rate limit actually limiting. The
`security-reviewer` agent audits these paths on any auth-touching diff.
