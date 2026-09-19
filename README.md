# Intent Exchange Protocol (IEP)

Open protocol for two fiduciary agents to publish complementary intents, discover each other without leaking sealed fields, handshake, bargain a term sheet, and ratify a deal.

Canonical site: [intentexchange.dev](https://intentexchange.dev). Source: [github.com/intentexchange/iep](https://github.com/intentexchange/iep). Reference Discovery: [discovery.intentexchange.dev](https://discovery.intentexchange.dev). Spec package: [`@intentexchange/spec`](https://www.npmjs.com/package/@intentexchange/spec).

This repository is the v0.2 reference implementation:

| Package | Role |
| --- | --- |
| `@intentexchange/spec` | JSON Schemas, Ed25519, JCS, complement predicates, session machine |
| `@iep/pack-zero` | Toy schema pack `iep:exchange.v0` (`want` / `offer`) |
| `@iep/discovery` | Reference Discovery Provider (Cloudflare Workers + D1) |
| `@iep/agent` | Reference A2A agent (publish, query, ping, reveal, propose, ratify) |
| `@iep/handshake` | Local end-to-end demo: session id + deal id |
| `@iep/public-index` | Publish + query against the hosted Discovery (HTTP only) |
| `@iep/public-handshake` | Full ping→ratify against the hosted Discovery |

Apache-2.0. Discovery is a role anyone can host. Sealed memory never leaves the agent process. Ranking is not Discovery's job.

## Requirements

Node 22+ and Yarn 1.

## Quick start

Implementers:

```bash
yarn add @intentexchange/spec
```

This repository:

```bash
yarn install
yarn test
yarn demo
```

Three rungs:

| Command | What it proves |
| --- | --- |
| `yarn demo` | Local loop: Discovery Worker on `:8787` plus two agents through ratify |
| `yarn public-index` | Hosted Discovery HTTP only (`PUT` / `POST /v0/query`). `agent_card` is a placeholder, not an A2A endpoint |
| `yarn public-handshake` | Hosted Discovery plus A2A ping→ratify. Needs `cloudflared` or `IEP_WANT_PUBLIC_URL` / `IEP_OFFER_PUBLIC_URL` |

`yarn demo` starts a local Discovery Worker and two agents (want / offer). They publish, query, ping, accept, reveal ranges, bargain price, and ratify. Both sides print the same session id and deal id. A second pair with non-overlapping bands exits `REJECTED no_zone`. The process exits 0.

The hosted reference index is [discovery.intentexchange.dev](https://discovery.intentexchange.dev) (`GET /v0/health`).

## Public Discovery

```bash
yarn install
yarn public-index
yarn workspace @iep/public-index start --role offer
```

Publishes a pack-zero `want` (or `offer`) to the hosted index, then queries for the complementary role. Intents expire in 7 days. This command only exercises Discovery HTTP. Optional `--withdraw` deletes the intent after the query.

## Public handshake

```bash
yarn install
yarn public-handshake
```

Two local agents publish to the hosted index with reachable HTTPS `agent_card` URLs (Cloudflare quick tunnels, or origins you pass in `IEP_WANT_PUBLIC_URL` and `IEP_OFFER_PUBLIC_URL`). They hunt, bargain, print the same session id and deal id, then withdraw. Intents expire in 1 hour. Without tunnels or those env vars the process exits 2 and prints the bind URLs.

## Public site (Cloudflare Pages)

The site lives in `apps/www`. It publishes the spec HTML plus the live `$id` URLs (`/ext/v0`, `/schemas/*.json`).

Do **not** use Workers → Create application (the form with **Deploy command** `npx wrangler deploy`). That path would try to ship Discovery.

Create a **Pages** project instead:

1. [Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages) → **Create** → **Pages** tab → **Connect to Git**
2. Repository: `intentexchange/iep`
3. Use these build settings:

| Field | Value |
| --- | --- |
| Project name | `intentexchange` |
| Production branch | `main` |
| Framework preset | None |
| Root directory | `/` (repo root) |
| Build command | `yarn workspace @iep/www build` |
| Build output directory | `apps/www/dist` |
| Environment variable | `NODE_VERSION=22` |

4. After the first deploy: **Custom domains** → `intentexchange.dev` (proxied). Leave `ieprotocol.dev` as the redirect-only zone.

## Architecture

Discovery is HTTP. Handshake and bargaining are A2A. The index never sees sealed fields.

```
Agent A  --PUT /v0/intents-->  Discovery
Agent B  --PUT /v0/intents-->  Discovery
Agent A  --POST /v0/query -->  Discovery  (feasible set only)
Agent A  --A2A ping------->  Agent B
Agent B  --A2A accept----->  Agent A
session id = sha256(ping.nonce || accept.signature)
Agent A  --A2A reveal----->  Agent B
Agent B  --A2A reveal----->  Agent A
Agent A  --A2A propose---->  Agent B   (repeat until accept)
principals sign term_sheet_hash
deal id = sha256(session_id || term_sheet_hash)
```

See [PROTOCOL.md](PROTOCOL.md) for artifacts, verbs, the sealed-field rule, and error codes.

## Scripts

| Command | What it does |
| --- | --- |
| `yarn build` | Compile spec, pack, agent, handshake, public-handshake |
| `yarn test` | Unit + Worker tests |
| `yarn demo` | Local handshake + deal acceptance test |
| `yarn types` | `wrangler types` for Discovery |
| `yarn workspace @iep/discovery dev` | Local Discovery on `:8787` |
| `yarn workspace @iep/discovery deploy` | Deploy the reference index to Cloudflare |
| `yarn workspace @iep/www dev` | Local site on `:5173` |
| `yarn www` | Build the public site (`apps/www/dist`) |
| `yarn public-index` | Publish + query against the hosted Discovery |
| `yarn public-handshake` | Ping through ratify against the hosted Discovery |

## What v0.2 does not include

Ping bonds / chain settlement, ZK range proofs, `exacts` reveal stage, solvers, federated discovery, UI.
