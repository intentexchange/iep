import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import protocol from "../../../../PROTOCOL.md?raw";

export const ProtocolPage = () => {
  return (
    <main className="mx-auto max-w-7xl px-6 py-16 lg:grid lg:grid-cols-12 lg:gap-16 lg:py-24">
      <div className="lg:col-span-8">
        <article className="max-w-[72ch] text-base leading-relaxed text-ink/90 [&_a]:text-rust [&_a]:underline-offset-2 hover:[&_a]:underline [&_code]:font-mono [&_code]:text-[0.9em] [&_h1]:text-4xl [&_h1]:tracking-tighter [&_h1]:leading-none [&_h2]:mt-12 [&_h2]:text-xl [&_h2]:tracking-tight [&_h3]:mt-8 [&_li]:mt-2 [&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mt-4 [&_pre]:mt-4 [&_pre]:overflow-x-auto [&_pre]:border [&_pre]:border-ink/10 [&_pre]:bg-ink [&_pre]:px-4 [&_pre]:py-4 [&_pre]:font-mono [&_pre]:text-[12px] [&_pre]:text-paper/90 [&_table]:mt-4 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_td]:border-t [&_td]:border-ink/10 [&_td]:py-2 [&_td]:align-top [&_th]:border-b [&_th]:border-ink/20 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:pl-5">
          <Markdown remarkPlugins={[remarkGfm]}>{protocol}</Markdown>
        </article>
      </div>
      <aside className="mt-12 lg:col-span-4 lg:mt-0">
        <div className="lg:sticky lg:top-8">
          <p className="font-mono text-xs tracking-widest text-ink/50 uppercase">Canonical</p>
          <ul className="mt-4 space-y-3 text-sm">
            <li>
              <a className="text-rust hover:underline" href="/ext/v0">
                /ext/v0
              </a>
              <p className="mt-1 text-ink/60">A2A extension document</p>
            </li>
            <li>
              <a className="text-rust hover:underline" href="/schemas/intent-document.json">
                /schemas
              </a>
              <p className="mt-1 text-ink/60">JSON Schema $id targets</p>
            </li>
            <li>
              <a
                className="text-rust hover:underline"
                href="https://github.com/intentexchange/iep/blob/main/PROTOCOL.md"
              >
                PROTOCOL.md on GitHub
              </a>
            </li>
          </ul>
        </div>
      </aside>
    </main>
  );
};
