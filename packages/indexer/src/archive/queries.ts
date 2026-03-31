export const NETWORK_STATE_QUERY = `
query NetworkState {
  networkState {
    maxBlockHeight {
      canonicalMaxBlockHeight
      pendingMaxBlockHeight
    }
  }
}
`;

export const EVENTS_QUERY = `
query Events($input: EventFilterOptionsInput!) {
  events(input: $input) {
    blockInfo {
      height
    }
    eventData {
      accountUpdateId
      data
      transactionInfo {
        hash
        zkappAccountUpdateIds
      }
    }
  }
}
`;
