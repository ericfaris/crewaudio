# Lessons learned

Terse, dated notes on nontrivial decisions/gotchas — not a changelog or a
diff restatement. See `git log` for that.

## 2026-09-13 — repo rename (crewaudio → study)

- A repo rename touches more than the repo: GitHub remote, local folder,
  package.json, docker-compose project/image/container name, the CI deploy
  payload, and any *other* project that references this one by name
  (sentinel's `repo-map.json`, `hostname-map.js`, `exposure.js`, and
  `renovate/config.json` all hardcoded "crewaudio"). Grep the whole lab for
  the old name, not just this repo, before calling a rename done.
- Renaming the docker-compose project name changes the container name
  (`<project>-<service>-<n>`), so the *old* container keeps running under
  its old name and holds the host port — `docker compose up` under the new
  name fails on "port already allocated" until the old container is stopped
  explicitly. Sequence: land all the renamed config, stop the old container,
  *then* push/deploy.
- Renaming localStorage keys an already-deployed app has been writing to
  silently drops every existing user's saved state on next load. If the
  keys need to change, ship a one-time migration (copy old → new, delete
  old) rather than a bare rename — cheap insurance either way.
- A self-hosted GitHub Actions runner survives a GitHub repo rename fine
  (tracked by ID/agentId, not name) — but its systemd unit's
  `WorkingDirectory`/`ExecStart` are absolute paths that don't follow a
  folder rename automatically. Stop the service, move the folder, rewrite
  the unit file, `daemon-reload`, re-enable — `.runner`/`.credentials`
  themselves need no changes.

## 2026-09-13 — audio type hierarchy + music-only shuffle

- CSS bug worth watching for generally: an ID selector setting `display`
  (e.g. `#import-confirm { display: flex; }`) beats the UA's
  `[hidden] { display: none }` on specificity, so toggling the `hidden`
  attribute silently stops working the moment any component CSS sets
  `display` on that same element. Fix/pattern: pair every such rule with an
  explicit `#foo[hidden] { display: none; }`, or default to `[hidden]`
  co-existing safely by never setting `display` directly on an element that
  gets shown/hidden via the attribute.
- Naive "reshuffle on every track change" shuffle implementations can
  immediately replay the track you just left (new shuffle order is random
  each time, including relative to the current position). Simplest fix that
  avoids full state tracking: shuffle once per *playlist entry* (when the
  book/queue identity changes) rather than once per *track change* — keeps
  a stable permutation for the whole listening session instead of a fresh
  one every step.
