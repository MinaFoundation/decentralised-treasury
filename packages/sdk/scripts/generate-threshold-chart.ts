/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { UInt128, UInt64 } from "o1js";
import { TreasuryProposalSmartContract } from "../src/provable/contracts/treasury-proposal/treasury-proposal.js";
import { BASIS_POINTS } from "../src/provable/contracts/treasury-constants.js";

type ChartConfig = {
    steps: number;
    outputPath: string;
};

function parseArgs(): ChartConfig {
    const args = new Map<string, string>();
    for (const arg of process.argv.slice(2)) {
        const [key, value] = arg.split("=");
        if (key && value) args.set(key, value);
    }

    const steps = Number(args.get("--steps") ?? "100");
    const outputPath =
        args.get("--output") ??
        path.resolve(process.cwd(), "thresholds-chart.svg");

    if (!Number.isFinite(steps) || steps <= 0) {
        throw new Error("--steps must be a positive integer");
    }

    return { steps, outputPath };
}

function formatSvg(
    dataPoints: Array<{
        ratioBp: number;
        participationBp: number;
        approvalBp: number;
    }>
) {
    const width = 900;
    const height = 500;
    const margin = 60;
    const plotWidth = width - margin * 2;
    const plotHeight = height - margin * 2;

    const scaleX = (bp: number) => margin + (bp / 10_000) * plotWidth;
    const scaleY = (bp: number) =>
        height - margin - (bp / 10_000) * plotHeight;

    const participationPoints = dataPoints
        .map(
            ({ ratioBp, participationBp }) =>
                `${scaleX(ratioBp).toFixed(2)},${scaleY(
                    participationBp
                ).toFixed(2)}`
        )
        .join(" ");

    const approvalPoints = dataPoints
        .map(
            ({ ratioBp, approvalBp }) =>
                `${scaleX(ratioBp).toFixed(2)},${scaleY(approvalBp).toFixed(2)}`
        )
        .join(" ");

  const ticks = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#ffffff" />
  <g stroke="#e5e7eb" stroke-width="1">
    ${ticks
            .map((p) => {
                const y = scaleY(p * 100);
                return `<line x1="${margin}" y1="${y}" x2="${width - margin}" y2="${y}" />`;
            })
            .join("")}
  </g>
  <g stroke="#111827" stroke-width="2">
    <line x1="${margin}" y1="${height - margin}" x2="${width - margin}" y2="${height - margin}" />
    <line x1="${margin}" y1="${height - margin}" x2="${margin}" y2="${margin}" />
  </g>
  <polyline fill="none" stroke="#2563eb" stroke-width="2" points="${participationPoints}" />
  <polyline fill="none" stroke="#16a34a" stroke-width="2" points="${approvalPoints}" />
  <g fill="#111827" font-size="12" font-family="Arial, sans-serif">
    <text x="${width / 2}" y="${height - 15}" text-anchor="middle">Proposal Size (% of Treasury)</text>
    <text x="20" y="${height / 2}" text-anchor="middle" transform="rotate(-90 20 ${height / 2})">Threshold (%)</text>
    <text x="${margin}" y="${margin - 10}" font-weight="bold">Dynamic Thresholds</text>
    <rect x="${width - margin - 160}" y="${margin - 20}" width="12" height="12" fill="#2563eb" />
    <text x="${width - margin - 140}" y="${margin - 10}">Participation</text>
    <rect x="${width - margin - 160}" y="${margin + 4}" width="12" height="12" fill="#16a34a" />
    <text x="${width - margin - 140}" y="${margin + 14}">Approval</text>
  </g>
  <g fill="#6b7280" font-size="11" font-family="Arial, sans-serif">
    ${ticks
            .map((p) => {
                const x = scaleX(p * 100);
                const y = scaleY(p * 100);
                return `
          <text x="${x}" y="${height - margin + 18}" text-anchor="middle">${p}%</text>
          <text x="${margin - 10}" y="${y + 4}" text-anchor="end">${p}%</text>
        `;
            })
            .join("")}
  </g>
</svg>
`.trim();
}

function main() {
    const config = parseArgs();
    const treasuryBalance = UInt128.from(10_000);
    const stakingEpochDataLedgerTotalCurrency = UInt64.from(10_000);

    const dataPoints: Array<{
        ratioBp: number;
        participationBp: number;
        approvalBp: number;
    }> = [];

    for (let i = 0; i <= config.steps; i += 1) {
        const proposalAmount = treasuryBalance
            .mul(UInt128.from(i))
            .div(UInt128.from(config.steps));
        const acceptanceCriteria =
            TreasuryProposalSmartContract.calculateAcceptanceCriteria(
            proposalAmount,
            treasuryBalance,
            stakingEpochDataLedgerTotalCurrency
        );
        const ratioBp = Math.floor((i * 10_000) / config.steps);

        dataPoints.push({
            ratioBp,
            participationBp: Number(
                acceptanceCriteria.requiredParticipationBp.toBigInt()
            ),
            approvalBp: Number(acceptanceCriteria.requiredApprovalBp.toBigInt()),
        });
    }

    const svg = formatSvg(dataPoints);
    fs.mkdirSync(path.dirname(config.outputPath), { recursive: true });
    fs.writeFileSync(config.outputPath, svg, "utf8");

    console.log(`Chart written to ${config.outputPath}`);
    console.log(`Basis points scale: ${BASIS_POINTS.toString()}`);
}

main();
