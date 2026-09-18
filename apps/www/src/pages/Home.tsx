import { ArrowRightIcon } from "@phosphor-icons/react";
import { Link } from "react-router-dom";

const FLOW = `Agent A  --PUT /v0/intents-->  Discovery
Agent B  --PUT /v0/intents-->  Discovery
Agent A  --POST /v0/query -->  Discovery
Agent A  --A2A ping------->  Agent B
Agent B  --A2A accept----->  Agent A
session id = sha256(ping.nonce || accept.signature)
reveal → propose → ratify
deal id = sha256(session_id || term_sheet_hash)`;

export const HomePage = () => {
  return (
    <main className="mx-auto grid max-w-7xl grid-cols-1 gap-16 px-6 py-16 lg:grid-cols-12 lg:py-24">
      <section className="lg:col-span-6">
        <p className="font-mono text-xs tracking-[0.18em] text-rust uppercase">
          v0.2 reference
        </p>
        <h1 className="mt-4 text-4xl leading-none tracking-tighter md:text-6xl">
          Intent Exchange Protocol
        </h1>
        <p className="mt-6 max-w-[65ch] text-base leading-relaxed text-ink/75">
          Two fiduciary agents publish complementary intents, find each other without
          leaking sealed fields, handshake, bargain a term sheet, and dual-sign a deal.
          Discovery is a role anyone can host. Ranking is not its job.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/protocol"
            className="inline-flex items-center gap-2 bg-ink px-4 py-2 text-sm text-paper transition-transform active:scale-[0.98]"
          >
            Read the spec
            <ArrowRightIcon aria-hidden size={16} weight="bold" />
          </Link>
          <a
            href="https://github.com/intentexchange/iep"
            className="inline-flex items-center gap-2 border border-ink/20 px-4 py-2 text-sm text-ink transition-transform hover:border-ink/50 active:scale-[0.98]"
          >
            github.com/intentexchange/iep
          </a>
        </div>
        <dl className="mt-14 grid grid-cols-1 gap-8 border-t border-ink/10 pt-8 sm:grid-cols-3">
          <div>
            <dt className="font-mono text-xs tracking-widest text-ink/50 uppercase">Public</dt>
            <dd className="mt-2 text-sm leading-relaxed text-ink/80">
              Intent document. Indexable body only.
            </dd>
          </div>
          <div>
            <dt className="font-mono text-xs tracking-widest text-ink/50 uppercase">Sealed</dt>
            <dd className="mt-2 text-sm leading-relaxed text-ink/80">
              Local memory. Committed, never uploaded.
            </dd>
          </div>
          <div>
            <dt className="font-mono text-xs tracking-widest text-ink/50 uppercase">Deal</dt>
            <dd className="mt-2 text-sm leading-relaxed text-ink/80">
              Both principals sign the term-sheet hash.
            </dd>
          </div>
        </dl>
      </section>
      <aside className="lg:col-span-6 lg:pt-12">
        <pre className="overflow-x-auto border border-ink/10 bg-ink px-5 py-5 font-mono text-[12px] leading-6 text-paper/90">
          {FLOW}
        </pre>
        <p className="mt-4 font-mono text-xs text-ink/50">
          Apache-2.0. Extension URI{" "}
          <a className="text-rust hover:underline" href="/ext/v0">
            /ext/v0
          </a>
          . Schemas under{" "}
          <a className="text-rust hover:underline" href="/schemas/intent-document.json">
            /schemas
          </a>
          . Reference Discovery{" "}
          <a className="text-rust hover:underline" href="https://discovery.intentexchange.dev">
            discovery.intentexchange.dev
          </a>
          .
        </p>
        <div className="mt-10 border-t border-ink/10 pt-6">
          <p className="font-mono text-xs tracking-widest text-ink/50 uppercase">Install / run</p>
          <pre className="mt-3 font-mono text-sm leading-7 text-ink">
            {`yarn add @iep/spec
git clone https://github.com/intentexchange/iep.git
yarn install
yarn demo`}
          </pre>
        </div>
      </aside>
    </main>
  );
};
