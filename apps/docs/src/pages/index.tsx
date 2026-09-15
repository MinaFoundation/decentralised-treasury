import type { JSX } from "react";
import Layout from "@theme/Layout";
import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import { TreasuryLogoIcon } from "@repo/ui/treasury-logo-icon";
import styles from "./index.module.css";

const lifecycle = [
  {
    number: "01",
    title: "Proposal",
    text: "Publish a funding request and commit its content to Mina.",
    detail: "Submit a request",
  },
  {
    number: "02",
    title: "Exploration",
    text: "Review the request and verify its content before voting starts.",
    detail: "Review and discuss",
  },
  {
    number: "03",
    title: "Voting",
    text: "Vote yay, nay, or abstain with weight from the lifecycle snapshot.",
    detail: "Submit your vote",
  },
  {
    number: "04",
    title: "Cooldown",
    text: "Prove the vote result. Execute an approved request after cooldown.",
    detail: "Verify the result",
  },
];

const paths = [
  {
    number: "01",
    title: "Learn",
    audience: "Community members",
    text: "Understand the Treasury, create a proposal, and take part in a vote.",
    href: "/learn/",
    quickstart: "/learn/quickstart",
    topics: "Proposals · Voting · Results",
  },
  {
    number: "02",
    title: "Operate",
    audience: "Treasury operators",
    text: "Configure a deployment, prepare lifecycle data, and run the services.",
    href: "/operate/",
    quickstart: "/operate/quickstart",
    topics: "Deployment · Ledgers · Proofs",
  },
  {
    number: "03",
    title: "Develop",
    audience: "Software developers",
    text: "Explore the codebase, run the local demo, and build on the Treasury.",
    href: "/developer/",
    quickstart: "/developer/local-development/quickstart",
    topics: "Architecture · SDK · Local development",
  },
];

export default function Home(): JSX.Element {
  const { siteConfig } = useDocusaurusContext();
  const treasuryAppUrl = String(siteConfig.customFields?.treasuryAppUrl);
  const treasuryAppLabel = String(siteConfig.customFields?.treasuryAppLabel);

  return (
    <Layout
      title="Community funding, verified on Mina"
      description="Learn how the Mina Decentralized Treasury turns public proposals into verifiable funding decisions."
    >
      <main className={styles.page}>
        <section className={styles.hero} aria-labelledby="home-title">
          <div className={styles.heroCopy}>
            <div className={styles.eyebrow}>
              <span className={styles.marker} aria-hidden="true" />
              Treasury documentation
            </div>
            <h1 id="home-title">
              Community funding.
              <br />
              Verified on Mina.
            </h1>
            <p className={styles.heroDescription}>
              A public process for proposals, community votes, and funding.
              Learn how it works, operate a Treasury, or build with the code.
            </p>
            <div className={styles.actions}>
              <Link className={styles.primaryAction} to="/learn/quickstart">
                Get started <span aria-hidden="true">→</span>
              </Link>
              <a className={styles.secondaryAction} href={treasuryAppUrl}>
                {treasuryAppLabel} <span aria-hidden="true">↗</span>
              </a>
            </div>
            <p className={styles.heroNote}>
              On-chain rules. Public proposals. Verifiable results.
            </p>
          </div>

          <aside className={styles.overview} aria-label="Treasury overview">
            <div className={styles.overviewHeader}>
              <TreasuryLogoIcon className={styles.logo} />
              <div>
                <span className={styles.overviewTitle}>
                  The Treasury lifecycle
                </span>
                <span className={styles.overviewSubtitle}>
                  From a funding request to a verified decision
                </span>
              </div>
            </div>
            <ol className={styles.overviewSteps}>
              {lifecycle.map((period) => (
                <li key={period.number}>
                  <span className={styles.overviewNumber}>{period.number}</span>
                  <span className={styles.overviewStepTitle}>
                    {period.title}
                  </span>
                  <span className={styles.overviewStepDetail}>
                    {period.detail}
                  </span>
                </li>
              ))}
            </ol>
            <Link
              className={styles.overviewLink}
              to="/learn/lifecycle-and-snapshots"
            >
              Understand the lifecycle <span aria-hidden="true">→</span>
            </Link>
          </aside>
        </section>

        <section
          className={styles.pathSection}
          aria-labelledby="choose-path-title"
        >
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.kicker}>Choose a guide</p>
              <h2 id="choose-path-title">Learn, operate, or develop.</h2>
            </div>
            <p>Guides for every part of the process.</p>
          </div>
          <div className={styles.pathCards}>
            {paths.map((path) => (
              <article className={styles.pathCard} key={path.title}>
                <div className={styles.pathHeader}>
                  <span className={styles.pathNumber}>{path.number}</span>
                  <span className={styles.pathTag}>{path.audience}</span>
                </div>
                <h3>
                  <Link to={path.href}>
                    {path.title} <span aria-hidden="true">↗</span>
                  </Link>
                </h3>
                <p>{path.text}</p>
                <div className={styles.pathFooter}>
                  <span className={styles.pathTopics}>{path.topics}</span>
                  <Link to={path.quickstart}>
                    {path.title} quickstart <span aria-hidden="true">→</span>
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section
          className={styles.lifecycleSection}
          aria-labelledby="lifecycle-title"
        >
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.kicker}>How it works</p>
              <h2 id="lifecycle-title">
                A clear process, from proposal to payout.
              </h2>
            </div>
            <Link className={styles.textLink} to="/learn/how-it-works">
              Explore the process <span aria-hidden="true">→</span>
            </Link>
          </div>
          <ol className={styles.lifecycleGrid}>
            {lifecycle.map((period) => (
              <li className={styles.lifecycleStep} key={period.number}>
                <span className={styles.stepNumber}>{period.number}</span>
                <h3>{period.title}</h3>
                <p>{period.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.finalCta} aria-labelledby="demo-title">
          <div className={styles.ctaCopy}>
            <span className={styles.ctaIcon} aria-hidden="true">
              ↗
            </span>
            <div>
              <h2 id="demo-title">Explore the Treasury app.</h2>
              <p>Open the app and explore the Treasury.</p>
            </div>
          </div>
          <a className={styles.secondaryAction} href={treasuryAppUrl}>
            {treasuryAppLabel} <span aria-hidden="true">↗</span>
          </a>
        </section>
      </main>
    </Layout>
  );
}
