import type { JSX } from "react";
import Layout from "@theme/Layout";
import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import { buttonVariants } from "@repo/ui/components/ui/button";
import { Card } from "@repo/ui/components/ui/card";
import { TreasuryLogoIcon } from "@repo/ui/treasury-logo-icon";
import styles from "./index.module.css";

const lifecycle = [
  {
    number: "01",
    title: "Propose",
    text: "Publish a funding request and record its content commitment on Mina.",
  },
  {
    number: "02",
    title: "Explore",
    text: "Review the request and verify its exact content before voting starts.",
  },
  {
    number: "03",
    title: "Vote",
    text: "Submit a yay, nay, or abstain vote with snapshot-based voting weight.",
  },
  {
    number: "04",
    title: "Tally",
    text: "Prove the result during cooldown. Execute an approved request later.",
  },
];

export default function Home(): JSX.Element {
  const { siteConfig } = useDocusaurusContext();
  const treasuryAppUrl = String(siteConfig.customFields?.treasuryAppUrl);

  return (
    <Layout
      title="Community funding, verified on Mina"
      description="Learn how the Mina Decentralized Treasury turns public proposals into verifiable funding decisions."
    >
      <main className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.heroGlow} aria-hidden="true" />
          <div className={styles.heroCopy}>
            <div className={styles.eyebrow}>
              <TreasuryLogoIcon className={styles.logo} />
              <span>Mina Decentralized Treasury</span>
            </div>
            <h1>
              Community funding,
              <br />
              verified on Mina.
            </h1>
            <p>
              Propose, review, vote, and fund public work through a transparent
              process. Smart contracts and zero-knowledge proofs apply the
              rules.
            </p>
            <div className={styles.actions}>
              <a
                className={`${buttonVariants({ size: "lg" })} ${styles.primaryAction}`}
                href={treasuryAppUrl}
              >
                Open Treasury <span aria-hidden="true">↗</span>
              </a>
              <Link
                className={`${buttonVariants({ variant: "outline", size: "lg" })} ${styles.secondaryAction}`}
                to="/learn/"
              >
                Read the docs <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>

          <Card className={styles.heroCard}>
            <p className={styles.cardLabel}>One public process</p>
            <div className={styles.heroCardStatement}>
              <span>Ideas</span>
              <span aria-hidden="true">→</span>
              <span>Decisions</span>
              <span aria-hidden="true">→</span>
              <span>Funding</span>
            </div>
            <div className={styles.trustLine}>
              <span className={styles.trustDot} aria-hidden="true" />
              <span>On-chain rules. Verifiable results.</span>
            </div>
          </Card>
        </section>

        <section
          className={styles.lifecycleSection}
          aria-labelledby="lifecycle-title"
        >
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.kicker}>The lifecycle</p>
              <h2 id="lifecycle-title">
                A clear path from proposal to payout.
              </h2>
            </div>
            <Link to="/learn/lifecycle-and-snapshots">
              Explore the full lifecycle <span aria-hidden="true">→</span>
            </Link>
          </div>

          <div className={styles.lifecycleGrid}>
            {lifecycle.map((period) => (
              <article className={styles.lifecycleStep} key={period.number}>
                <span className={styles.stepNumber}>{period.number}</span>
                <h3>{period.title}</h3>
                <p>{period.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section
          className={styles.pathSection}
          aria-labelledby="choose-path-title"
        >
          <div className={styles.pathIntro}>
            <p className={styles.kicker}>Choose your path</p>
            <h2 id="choose-path-title">Take part or run the system.</h2>
            <p>
              Start with the guide that matches your role. Each guide links to
              detailed procedures and technical reference material.
            </p>
          </div>

          <div className={styles.pathCards}>
            <Card className={`${styles.pathCard} ${styles.learnCard}`}>
              <span className={styles.pathTag}>For community members</span>
              <h3>Learn</h3>
              <p>Create proposals, review requests, vote, and check results.</p>
              <Link to="/learn/">
                Start learning <span aria-hidden="true">→</span>
              </Link>
            </Card>
            <Card className={`${styles.pathCard} ${styles.operateCard}`}>
              <span className={styles.pathTag}>For treasury operators</span>
              <h3>Operate</h3>
              <p>Configure lifecycles, deploy services, and prepare proofs.</p>
              <Link to="/operate/">
                Open operator docs <span aria-hidden="true">→</span>
              </Link>
            </Card>
          </div>
        </section>

        <section className={styles.finalCta}>
          <div>
            <p className={styles.kicker}>Ready to participate?</p>
            <h2>See the treasury in action.</h2>
          </div>
          <a
            className={`${buttonVariants({ size: "lg" })} ${styles.darkAction}`}
            href={treasuryAppUrl}
          >
            Open Treasury <span aria-hidden="true">↗</span>
          </a>
        </section>
      </main>
    </Layout>
  );
}
