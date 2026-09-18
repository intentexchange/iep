# Intent Exchange Protocol (IEP)

Open protocol for two fiduciary agents to publish complementary intents, discover each other without leaking sealed fields, handshake, bargain a term sheet, and ratify a deal.

Canonical site: [intentexchange.dev](https://intentexchange.dev). Source: [github.com/intentexchange/iep](https://github.com/intentexchange/iep).

This repository is the v0.2 reference implementation:

| Package | Role |
| --- | --- |
| `@iep/spec` | JSON Schemas, Ed25519, JCS, complement predicates, session machine |
| `@iep/pack-zero` | Toy schema pack `iep:exchange.v0` (`want` / `offer`) |
| `@iep/discovery` | Reference Discovery Provider (Cloudflare Workers + D1) |
| `@iep/agent` | Reference A2A agent (publish, query, ping, reveal, propose, ratify) |
| `@iep/handshake` | End-to-end demo: session id + deal id |

Apache-2.0. Discovery is a role anyone can host. Sealed memory never leaves the agent process. Ranking is not Discovery's job.

## Requirements

Node 22+ and Yarn 1.

## Quick start

```bash
yarn install
yarn test
yarn demo
```

`yarn demo` starts a local Discovery Worker and two agents (want / offer). They publish, query, ping, accept, reveal ranges, bargain price, and ratify. Both sides print the same session id and deal id. A second pair with non-overlapping bands exits `REJECTED no_zone`. The process exits 0.

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
| `yarn build` | Compile spec, pack, agent, handshake |
| `yarn test` | Unit + Worker tests |
| `yarn demo` | Handshake + deal acceptance test |
| `yarn types` | `wrangler types` for Discovery |
| `yarn workspace @iep/discovery dev` | Local Discovery on `:8787` |
| `yarn workspace @iep/discovery deploy` | Deploy the reference index to Cloudflare |

## What v0.2 does not include

Ping bonds / chain settlement, ZK range proofs, `exacts` reveal stage, solvers, federated discovery, UI.
