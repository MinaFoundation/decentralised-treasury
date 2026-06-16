import Link from "@docusaurus/Link";
import Layout from "@theme/Layout";

const cards = [
  {
    eyebrow: "Start Here",
    title: "User Guide",
    description:
      "Understand proposals, voting power, results, payouts, pause controls, and day-to-day treasury operation.",
    href: "/docs/user",
  },
  {
    eyebrow: "Build And Operate",
    title: "Developer Guide",
    description:
      "Run the stack, operate the CLI, inspect the API pipeline, produce proofs, test, debug, and maintain the system.",
    href: "/docs/developer",
  },
  {
    eyebrow: "Source Contracts",
    title: "Specifications",
    description:
      "Read the normative contracts for treasury zkApps, off-chain circuits, proofs, state, and invariants.",
    href: "/docs/specs",
  },
  {
    eyebrow: "Participate",
    title: "Using The Treasury",
    description:
      "Learn who participates, when actions are allowed, how voting is weighted, and what users can verify.",
    href: "/docs/user/roles-and-permissions",
  },
];

const layers = [
  "User concepts",
  "Developer operations",
  "Source specifications",
];

export default function Home() {
  return (
    <Layout
      title="Mina Treasury Docs"
      description="Documentation and specifications for the Mina decentralized treasury."
    >
      <main className="docs-home">
        <section className="docs-hero">
          <div className="docs-hero__content">
            <p className="docs-kicker">Mina Decentralized Treasury</p>
            <h1>Understand the treasury as a living system.</h1>
            <p className="docs-hero__body">
              Start with the user guide, move into developer operations when you need to run or
              maintain the system, and use specifications as the source contracts behind both
              layers.
            </p>
            <div className="docs-hero__actions">
              <Link className="docs-button docs-button--primary" to="/docs/user">
                Start With User Guide
              </Link>
              <Link
                className="docs-button docs-button--secondary"
                to="/docs/developer"
              >
                Developer Guide
              </Link>
            </div>
          </div>

          <aside className="docs-hero-panel" aria-label="Treasury lifecycle summary">
            <div className="docs-hero-panel__header">
              <span className="docs-status-dot" />
              <span>Documentation Layers</span>
            </div>
            <div className="docs-layer-list">
              {layers.map((layer, index) => (
                <div className="docs-layer" key={layer}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{layer}</strong>
                </div>
              ))}
            </div>
            <div className="docs-hero-panel__footer">
              <span>Audience-first routes</span>
              <span>Specs as source</span>
            </div>
          </aside>
        </section>

        <section className="docs-proof-strip" aria-label="Documentation qualities">
          <div>
            <span>User</span>
            <p>tech-savvy participant docs</p>
          </div>
          <div>
            <span>Dev</span>
            <p>operators and maintainers</p>
          </div>
          <div>
            <span>Light</span>
            <p>single focused reading mode</p>
          </div>
          <div>
            <span>Specs</span>
            <p>source concepts and contracts</p>
          </div>
        </section>

        <section className="docs-card-grid" aria-label="Documentation entry points">
          {cards.map((card) => (
            <Link className="docs-card" to={card.href} key={card.title}>
              <span>{card.eyebrow}</span>
              <h2>{card.title}</h2>
              <p>{card.description}</p>
            </Link>
          ))}
        </section>
      </main>
    </Layout>
  );
}
