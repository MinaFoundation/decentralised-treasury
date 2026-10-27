export interface ProposalAcknowledgement {
  label: string;
  title: string;
  sections: {
    title?: string;
    text: string;
    links: { label: string; href: string }[];
  }[];
}

export interface ProposalAcknowledgementsConfig {
  title: string;
  description: string;
  readMoreLabel: string;
  closeLabel: string;
  kyc: ProposalAcknowledgement;
  terms: {
    beforeLink: string;
    link: { label: string; href: string };
    afterLink: string;
  };
}

// UI copy and destinations only. Acceptance is never stored with a proposal.
export const defaultProposalAcknowledgements: ProposalAcknowledgementsConfig = {
  title: "Required acknowledgements",
  description: "Accept both acknowledgements before creating this proposal.",
  readMoreLabel: "Read more",
  closeLabel: "Close",
  kyc: {
    label:
      "I have read, understood and acknowledge the KYC requirement and Privacy Notice.",
    title: "KYC Required",
    sections: [
      {
        text: 'Please be reminded that before any funds can be disbursed by the Decentralized Treasury under a passing proposal, you are required to complete identity verification ("KYC"), as set out in Section 6 of the Decentralized Treasury Terms and Conditions. Please follow the link below to submit your details and complete verification via Blockpass, our designated identity verification provider.',
        links: [
          {
            label: "Continue to KYC verification",
            href: "https://verify-with.blockpass.org/?clientId=decentralized_treasury_mina_73e2d",
          },
        ],
      },
      {
        title: "Privacy Notice",
        text: "Mina Foundation (Rue du Commerce 4, 1204 Geneva, Switzerland) is the data controller for the KYC verification carried out via Blockpass UK Limited in connection with your participation in Mina Protocol's Decentralized Treasury. We collect and process your information to verify your eligibility to receive a disbursement and to meet our legal and compliance obligations, as described in the Decentralized Treasury Terms and Conditions and our Privacy Policy. Non-approved or incomplete verification results will be further shared with our service providers for the purposes described above. By submitting your information, you acknowledge and agree to this collection, processing and sharing of your personal data. To learn more please see our Privacy Policy at https://www.minafoundation.com/privacy-policy.",
        links: [
          {
            label: "Privacy Policy",
            href: "https://www.minafoundation.com/privacy-policy",
          },
        ],
      },
    ],
  },
  terms: {
    beforeLink: "I have read and accepted the ",
    link: {
      label: "Terms and Conditions",
      // Temporary destination supplied for the pending terms details.
      href: "https://info.minadt.com/terms",
    },
    afterLink:
      " governing the MINA Decentralized Treasury, and I acknowledge and agree to the privacy terms describing how my personal data will be collected and processed.",
  },
};
