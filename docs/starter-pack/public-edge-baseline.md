# Public Edge Baseline

> Cloudflare Tunnel + Access, written after an audit that found a **live production app nobody was
> watching**, a **dangling ungated route**, two orphan tunnels, and two unadvertised backdoors into
> prod — none of which any dashboard was showing, and none of which would ever have paged.
>
> Companion to [`deploy-to-public.md`](deploy-to-public.md) (how to get an app *onto* the edge) and
> [`observability-baseline.md`](observability-baseline.md) (how to watch it). This doc is about the
> failure modes **specific to the edge** — the ones that produce a green dashboard over a broken or
> wide-open app.

## The principle

**Your public edge is the one layer you cannot audit from your boxes.**

A modern tunnel is *remotely-managed*: the connector runs `cloudflared tunnel run <token>` with **no
local config file**. The map of hostname → origin lives **in the provider's dashboard**. Which means:

- `docker ps`, the Caddyfile, and your compose files tell you what an origin *would* serve — never
  what the edge actually *routes* to it.
- Anyone with dashboard access can publish a new public hostname with **zero commits, zero config
  management, zero notification**. There is no PR to review and no diff to catch.
- Therefore **any hand-maintained list of "our public hostnames" is fiction** the moment someone
  clicks "Add a public hostname."

**Rule: read your public surface from the provider's API, on a schedule, and diff it against what you
believe.** Everything below is a corollary.

---

## 1. ⚠️ An Access-gated app FAKES a green probe

The single highest-value paragraph in this pack. Cloudflare Access `302`s **every** unauthenticated
request — including `/api/health`, including whatever you were going to probe. The standard blackbox
`http_2xx` module has `follow_redirects: true`. So your probe:

1. requests your app →
2. follows the 302 to the **Cloudflare Access login page** →
3. gets a **200** from that login page →
4. reports the service **UP**.

**Cloudflare's login page stays up even if every container you own is dead.** This probe is worse than
no probe: it manufactures confidence. Measured on a real app: `probe_success=1`,
`probe_http_redirects=1`, 35 KB of login HTML — while the probe "passed".

### The fix — probe *through* Access with a service token

1. **Mint a service token** — Zero Trust → Access → **Service Auth**. Prefer **non-expiring**: an
   expiring token becomes a phantom outage months later, at 3am, for no reason. The secret is shown
   **once**. One token is enough for every app.
2. **Allow it on the app** — the token alone does nothing. On the app: Policies → Add →
   **Action = Service Auth**, **Include = Service Token → *your named token***. Not "any valid service
   token". *Creating the token and allowing the token are two separate steps; skipping the second is
   the usual reason the probe stays red.* This does **not** weaken the human gate — Access evaluates
   Service Auth policies separately from your identity allow-list.
3. **Probe with the headers** — `CF-Access-Client-Id` / `CF-Access-Client-Secret`, and critically:
   **`follow_redirects: false`** + accept **2xx only**, so a 302 (token rejected) correctly **fails**.
4. **Verify you are reading the real origin:**

   ```promql
   probe_success{...}          # 1
   probe_http_status_code{...} # 200
   probe_http_redirects{...}   # 0   <-- THE ONE THAT MATTERS
   ```

   **`probe_http_redirects` must be 0.** A 200 reached *via a redirect* is the login page, not your app.

5. **Make sure it can actually page you.** If gated apps live in their own probe job, your alert rule's
   job matcher must include that job. A probe in an unmatched job goes red **silently** — you installed
   a smoke detector and left the battery out. (This happened: the new job was invisible to the alert
   until the rule was widened.)

**The secret cannot live in your committed probe config.** Render it from an untracked env file
(commit a `.tmpl`, gitignore the rendered file) — the same pattern you already use for alertmanager.

**Generalize beyond Cloudflare:** *any* edge auth (an SSO proxy, an OAuth2 gateway, a WAF interstitial)
that answers `200` in front of a dead app will fool a naive probe. Always ask **what exactly returned
that 200.**

---

## 2. Know your public surface — the exposure inventory

Build a view that reads the edge API **live** and shows, per hostname:

| Column | Why |
|---|---|
| **Hostname** | the door |
| **Origin service** | what it actually routes to |
| **Which box** the connector runs on | tunnels are abstract; connectors are ground truth |
| **How access is controlled** | read from the *real* policies — not from memory |
| **Probe status** | is anything watching it at all? |

And make it flag these, loudly:

- 🔓 **No Access app → open to the internet.** Correct for a public product. A **finding** for a demo,
  an admin panel, a staging door, or anything you'd be embarrassed to see indexed.
- 🟠 **An Access app whose policy is `bypass` or includes *everyone*.** The app exists, so the dashboard
  *looks* gated. It is not gating. This is worse than no app, because it reads as protected.
- ⚪ **Unprobed.** A public hostname nobody watches dies silently. This is the difference between "we
  knew" and "the customer told us".
- **Dangling route** — configured, but no DNS resolves to it.
- **Orphan tunnel** — routes configured, but **no live connector**.

A read-only API token is the right credential here: the view only ever *reads*, and a read-only token
forces every deletion to be a deliberate human act — the correct blast radius for "delete a production
tunnel".

---

## 3. Retiring a hostname or tunnel — check DNS *first*

**Before deleting any tunnel, resolve what DNS actually points at.**

A tunnel's route list is **not** evidence that the tunnel serves those hostnames. An orphaned tunnel can
happily list a route for a **live, business-critical** hostname that DNS has long since re-pointed
elsewhere. Deleting on vibes looks terrifying; deleting after checking DNS is a no-op. Do the check,
then delete without drama.

```
for each zone → for each proxied DNS record:
    content == "<tunnel-id>.cfargotunnel.com"  → map that id back to a tunnel name
```

Then **delete the tunnel route first, then the DNS record** — the provider often removes the CNAME with
the route, so re-check before hunting for it.

⚠️ **A DNS record in a non-`active` zone resolves nowhere.** If a zone's status is `moved`/`pending`
(nameservers delegated away), its records are decoration. "Does a record exist?" is the wrong question;
**"does it exist *in an active zone*?"** is the right one. Getting this wrong under-reports dangling
routes — it was a real bug in the first cut of our own exposure view.

---

## 4. Structural facts worth designing around

- **One connector = one shared blast radius.** Every hostname on a tunnel goes dark together when its
  connector drops. Usually an acceptable trade (one thing to run, one thing to watch) — but it should be
  a *decision*, not a discovery during an incident.
- **A "staging" hostname pointed at prod containers IS prod.** A `hz.`/`staging.` hostname wired to the
  *same live containers* as the prod hostname is not a staging environment; it is a **second,
  unadvertised, usually ungated and unprobed door into production**. Give it its own stack, or delete it.
  (We found two, and deleted them.)
- **Names lie; routes don't.** A host called `*-uat` was production. A hostname prefixed `hz.` served
  live prod. Trust the route map, never the naming convention.

---

## 5. The deploy is not done when it's reachable

The failure that started all of this: an app was deployed to a shared edge, worked perfectly, and sat
there **live for hours with no probe and no database backup**. Every step of the deploy runbook passed.
The runbook simply didn't *have* those steps.

**Definition of done for anything on the public edge:**

- [ ] It is **probed** from outside — and if gated, probed **through** the gate (§1).
- [ ] The probe is wired to an alert rule that **actually matches its job**.
- [ ] Its **data is backed up**, and the backup has been **restored at least once**. A backup you have
      never read back is a hypothesis, not a backup.
- [ ] The **backup's absence would be noticed.** ⚠️ A "stale backup" alert fires on a metric that has
      gone old — a backup leg that **never ran has no metric at all**, so it fires **nothing**.
      **Silence is not safety.** Alert on *missing* as well as *stale*.
- [ ] Its gate is **deliberate** — you chose "open" or you chose "gated"; you didn't inherit a default.
- [ ] It appears in the **exposure inventory** (§2).

---

## 6. Changing what an app serves is a monitoring change

When an app drops its SPA, moves its health endpoint, or retires a path, the probe pointing at the old
path starts screaming about a **perfectly healthy** service. That is not a false alarm you tolerate — it
is a false alarm that **teaches you to ignore alerts**, which is how the real one gets missed.

Repoint the probe **in the same change** that moves the endpoint. And prefer an explicit, stable
`/health` (documented as *the* probe target) over probing `/` — `/` is a UI decision and will change out
from under you.
