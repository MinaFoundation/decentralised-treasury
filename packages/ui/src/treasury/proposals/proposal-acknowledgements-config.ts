export type ProposalAcknowledgementText = (
  | string
  | { label: string; href: string }
)[];

export interface ProposalAcknowledgement {
  label: string;
  title: string;
  sections: {
    title?: string;
    paragraphs: ProposalAcknowledgementText[];
  }[];
}

export interface ProposalAcknowledgementsConfig {
  title: string;
  description: string;
  readMoreLabel: string;
  closeLabel: string;
  kyc: ProposalAcknowledgement;
  terms: { text: ProposalAcknowledgementText };
}

// Temporary destination supplied for the pending terms details.
const termsUrl = "https://info.minadt.com/terms";
const kycUrl =
  "https://verify-with.blockpass.org/?clientId=decentralized_treasury_mina_73e2d";
const privacyUrl = "https://www.minafoundation.com/privacy-policy";

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
        paragraphs: [
          [
            'Please be reminded that before any funds can be disbursed by the Decentralized Treasury under a passing proposal, you are required to complete identity verification ("KYC"), as set out in Section 6 of the ',
            {
              label: "Decentralized Treasury Terms and Conditions",
              href: termsUrl,
            },
            ". Please follow the link below to submit your details and complete verification via ",
            { label: "Blockpass", href: kycUrl },
            ", our designated identity verification provider.",
          ],
          [{ label: "Continue to KYC verification", href: kycUrl }],
        ],
      },
      {
        title: "Privacy Notice",
        paragraphs: [
          [
            "Mina Foundation (Rue du Commerce 4, 1204 Geneva, Switzerland) is the data controller for the KYC verification carried out via ",
            { label: "Blockpass UK Limited", href: kycUrl },
            " in connection with your participation in Mina Protocol's Decentralized Treasury. We collect and process your information to verify your eligibility to receive a disbursement and to meet our legal and compliance obligations, as described in the ",
            {
              label: "Decentralized Treasury Terms and Conditions",
              href: termsUrl,
            },
            " and our ",
            { label: "Privacy Policy", href: privacyUrl },
            ". Non-approved or incomplete verification results will be further shared with our service providers for the purposes described above. By submitting your information, you acknowledge and agree to this collection, processing and sharing of your personal data. To learn more please see our ",
            { label: "Privacy Policy", href: privacyUrl },
            " at ",
            { label: privacyUrl, href: privacyUrl },
            ".",
          ],
        ],
      },
    ],
  },
  terms: {
    text: [
      "I have read and accepted the ",
      { label: "Terms and Conditions", href: termsUrl },
      " governing the MINA Decentralized Treasury, and I acknowledge and agree to the ",
      { label: "privacy terms", href: privacyUrl },
      " describing how my personal data will be collected and processed.",
    ],
  },
};
