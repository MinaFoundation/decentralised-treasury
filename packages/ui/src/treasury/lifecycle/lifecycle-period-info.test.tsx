import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type JSX, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TreasuryIntlProvider } from "../../i18n";
import { TreasuryLifecyclePeriodInfo } from "./lifecycle-period-info";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("TreasuryLifecyclePeriodInfo", () => {
  it("renders all four lifecycle periods and highlights the active period", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-06T08:59:58.000Z"));

    render(
      <TreasuryIntlProvider locale="en">
        <TreasuryLifecyclePeriodInfo
          lifecycleId={12}
          currentPeriod="voting"
          currentPeriodProgress={68}
          currentSlot={18460115}
          periodEndsIn="1 day 4 hours"
          periodMetadata={[
            {
              period: "voting",
              slotRange: "18459072 - 18460607",
              estimatedStart: "2026-04-05T09:00:00.000Z",
              estimatedEnd: "2026-04-07T13:00:00.000Z",
            },
          ]}
        />
      </TreasuryIntlProvider>,
    );

    expect(screen.queryByText(/Step\s+\d/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /^About / })).toBeNull();
    expect(document.body.textContent).toContain("#18459072 - #18460607 slots");
    expect(screen.getAllByText("Proposal").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Exploration").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Voting").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Cooldown").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Lifecycle 12").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Voting period" })).toBeTruthy();
    expect(screen.queryByText("Current period")).toBeNull();
    expect(screen.getByText("In progress")).toBeTruthy();
    expect(
      screen.getAllByText(
        "Token holders evaluate each proposal, compare tradeoffs, and cast the votes that determine which ideas advance to the next stage.",
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Ending in")).toBeTruthy();
    expect(screen.getByText("1 day 4 hours 0 minutes")).toBeTruthy();
    expect(screen.getByText("#492 slots")).toBeTruthy();
  });

  it("renders a static countdown for the proposal period", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-10T12:58:00.000Z"));

    render(
      <TreasuryIntlProvider locale="en">
        <TreasuryLifecyclePeriodInfo
          lifecycleId={13}
          currentPeriod="proposal"
          currentPeriodProgress={99}
          currentSlot={18463676}
          periodMetadata={[
            {
              period: "proposal",
              slotRange: "18462144 - 18463679",
              estimatedStart: "2026-04-09T13:00:00.000Z",
              estimatedEnd: "2026-04-10T13:01:00.000Z",
            },
          ]}
        />
      </TreasuryIntlProvider>,
    );

    expect(screen.getByText("0 days 0 hours 3 minutes")).toBeTruthy();
    expect(screen.getByText("#3 slots")).toBeTruthy();

    vi.advanceTimersByTime(150000);

    expect(screen.getByText("0 days 0 hours 3 minutes")).toBeTruthy();
    expect(screen.getByText("#3 slots")).toBeTruthy();
  });

  it("keeps the progress bar and countdown fixed over time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-06T12:58:00.000Z"));

    render(
      <TreasuryIntlProvider locale="en">
        <TreasuryLifecyclePeriodInfo
          lifecycleId={12}
          currentPeriod="voting"
          currentPeriodProgress={68}
          currentSlot={18460604}
          periodMetadata={[
            {
              period: "voting",
              slotRange: "18459072 - 18460607",
              estimatedStart: "2026-04-05T09:00:00.000Z",
              estimatedEnd: "2026-04-06T13:01:00.000Z",
            },
          ]}
        />
      </TreasuryIntlProvider>,
    );

    const progressbar = screen.getByRole("progressbar", { name: "Voting progress" });
    expect(progressbar.getAttribute("aria-valuenow")).toBe("68");
    expect(screen.getByText("0 days 0 hours 3 minutes")).toBeTruthy();
    expect(screen.getByText("#3 slots")).toBeTruthy();

    vi.advanceTimersByTime(60000);

    expect(screen.getByText("0 days 0 hours 3 minutes")).toBeTruthy();
    expect(screen.getByText("#3 slots")).toBeTruthy();
    expect(progressbar.getAttribute("aria-valuenow")).toBe("68");
  });

  it("renders historical lifecycles as completed and ended", () => {
    render(
      <TreasuryIntlProvider locale="en">
        <TreasuryLifecyclePeriodInfo
          lifecycleId={11}
          currentPeriod="cooldown"
          currentPeriodProgress={100}
          currentSlot={18454463}
          isHistoricalLifecycle
          periodMetadata={[
            {
              period: "proposal",
              slotRange: "18448320 - 18449855",
              estimatedStart: "2026-03-22T09:00:00.000Z",
              estimatedEnd: "2026-03-24T09:00:00.000Z",
            },
            {
              period: "exploration",
              slotRange: "18449856 - 18451391",
              estimatedStart: "2026-03-24T09:00:00.000Z",
              estimatedEnd: "2026-03-26T09:00:00.000Z",
            },
            {
              period: "voting",
              slotRange: "18451392 - 18452927",
              estimatedStart: "2026-03-26T09:00:00.000Z",
              estimatedEnd: "2026-03-28T09:00:00.000Z",
            },
            {
              period: "cooldown",
              slotRange: "18452928 - 18454463",
              estimatedStart: "2026-03-28T09:00:00.000Z",
              estimatedEnd: "2026-03-30T09:00:00.000Z",
            },
          ]}
        />
      </TreasuryIntlProvider>,
    );

    expect(screen.getAllByText("Completed")).toHaveLength(4);
    expect(screen.getByText("Ended")).toBeTruthy();
    expect(screen.getAllByText(/Mar 30/).length).toBeGreaterThan(0);
    expect(screen.queryByText("Current")).toBeNull();
  });

  it("renders lifecycle progress as four period progress bars", () => {
    render(
      <TreasuryIntlProvider locale="en">
        <TreasuryLifecyclePeriodInfo currentPeriod="proposal" currentPeriodProgress={50} />
      </TreasuryIntlProvider>,
    );

    expect(screen.getByRole("progressbar", { name: "Proposal progress" })).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Exploration progress" })).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Voting progress" })).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Cooldown progress" })).toBeTruthy();
    expect(
      screen.getByRole("progressbar", { name: "Proposal progress" }).getAttribute("aria-valuenow"),
    ).toBe("50");
  });

  it("renders lifecycle loading skeletons before period data is available", () => {
    const { container } = render(
      <TreasuryIntlProvider locale="en">
        <TreasuryLifecyclePeriodInfo loading />
      </TreasuryIntlProvider>,
    );

    const lifecycleSection = container.querySelector(
      '[data-component="treasury-lifecycle-period-info"]',
    );
    expect(lifecycleSection?.getAttribute("data-loading")).toBe("true");
    expect(screen.queryByRole("heading", { name: /period$/i })).toBeNull();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("renders a lifecycle selector and reports selection changes", () => {
    const onLifecycleChange = vi.fn();

    render(
      <TreasuryIntlProvider locale="en">
        <TreasuryLifecyclePeriodInfo
          lifecycleId={12}
          currentPeriod="voting"
          onLifecycleChange={onLifecycleChange}
        />
      </TreasuryIntlProvider>,
    );

    const selector = screen.getByRole("combobox", { name: "Select lifecycle" });
    expect(selector).toBeTruthy();
    expect(screen.getByRole("option", { name: "Lifecycle 0" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Lifecycle 12" })).toBeTruthy();

    fireEvent.change(selector, { target: { value: "5" } });

    expect(onLifecycleChange).toHaveBeenCalledWith(5);
  });

  it("keeps derived lifecycle options after selecting a lower lifecycle", () => {
    function StatefulLifecycleSelector(): JSX.Element {
      const [lifecycleId, setLifecycleId] = useState(12);

      return (
        <TreasuryLifecyclePeriodInfo
          lifecycleId={lifecycleId}
          currentPeriod="voting"
          onLifecycleChange={setLifecycleId}
        />
      );
    }

    render(
      <TreasuryIntlProvider locale="en">
        <StatefulLifecycleSelector />
      </TreasuryIntlProvider>,
    );

    const selector = screen.getByRole("combobox", { name: "Select lifecycle" });
    fireEvent.change(selector, { target: { value: "5" } });

    expect(screen.getByRole("option", { name: "Lifecycle 12" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Lifecycle 5" })).toBeTruthy();
  });

  it("renders a desktop lifecycle popover selector and reports selection changes", () => {
    const onLifecycleChange = vi.fn();

    render(
      <TreasuryIntlProvider locale="en">
        <TreasuryLifecyclePeriodInfo
          lifecycleId={12}
          currentPeriod="voting"
          onLifecycleChange={onLifecycleChange}
        />
      </TreasuryIntlProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Select lifecycle" }));
    expect(screen.getByText("Current")).toBeTruthy();
    expect(screen.getByText("Historical")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Lifecycle 3" }));

    expect(onLifecycleChange).toHaveBeenCalledWith(3);
  });
});
