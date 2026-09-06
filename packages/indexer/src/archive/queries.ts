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
      timestamp
      globalSlotSinceGenesis
      stateHash
      parentHash
      chainStatus
    }
    eventData {
      accountUpdateId
      data
      transactionInfo {
        hash
        sequenceNumber
        zkappAccountUpdateIds
      }
    }
  }
}
`;

export const EVENTS_QUERY_FALLBACK = `
query Events($input: EventFilterOptionsInput!) {
  events(input: $input) {
    blockInfo {
      height
      globalSlotSinceGenesis
      stateHash
      parentHash
      chainStatus
    }
    eventData {
      accountUpdateId
      data
      transactionInfo {
        hash
        sequenceNumber
        zkappAccountUpdateIds
      }
    }
  }
}
`;
