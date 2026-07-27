import { type JSX, type ReactNode } from "react";
import {
  IntlProvider,
  createIntl,
  createIntlCache,
  useIntl,
  type IntlShape,
} from "react-intl";
import {
  defaultTreasuryHeaderMessages,
  defaultWalletConnectMessages,
} from "./wallet/wallet-types";

export const defaultTreasuryIntlMessages: Record<string, string> = {
  "ui.treasury.header.title": defaultTreasuryHeaderMessages.title,
  "ui.wallet.loading": defaultWalletConnectMessages.loading,
  "ui.wallet.connect": defaultWalletConnectMessages.connect,
  "ui.wallet.install": defaultWalletConnectMessages.install,
  "ui.wallet.connecting": defaultWalletConnectMessages.connecting,
  "ui.wallet.connected": defaultWalletConnectMessages.connected,
  "ui.wallet.disconnect": defaultWalletConnectMessages.disconnect,
  "ui.wallet.account.toggle": "Open wallet account details",
  "ui.wallet.account.title": "Account details",
  "ui.wallet.account.latestSection": "Wallet",
  "ui.wallet.account.currentLifecycleSection": "Current lifecycle",
  "ui.wallet.account.currentMinaBalance": "Wallet balance",
  "ui.wallet.account.votingWeight": "Voting weight",
  "ui.wallet.account.currentAddress": "Wallet address",
  "ui.wallet.account.historicalDelegation": "Voting delegation",
  "ui.wallet.account.delegatedTo": "Delegated to",
  "ui.header.createProposal": "New proposal",
  "ui.header.navigation.label": "Primary navigation",
  "ui.header.navigation.dashboard": "Dashboard",
  "ui.header.navigation.proposals": "Proposals",
  "ui.header.navigation.myWallet": "My Wallet",
  "ui.header.pausedBanner":
    "Treasury paused. Governance actions are temporarily unavailable.",
  "ui.header.treasuryBalance.loading": "Loading treasury balance",
  "ui.header.treasuryBalance.unavailable": "Treasury balance unavailable",
  "ui.header.proposalSearch.trigger": "Find proposals",
  "ui.header.proposalSearch.triggerAria": "{label} ({shortcut})",
  "ui.header.proposalSearch.title": "Find proposals",
  "ui.header.proposalSearch.description":
    "Search by title, proposal address, proposer, recipient, amount, or contents.",
  "ui.header.proposalSearch.inputLabel": "Search proposals",
  "ui.header.proposalSearch.placeholder": "Search proposals…",
  "ui.header.proposalSearch.loading": "Loading proposals…",
  "ui.header.proposalSearch.empty": "No proposals match your search.",
  "ui.header.proposalSearch.hint": "Start typing to search proposals.",
  "ui.header.proposalSearch.resultsLabel": "Matching proposals",
  "ui.header.settings.trigger": "Settings",
  "ui.header.settings.title": "Dashboard settings",
  "ui.header.settings.description":
    "Configure endpoints used by the dashboard containers in apps/web.",
  "ui.header.settings.apiUrl.label": "API URL",
  "ui.header.settings.apiUrl.placeholder": "https://api.example.com",
  "ui.header.settings.indexerApiUrl.label": "Indexer API URL",
  "ui.header.settings.indexerApiUrl.placeholder":
    "https://treasury.example.com/indexer",
  "ui.header.settings.processorApiUrl.label": "Processor API URL",
  "ui.header.settings.processorApiUrl.placeholder":
    "https://treasury.example.com/processor",
  "ui.header.settings.minaNodeUrl.label": "Mina node URL",
  "ui.header.settings.minaNodeUrl.placeholder":
    "https://berkeley.minascan.io/graphql",
  "ui.header.settings.urlHelp": "Use a full URL including http:// or https://.",
  "ui.header.settings.invalidUrl":
    "Please enter a valid URL with http:// or https://.",
  "ui.header.settings.cancel": "Cancel",
  "ui.header.settings.save": "Save settings",
  "ui.footer.network": "Network",
  "ui.footer.network.unknown": "Unknown",
  "ui.footer.node": "Node",
  "ui.footer.archive": "Archive",
  "ui.footer.indexer": "Indexer",
  "ui.footer.processor": "Processor",
  "ui.footer.build": "Build",
  "ui.footer.updatedAt": "Updated",
  "ui.proposalsTable.title": "Proposals",
  "ui.proposalsTable.description":
    "Browse proposals with sorting, filtering, and pagination controls.",
  "ui.proposalsTable.search.placeholder": "Filter proposals",
  "ui.proposalsTable.search.label": "Filter proposals",
  "ui.proposalsTable.pageSize": "Rows",
  "ui.proposalsTable.pageSize.label": "Entries per page",
  "ui.proposalsTable.totalEntries": "{count} total entries",
  "ui.proposalsTable.showingRange": "Showing {start}-{end} of {count}",
  "ui.proposalsTable.empty": "No proposals match the current filter.",
  "ui.proposalsTable.emptyAction": "Create proposal",
  "ui.proposalsTable.paginationSummary": "Page {page} of {totalPages}",
  "ui.proposalsTable.previous": "Previous",
  "ui.proposalsTable.next": "Next",
  "ui.proposalsTable.column.title": "Title",
  "ui.proposalsTable.column.lifecycleId": "Lifecycle ID",
  "ui.proposalsTable.column.proposer": "Proposer",
  "ui.proposalsTable.column.requestedAmount": "Requested",
  "ui.proposalsTable.column.stage": "Status",
  "ui.proposalsTable.column.period": "Period",
  "ui.proposalsTable.column.voteStatus": "Vote",
  "ui.proposalsTable.column.voteSummary": "Votes",
  "ui.proposalsTable.column.acceptanceCriteria": "Criteria",
  "ui.proposalsTable.column.createdAt": "Created at",
  "ui.proposalsTable.statusDescription.new":
    "This proposal belongs to the current lifecycle and is still in the proposal submission phase.",
  "ui.proposalsTable.statusDescription.exploration":
    "This proposal is in exploration, where delegates and token holders review it before voting opens.",
  "ui.proposalsTable.statusDescription.waitingForVotes":
    "Voting has opened, but there are not enough decisive votes yet to determine whether the proposal is passing or failing.",
  "ui.proposalsTable.statusDescription.passing":
    "The proposal is currently meeting quorum and approval requirements, but voting is still in progress.",
  "ui.proposalsTable.statusDescription.failing":
    "The proposal is currently not meeting quorum or approval requirements, but voting is still in progress.",
  "ui.proposalsTable.statusDescription.passed":
    "Voting has closed and the proposal finished with a passing result.",
  "ui.proposalsTable.statusDescription.failed":
    "Voting has closed and the proposal did not satisfy the acceptance criteria.",
  "ui.proposalsTable.statusDescription.abandoned":
    "Voting closed without any votes being cast for this proposal.",
  "ui.proposalsTable.statusDescription.default":
    "Current proposal status: {status}.",
  "ui.lifecycle.lifecycleId": "Lifecycle {id}",
  "ui.lifecycle.selectorLabel": "Select lifecycle",
  "ui.lifecycle.selectorDescription": "Select a lifecycle to display",
  "ui.lifecycle.selectorSearchLabel": "Search lifecycles",
  "ui.lifecycle.selectorSearchPlaceholder": "Search lifecycles",
  "ui.lifecycle.selectorNoResults": "No lifecycles found",
  "ui.lifecycle.selectorCurrent": "Current",
  "ui.lifecycle.selectorSectionCurrent": "Current",
  "ui.lifecycle.selectorSectionHistorical": "Historical",
  "ui.lifecycle.currentPeriod": "Current period",
  "ui.lifecycle.title": "Lifecycle periods",
  "ui.lifecycle.description":
    "Track the active phase and see exactly where the next period transition happens.",
  "ui.lifecycle.endingIn": "Ending in",
  "ui.lifecycle.endingInFallback": "Not available",
  "ui.lifecycle.imminent": "In a few moments",
  "ui.lifecycle.liveCountdown":
    "{days} {days, plural, one {day} other {days}} {hours} {hours, plural, one {hour} other {hours}} {minutes} {minutes, plural, one {minute} other {minutes}}",
  "ui.lifecycle.staticCountdown":
    "{days} {days, plural, one {day} other {days}} {hours} {hours, plural, one {hour} other {hours}} {minutes} {minutes, plural, one {minute} other {minutes}}",
  "ui.lifecycle.state.current": "In progress",
  "ui.lifecycle.state.completed": "Completed",
  "ui.lifecycle.state.upcoming": "Upcoming",
  "ui.lifecycle.progressLabel": "{progress}% through {period}",
  "ui.lifecycle.progressByPeriod": "By period",
  "ui.lifecycle.transitionMarkers": "Period boundaries",
  "ui.lifecycle.progressAriaLabel": "Lifecycle progress",
  "ui.lifecycle.progressAriaLabelForPeriod": "{period} progress",
  "ui.lifecycle.slotRange": "Slot range",
  "ui.lifecycle.duration": "Duration",
  "ui.lifecycle.remainingSlots":
    "#{count, number} {count, plural, one {slot} other {slots}}",
  "ui.lifecycle.estimatedStart": "Estimated start",
  "ui.lifecycle.estimatedEnd": "Estimated end",
  "ui.lifecycle.period.proposal": "Proposal",
  "ui.lifecycle.period.exploration": "Exploration",
  "ui.lifecycle.period.voting": "Voting",
  "ui.lifecycle.period.cooldown": "Cooldown",
  "ui.lifecycle.periodTitle": "{period} period",
  "ui.lifecycle.purpose.proposal":
    "Teams can submit new treasury proposals, refine their scope, and make sure funding requests are ready for community review.",
  "ui.lifecycle.purpose.exploration":
    "The community pressure-tests proposals, surfaces risks, and builds signal before items move into formal voting.",
  "ui.lifecycle.purpose.voting":
    "Token holders evaluate each proposal, compare tradeoffs, and cast the votes that determine which ideas advance to the next stage.",
  "ui.lifecycle.purpose.cooldown":
    "Approved proposals enter a finalization window so outcomes can settle cleanly before execution and the next lifecycle rotation begins.",
  "ui.lifecycle.periodInfoAria": "About {period}",
};

export interface TreasuryIntlProviderProps {
  children: ReactNode;
  locale?: string;
  messages?: Record<string, string>;
}

export function TreasuryIntlProvider({
  children,
  locale = "en",
  messages,
}: TreasuryIntlProviderProps): JSX.Element {
  return (
    <IntlProvider
      locale={locale}
      defaultLocale="en"
      messages={{
        ...defaultTreasuryIntlMessages,
        ...(messages ?? {}),
      }}
    >
      {children}
    </IntlProvider>
  );
}

const fallbackIntl = createIntl(
  {
    locale: "en",
    defaultLocale: "en",
    messages: defaultTreasuryIntlMessages,
  },
  createIntlCache(),
);

export function useTreasuryIntl(): IntlShape {
  try {
    return useIntl();
  } catch {
    return fallbackIntl;
  }
}
