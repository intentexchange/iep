# Intent Exchange Protocol v0.2

Domain-agnostic protocol. A schema pack is a plugin. Discovery is a role. Sessions are peer-to-peer.

## Artifacts

1. **Schema pack** — complementary roles (`alpha` / `beta`), public fields, sealed fields, `term_keys` / `terms`, complement predicates (`eq`, `intersects`, `contains`, `range_overlap`).
2. **Intent document** (public) — signed want against one role. Public body is indexable. Sealed body is committed (`commit_sealed`) and never uploaded. `mandate_cid` is the sha256 of the signed mandate.
3. **Mandate** — signed by the principal. Binds an agent DID, grants, ping cap, `reveal` bands, `limits`, optional `max_rounds` (default 8) and `tolerance` (default 1). The agent must not sign a reveal outside `reveal` or a propose/ratify outside `limits`.
4. **Verb envelope** — `ping` / `accept` / `reject` / `reveal` / `propose` / `ratify` carried as an A2A data Part with media type `application/intent+json`.
5. **Term sheet** — `{ session_id, schema, round, alpha_intent, beta_intent, terms }`. Hash is sha256 of the JCS form.
6. **Deal record** — `{ deal_id, session_id, term_sheet, ratifications[2] }` after both principals sign the term-sheet hash.

Canonical JSON is RFC 8785 JCS. Signatures are Ed25519 over the canonical form with the `signature` field stripped. Agent and principal identity is `did:key` (Ed25519). `IEP_VERSION` is `0.2`.

## Channels

| Verb | Channel |
| --- | --- |
| `publish` / `withdraw` / `query` | Discovery HTTP (`/v0`) |
| `ping` / `accept` / `reject` / `reveal` / `propose` / `ratify` | A2A JSON-RPC, data Part |
| `settle` | Reserved |

Follow-up session verbs use A2A `contextId = session_id`. The initiator drives; the responder replies in the task status message.

## Sealed-field rule

Sealed fields MUST NOT appear in `public_body`. Discovery MUST reject any document whose public body contains a pack-declared sealed key (`IEP_SEALED_LEAK`). Agents MUST keep sealed memory local.

Discovery returns a feasible set: `{ intents: [{ id, public_body, agent_card }], cursor }`. It MUST NOT attach a ranking or score field. Each agent re-ranks with private memory.

## Complementarity, not similarity

A query is "here is my published intent; return documents of the complementary role whose public fields jointly satisfy the pack predicates." Same-role documents never match. Fail closed on missing fields.

## Session

After `ping` / `accept`, `session_id = sha256(utf8(ping.nonce || accept.signature))` as lowercase hex. Stored on both agents. Not stored on Discovery.

State machine: `handshook -> revealed -> bargaining -> ratifying -> ratified | rejected`.

1. **reveal** (stage `ranges` only in v0.2; `context` / `exacts` reserved) — each side discloses a price band from its mandate. Zone = intersection. Empty zone → `reject` reason `no_zone`.
2. **propose** — term sheet. `start_at` is `max(window.start)` of the two intents (not bargained). Price opens at `zone.min` (want) / `zone.max` (offer). Each later turn: `next = round2(mine + 0.5 * (theirs - mine))`. Accept the peer's price when `|theirs - next| <= tolerance`. Round cap → `reject` reason `no_agreement`.
3. **ratify** — principal signs `{ iep, session_id, term_sheet_hash, principal_did, ts }`. Peers verify against `principal_did` on the Discovery record. `deal_id = sha256(utf8(session_id || term_sheet_hash))`.
4. **reject** — `{ session_id, reason }`.

Nonces are unique per session after handshake (`IEP_REPLAY`). Envelope `ts` must be within 5 minutes of the receiver (`IEP_INVALID_DOCUMENT`).

## Error codes

| Code | HTTP | Meaning |
| --- | --- | --- |
| `IEP_INVALID_DOCUMENT` | 400 | Schema, structure, or timestamp skew |
| `IEP_INVALID_SIGNATURE` | 401 | Signature does not match the expected DID |
| `IEP_SEALED_LEAK` | 400 | Sealed field present on the public document |
| `IEP_EXPIRED` | 400 | `expires_at` is in the past |
| `IEP_NOT_FOUND` | 404 | Intent, pack, or session missing |
| `IEP_UNAUTHORIZED` | 401 | Signer is not the publishing agent |
| `IEP_RATE_LIMITED` | 429 | Per-agent stand-in for ping bonds |
| `IEP_MANDATE_DENIED` | 403 | Agent local: verb not granted or mandate expired |
| `IEP_COMMIT_MISMATCH` | 400 | `commit_public` or `term_sheet_hash` does not match |
| `IEP_SESSION_STATE` | 409 | Verb is illegal in the current session state |
| `IEP_REPLAY` | 409 | Nonce already used in this session |
| `IEP_TERM_OUT_OF_BOUNDS` | 400 | Reveal, zone, or limits violated |
| `IEP_INVALID_MANDATE` | 401 | Mandate signature or agent binding failed |

## v0 Discovery API

- `GET /v0/health`
- `PUT /v0/intents` — signed `IntentDocument`
- `DELETE /v0/intents/:id` — body `{ ts, signature }` over `{ method: "DELETE", id, ts }`
- `GET /v0/intents/:id` — public record including `principal_did` (no signature)
- `POST /v0/query` — `{ schema, seeking_role, my_intent_id | public_body, cursor?, limit? }`
- `GET /v0/schemas/:id` — bundled pack JSON

## A2A

Each reference agent serves `/.well-known/agent-card.json` and JSON-RPC on `/`. The card advertises skill `intent-exchange` and extension `https://intentexchange.dev/ext/v0`. Clients send header `A2A-Extensions: https://intentexchange.dev/ext/v0`.
