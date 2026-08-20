<!-- trace: FLW-802D71B91D, FLW-FB5CAECCAD, FLW-FD2B1F4966, FLW-BEFDEF1197, FLW-E60ABD1745, FLW-9BA4D696D1, FLW-2F560AE009, FLW-5C8E5E0DE3, FLW-A565B35EC6, FLW-21AF7F4E4D, FLW-745B097927, FLW-9D28A6D299, FLW-6394A1B72B, FLW-5AA543472A, FLW-5E24C8B8E4, FLW-A6B92A4E6D, FLW-53B4410963, FLW-7DA083B071, FLW-9BB4E99B75, FLW-BFD5C6D535 -->
# Flows

<!-- trace: FLW-802D71B91D, FLW-FB5CAECCAD, FLW-FD2B1F4966, FLW-BEFDEF1197, FLW-E60ABD1745, FLW-9BA4D696D1, FLW-2F560AE009, FLW-5C8E5E0DE3, FLW-A565B35EC6, FLW-21AF7F4E4D, FLW-745B097927, FLW-9D28A6D299, FLW-6394A1B72B, FLW-5AA543472A, FLW-5E24C8B8E4, FLW-A6B92A4E6D, FLW-53B4410963, FLW-7DA083B071, FLW-9BB4E99B75, FLW-BFD5C6D535 -->
The model has 12 local flows and 8 cross-component flows.

<!-- trace: BHV-5095682725, INV-A0200396FA -->
## Lifecycle view
```mermaid
flowchart LR
  L0["PROPOSAL BHV-5095682725"]
  L1["EXPLORATION BHV-5095682725"]
  L2["VOTING BHV-5095682725"]
  L3["COOLDOWN BHV-5095682725"]
  L4["next lifecycle PROPOSAL and later BHV-5095682725"]
  L0 -->|"transition BHV-5095682725"| L1
  L1 -->|"transition BHV-5095682725"| L2
  L2 -->|"transition BHV-5095682725"| L3
  L3 -->|"transition BHV-5095682725"| L4
```

<!-- trace: FLW-802D71B91D, FLW-FB5CAECCAD, FLW-FD2B1F4966, FLW-BEFDEF1197, FLW-E60ABD1745, FLW-9BA4D696D1, FLW-2F560AE009, FLW-5C8E5E0DE3, FLW-A565B35EC6, FLW-21AF7F4E4D, FLW-745B097927, FLW-9D28A6D299, FLW-6394A1B72B, FLW-5AA543472A, FLW-5E24C8B8E4, FLW-A6B92A4E6D, FLW-53B4410963, FLW-7DA083B071, FLW-9BB4E99B75, FLW-BFD5C6D535, CMP-49180D7623, CMP-834A30297A, CMP-31D3990A1F, CMP-7DB1B15B38, CMP-2890255AE1, CMP-7CC27EFA43, CMP-874E479BA1, CMP-E155326DD2, CMP-B6BB8BE661, CMP-5CAF19BDCD, CMP-0F476A460D -->
## Principal flow view
```mermaid
flowchart LR
  PC0["Mina account/hash model CMP-49180D7623"]
  PC1["Treasury event schemas CMP-834A30297A"]
  PC2["Prefixed hashing and action chaining CMP-31D3990A1F"]
  PC3["Pause-controller multisig messages CMP-7DB1B15B38"]
  PC4["Prefixed Merkle trees and witnesses CMP-2890255AE1"]
  PC5["Provable ledger and hashing support CMP-7CC27EFA43"]
  PC6["Staking-ledger-to-voting-ledger ZkProgram CMP-874E479BA1"]
  PC7["Treasury Owner smart contract CMP-E155326DD2"]
  PC8["Treasury Pause Controller smart contract CMP-B6BB8BE661"]
  PC9["Treasury Proposal smart contract CMP-5CAF19BDCD"]
  PC10["Vote Reducer ZkProgram CMP-0F476A460D"]
  PF0["Staking-transformation digest proof statement FLW-802D71B91D"]
  PC6 -->|"owns FLW-802D71B91D"| PF0
  PF1["Owner-side proposal creation FLW-FB5CAECCAD"]
  PC7 -->|"owns FLW-FB5CAECCAD"| PF1
  PF2["Pause-controller command authorization FLW-FD2B1F4966"]
  PC8 -->|"owns FLW-FD2B1F4966"| PF2
  PF3["Proposal-local payout FLW-BEFDEF1197"]
  PC9 -->|"owns FLW-BEFDEF1197"| PF3
  PF4["Proposal-local tally FLW-E60ABD1745"]
  PC9 -->|"owns FLW-E60ABD1745"| PF4
  PF5["Vote-reduction proof statement FLW-9BA4D696D1"]
  PC10 -->|"owns FLW-9BA4D696D1"| PF5
  PF6["Treasury event producer-to-consumer schema FLW-2F560AE009"]
  PC1 -->|"owns FLW-2F560AE009"| PF6
  PF7["Public key to voting/nullifier root FLW-5C8E5E0DE3"]
  PC5 -->|"owns FLW-5C8E5E0DE3"| PF7
  PF8["Mina account to staking-ledger root FLW-A565B35EC6"]
  PC0 -->|"owns FLW-A565B35EC6"| PF8
  PF9["Global pause or unpause command FLW-21AF7F4E4D"]
  PC8 -->|"owns FLW-21AF7F4E4D"| PF9
  PF10["Emergency participant commitment rotation FLW-745B097927"]
  PC8 -->|"owns FLW-745B097927"| PF10
  PF11["Approved partial payout FLW-9D28A6D299"]
  PC7 -->|"owns FLW-9D28A6D299"| PF11
  PF12["Proposal creation and bond custody FLW-6394A1B72B"]
  PC7 -->|"owns FLW-6394A1B72B"| PF12
  PF13["Proposal-specific pause toggle FLW-5AA543472A"]
  PC8 -->|"owns FLW-5AA543472A"| PF13
  PF14["Proof-backed tally finalization FLW-5E24C8B8E4"]
  PC7 -->|"owns FLW-5E24C8B8E4"| PF14
  PF15["Vote authorization and action dispatch FLW-A6B92A4E6D"]
  PC7 -->|"owns FLW-A6B92A4E6D"| PF15
  PF16["Compose staking ranges and prove terminal boundary FLW-53B4410963"]
  PC6 -->|"owns FLW-53B4410963"| PF16
  PF17["Staking-to-voting digest batch FLW-7DA083B071"]
  PC6 -->|"owns FLW-7DA083B071"| PF17
  PF18["Recursive vote-proof aggregation FLW-9BB4E99B75"]
  PC10 -->|"owns FLW-9BB4E99B75"| PF18
  PF19["Vote reduction batch FLW-BFD5C6D535"]
  PC10 -->|"owns FLW-BFD5C6D535"| PF19
```

<!-- trace: FLW-802D71B91D, CMP-874E479BA1, BHV-C4F9C6CEE0, BHV-C01A568AAE, EVD-B30136F272, AST-48E151A2EB, CMP-7CC27EFA43, FLW-FB5CAECCAD, CMP-E155326DD2, BHV-5B1BD6B386, BHV-5095682725, BHV-80247CE73D, EVD-9E30964FCB, AST-4FF53BEEEB, FLW-FD2B1F4966, CMP-7DB1B15B38, BHV-8ED0438CC8, CMP-B6BB8BE661, BHV-F898CD867A, BHV-1FC418499A, BHV-DDC0A35072, EVD-05AEF87762, EVD-98C59C67BD, AST-4481913618, THR-0DEBF32E0A, THR-77C87EDE62, FLW-BEFDEF1197, CMP-5CAF19BDCD, BHV-F2207732B4, EVD-DD1C7DA36F, AST-97B28D8884, GAP-B798CE8DB1, GAP-F83C6F5411, FLW-E60ABD1745, BHV-1136BD4D08, BHV-A302A43C9F, EVD-79754810F6, AST-DAB25C2514, ASM-FF091135AE, FND-B5948FE3CF, FLW-9BA4D696D1, CMP-0F476A460D, BHV-50C1B246E0, BHV-E79288F8DA, EVD-810D58B5D2, AST-CBEC48B1E0, FLW-2F560AE009, CMP-834A30297A, BHV-761186E23C, EVD-02AE7D74CF, AST-BB5FF109EE, FLW-5C8E5E0DE3, BHV-08FB416CF3, CMP-31D3990A1F, BHV-CB4CCBE337, CMP-2890255AE1, BHV-4EC84F351D, EVD-6201011AC1, AST-4CAF411B32, FLW-A565B35EC6, CMP-49180D7623, BHV-44F30E27C0, BHV-0EED4FB2BD, EVD-03D20507BE, AST-04EED85D27, FLW-21AF7F4E4D, INV-1E832E77A4, INV-187FD2A7A9, EVD-337E2C2D56, AST-A132DD0B17, GAP-22CD8BD355, REQ-8BFD766005, SEC-10182FB352, FLW-745B097927, BHV-0D6A8D760E, INV-0697F6A5B4, EVD-CF08ADCD5E, EVD-8F785412DE, AST-7FB05AF254, ASM-E6AE27B10D, FLW-9D28A6D299, BHV-5D3FCC7B93, INV-EF3059DB8A, INV-681AEC9EF4, EVD-0E9360A4D5, AST-F5181D332F, GAP-7BAF881BED, FLW-6394A1B72B, BHV-5CBB373BE5, INV-A2C6F00258, INV-CF85A74EED, EVD-E95EC38949, EVD-9FC5B7AF30, AST-7BC1073B95, GAP-9398E85581, REQ-989D12F5D3, FLW-5AA543472A, BHV-10BA9AD71E, BHV-8B6F3A639B, BHV-8FA351E512, INV-015B387636, INV-DEFE674779, EVD-4908C76CF8, EVD-3FE5CD8A8A, EVD-6665BB19D1, AST-BA1211B140, THR-A943E3380A, FLW-5E24C8B8E4, BHV-4866A87097, INV-F79F5B8C65, INV-222CED01FB, INV-159AD1A04E, EVD-5AED8D6498, AST-9329F20061, UNR-13C729A54A, FLW-A6B92A4E6D, BHV-8E9F5C3ECE, BHV-9E1B7D1BA1, INV-BD6F8D1028, INV-A0200396FA, EVD-2598ABF031, EVD-9D0B8E0BBB, AST-5A260DA2E6, FLW-53B4410963, BHV-17E3A4CB8C, BHV-E7ECC5B6FC, EVD-B7C40C0F6F, AST-BE02BC3E3B, FND-CA0F83CE86, INV-016B52DE5B, FLW-7DA083B071, EVD-177476A23F, AST-D3DF75DC95, ASM-73AF207816, INV-2A14CD3045, FLW-9BB4E99B75, BHV-67153EA362, EVD-4F2874E860, AST-0BF72F1A24, FLW-BFD5C6D535, BHV-CEE91EC6D9, BHV-141ED40E5D, BHV-3946C60752, EVD-D70E747767, AST-6FDBBB5290 -->
## Flow index
| ID | Topic | Status | Static conclusion | Pass 2 |
| --- | --- | --- | --- | --- |
| [FLW-802D71B91D](SPECIFICATION.md#flw-802d71b91d) | Staking-transformation digest proof statement | LOCAL | The proof binds the mathematical root transition, not transactional durability of the host ledger writes. | CONFIRMED |
| [FLW-FB5CAECCAD](SPECIFICATION.md#flw-fb5caeccad) | Owner-side proposal creation | LOCAL | This local view ends at outbound proposal account-update approval; the orchestrator must compose the cross-contract flow. | CONFIRMED |
| [FLW-FD2B1F4966](SPECIFICATION.md#flw-fd2b1f4966) | Pause-controller command authorization | LOCAL | [Exact technical value; STE length exception] The local interpretation for Pause-controller command authorization remains source-supported, but complete context adds cross-component policy, trust, lifecycle, or liveness qualifications represented by the linked context records. | REFINED |
| [FLW-BEFDEF1197](SPECIFICATION.md#flw-befdef1197) | Proposal-local payout | LOCAL | The local interpretation for Proposal-local payout remains source-supported, but complete context adds cross-component policy, trust, lifecycle, or liveness qualifications represented by the linked context records. | REFINED |
| [FLW-E60ABD1745](SPECIFICATION.md#flw-e60abd1745) | Proposal-local tally | LOCAL | The local interpretation for Proposal-local tally remains source-supported, but complete context adds cross-component policy, trust, lifecycle, or liveness qualifications represented by the linked context records. | REFINED |
| [FLW-9BA4D696D1](SPECIFICATION.md#flw-9ba4d696d1) | Vote-reduction proof statement | LOCAL | Host nullifier writes are operational side effects and are not themselves guaranteed by proof verification. | CONFIRMED |
| [FLW-2F560AE009](SPECIFICATION.md#flw-2f560ae009) | Treasury event producer-to-consumer schema | SUPPORTED_STATICALLY | Tests establish static encoding expectations for the shared schema, not correctness of values emitted by production methods. | CONFIRMED |
| [FLW-5C8E5E0DE3](SPECIFICATION.md#flw-5c8e5e0de3) | Public key to voting/nullifier root | SUPPORTED_STATICALLY | Both ledgers use the identical positional index but distinct prefixed empty/typed leaf values. | CONFIRMED |
| [FLW-A565B35EC6](SPECIFICATION.md#flw-a565b35ec6) | Mina account to staking-ledger root | SUPPORTED_STATICALLY | The same account encoding supplies both the empty staking leaf and populated leaf hash path. | CONFIRMED |
| [FLW-21AF7F4E4D](SPECIFICATION.md#flw-21af7f4e4d) | Global pause or unpause command | LOCAL | Global pause authorization lacks deployment-domain binding and an on-chain event and relies on distinct recoverable signers. | REFINED |
| [FLW-745B097927](SPECIFICATION.md#flw-745b097927) | Emergency participant commitment rotation | LOCAL | [Exact technical value; STE length exception] The local interpretation for Emergency participant commitment rotation remains source-supported, but complete context adds cross-component policy, trust, lifecycle, or liveness qualifications represented by the linked context records. | REFINED |
| [FLW-9D28A6D299](SPECIFICATION.md#flw-9d28a6d299) | Approved partial payout | CROSS_COMPONENT | Recipient-bound payout is source-visible, but claims are unreserved, caller ordered, unexpired, and lack a completion state. | REFINED |
| [FLW-6394A1B72B](SPECIFICATION.md#flw-6394a1b72b) | Proposal creation and bond custody | CROSS_COMPONENT | [Exact technical value; STE length exception] The local interpretation for Proposal creation and bond custody remains source-supported, but complete context adds cross-component policy, trust, lifecycle, or liveness qualifications represented by the linked context records. | REFINED |
| [FLW-5AA543472A](SPECIFICATION.md#flw-5aa543472a) | Proposal-specific pause toggle | CROSS_COMPONENT | Authorization is a blind toggle, terminal status can be lost, and the emitted Bool can disagree with state. | REFINED |
| [FLW-5E24C8B8E4](SPECIFICATION.md#flw-5e24c8b8e4) | Proof-backed tally finalization | CROSS_COMPONENT | [Exact technical value; STE length exception] The local interpretation for Proof-backed tally finalization remains source-supported, but complete context adds cross-component policy, trust, lifecycle, or liveness qualifications represented by the linked context records. | REFINED |
| [FLW-A6B92A4E6D](SPECIFICATION.md#flw-a6b92a4e6d) | Vote authorization and action dispatch | CROSS_COMPONENT | Dispatch authenticity and tally eligibility are separate boundaries. | CONFIRMED |
| [FLW-53B4410963](SPECIFICATION.md#flw-53b4410963) | Compose staking ranges and prove terminal boundary | LOCAL | Recursive adjacency is constrained, but terminal completeness still relies on a dense staking-ledger representation. | REFINED |
| [FLW-7DA083B071](SPECIFICATION.md#flw-7da083b071) | Staking-to-voting digest batch | LOCAL | [Exact technical value; STE length exception] The local interpretation for Staking-to-voting digest batch remains source-supported, but complete context adds cross-component policy, trust, lifecycle, or liveness qualifications represented by the linked context records. | REFINED |
| [FLW-9BB4E99B75](SPECIFICATION.md#flw-9bb4e99b75) | Recursive vote-proof aggregation | LOCAL | The result uses proof2 terminal commitments and additive vote totals. | CONFIRMED |
| [FLW-BFD5C6D535](SPECIFICATION.md#flw-bfd5c6d535) | Vote reduction batch | LOCAL | All five actions traverse the same membership/nullifier path; dummy only changes selected downstream effects. | CONFIRMED |

<!-- trace: FLW-802D71B91D, CMP-874E479BA1, BHV-C4F9C6CEE0, BHV-C01A568AAE -->
## Staking-transformation digest proof statement — FLW-802D71B91D
```mermaid
flowchart LR
  S0["1. start from public index, staking root, and voting root BHV-C4F9C6CEE0"]
  S1["2. for five consecutive accounts prove staking membership BHV-C4F9C6CEE0"]
  S0 -->|"next FLW-802D71B91D"| S1
  S2["3. prove delegate voting leaf/index and add balance BHV-C01A568AAE"]
  S1 -->|"next FLW-802D71B91D"| S2
  S3["4. return terminal index/root; perform host voting-ledger writes BHV-C4F9C6CEE0"]
  S2 -->|"next FLW-802D71B91D"| S3
  O0["digest proof output FLW-802D71B91D"]
  S3 -->|"outcome FLW-802D71B91D"| O0
  O1["witness/constraint failure FLW-802D71B91D"]
  S3 -->|"outcome FLW-802D71B91D"| O1
  O2["partial host mutation FLW-802D71B91D"]
  S3 -->|"outcome FLW-802D71B91D"| O2
```

<!-- trace: FLW-FB5CAECCAD, CMP-E155326DD2, BHV-5B1BD6B386, BHV-5095682725, BHV-80247CE73D -->
## Owner-side proposal creation — FLW-FB5CAECCAD
```mermaid
flowchart LR
  S0["1. snapshot staking epoch ledger hash and total currency BHV-5B1BD6B386"]
  S1["2. require proposal period and global unpaused state BHV-5095682725"]
  S0 -->|"next FLW-FB5CAECCAD"| S1
  S2["3. credit bond and construct signed derived-token proposal account update BHV-80247CE73D"]
  S1 -->|"next FLW-FB5CAECCAD"| S2
  S3["4. write proposal app state, verification key, permissions, URI; emit event BHV-80247CE73D"]
  S2 -->|"next FLW-FB5CAECCAD"| S3
  O0["proposal account update approved FLW-FB5CAECCAD"]
  S3 -->|"outcome FLW-FB5CAECCAD"| O0
  O1["transaction rejected FLW-FB5CAECCAD"]
  S3 -->|"outcome FLW-FB5CAECCAD"| O1
```

<!-- trace: FLW-FD2B1F4966, CMP-7DB1B15B38, BHV-8ED0438CC8, CMP-B6BB8BE661, BHV-F898CD867A, BHV-1FC418499A, BHV-DDC0A35072 -->
## Pause-controller command authorization — FLW-FD2B1F4966
```mermaid
flowchart LR
  S0["1. derive operation-specific prefixed data hash BHV-8ED0438CC8"]
  S1["2. witness exactly five participants and bind ordered commitment BHV-F898CD867A"]
  S0 -->|"next FLW-FD2B1F4966"| S1
  S2["3. verify at least three signatures BHV-F898CD867A"]
  S1 -->|"next FLW-FD2B1F4966"| S2
  S3["4. require and increment account nonce BHV-1FC418499A"]
  S2 -->|"next FLW-FD2B1F4966"| S3
  S4["5. apply local state effect when applicable BHV-DDC0A35072"]
  S3 -->|"next FLW-FD2B1F4966"| S4
  O0["authorized command FLW-FD2B1F4966"]
  S4 -->|"outcome FLW-FD2B1F4966"| O0
  O1["constraint rejection FLW-FD2B1F4966"]
  S4 -->|"outcome FLW-FD2B1F4966"| O1
```

<!-- trace: FLW-BEFDEF1197, CMP-5CAF19BDCD, BHV-F2207732B4 -->
## Proposal-local payout — FLW-BEFDEF1197
```mermaid
flowchart LR
  S0["1. require not paused and APPROVED BHV-F2207732B4"]
  S1["2. compute amount plus bond less prior payouts BHV-F2207732B4"]
  S0 -->|"next FLW-BEFDEF1197"| S1
  S2["3. bind recipient key to recipientHash BHV-F2207732B4"]
  S1 -->|"next FLW-BEFDEF1197"| S2
  S3["4. credit recipient update and increment paidOutAmount BHV-F2207732B4"]
  S2 -->|"next FLW-BEFDEF1197"| S3
  O0["partial/full payout approved FLW-BEFDEF1197"]
  S3 -->|"outcome FLW-BEFDEF1197"| O0
  O1["constraint rejection FLW-BEFDEF1197"]
  S3 -->|"outcome FLW-BEFDEF1197"| O1
```

<!-- trace: FLW-E60ABD1745, CMP-5CAF19BDCD, BHV-1136BD4D08, BHV-A302A43C9F -->
## Proposal-local tally — FLW-E60ABD1745
```mermaid
flowchart LR
  S0["1. require UNKNOWN and verify both side-loaded proofs BHV-1136BD4D08"]
  S1["2. bind initial roots/index, voting root, staking snapshot, and exhaustion BHV-1136BD4D08"]
  S0 -->|"next FLW-E60ABD1745"| S1
  S2["3. prove Treasury Owner default-token account membership in snapshot BHV-1136BD4D08"]
  S1 -->|"next FLW-E60ABD1745"| S2
  S3["4. compute participation/approval and store result BHV-A302A43C9F"]
  S2 -->|"next FLW-E60ABD1745"| S3
  O0["APPROVED FLW-E60ABD1745"]
  S3 -->|"outcome FLW-E60ABD1745"| O0
  O1["REJECTED only when participation and non-abstain-vote assertions pass FLW-E60ABD1745"]
  S3 -->|"outcome FLW-E60ABD1745"| O1
  O2["constraint rejection FLW-E60ABD1745"]
  S3 -->|"outcome FLW-E60ABD1745"| O2
```

<!-- trace: FLW-9BA4D696D1, CMP-0F476A460D, BHV-50C1B246E0, BHV-E79288F8DA -->
## Vote-reduction proof statement — FLW-9BA4D696D1
```mermaid
flowchart LR
  S0["1. start from public action/nullifier roots and target action-state hashes BHV-50C1B246E0"]
  S1["2. for each of five actions prove voter leaf/index and nullifier leaf/index BHV-E79288F8DA"]
  S0 -->|"next FLW-9BA4D696D1"| S1
  S2["3. roll nullifier root, tallies, action hash, and found flags BHV-50C1B246E0"]
  S1 -->|"next FLW-9BA4D696D1"| S2
  S3["4. return public terminal state; perform host nullifier writes BHV-50C1B246E0"]
  S2 -->|"next FLW-9BA4D696D1"| S3
  O0["batch proof public output FLW-9BA4D696D1"]
  S3 -->|"outcome FLW-9BA4D696D1"| O0
  O1["witness/constraint failure FLW-9BA4D696D1"]
  S3 -->|"outcome FLW-9BA4D696D1"| O1
  O2["host mutation failure during proof construction FLW-9BA4D696D1"]
  S3 -->|"outcome FLW-9BA4D696D1"| O2
```

<!-- trace: FLW-2F560AE009, CMP-834A30297A, BHV-761186E23C -->
## Treasury event producer-to-consumer schema — FLW-2F560AE009
```mermaid
flowchart LR
  S0["1. Producer constructs one of five shared Structs. BHV-761186E23C"]
  S1["2. Struct fields are encoded under the fixed event name. BHV-761186E23C"]
  S0 -->|"next FLW-2F560AE009"| S1
  S2["3. Consumer decodes fields using the same Struct. BHV-761186E23C"]
  S1 -->|"next FLW-2F560AE009"| S2
  O0["typed decoded event FLW-2F560AE009"]
  S2 -->|"outcome FLW-2F560AE009"| O0
```

<!-- trace: FLW-5C8E5E0DE3, CMP-7CC27EFA43, BHV-08FB416CF3, CMP-31D3990A1F, BHV-CB4CCBE337, CMP-2890255AE1, BHV-4EC84F351D -->
## Public key to voting/nullifier root — FLW-5C8E5E0DE3
```mermaid
flowchart LR
  S0["1. Decode/special-case public key and Poseidon-hash its fields. BHV-08FB416CF3"]
  S1["2. Encode VotingAccount balance or Bool nullifier under its leaf prefix. BHV-CB4CCBE337"]
  S0 -->|"next FLW-5C8E5E0DE3"| S1
  S2["3. Read witness or mutate prefixed tree at derived index. BHV-4EC84F351D"]
  S1 -->|"next FLW-5C8E5E0DE3"| S2
  O0["typed witness/root FLW-5C8E5E0DE3"]
  S2 -->|"outcome FLW-5C8E5E0DE3"| O0
  O1["propagated error FLW-5C8E5E0DE3"]
  S2 -->|"outcome FLW-5C8E5E0DE3"| O1
```

<!-- trace: FLW-A565B35EC6, CMP-49180D7623, BHV-44F30E27C0, BHV-0EED4FB2BD, CMP-2890255AE1, BHV-4EC84F351D -->
## Mina account to staking-ledger root — FLW-A565B35EC6
```mermaid
flowchart LR
  S0["1. Construct/receive Account and derive Account.toHashInput. BHV-44F30E27C0"]
  S1["2. Pack bounded chunks and hash with MinaAccount prefix. BHV-0EED4FB2BD"]
  S0 -->|"next FLW-A565B35EC6"| S1
  S2["3. Persist leaf and recompute prefixed ancestors. BHV-4EC84F351D"]
  S1 -->|"next FLW-A565B35EC6"| S2
  O0["new staking root FLW-A565B35EC6"]
  S2 -->|"outcome FLW-A565B35EC6"| O0
  O1["throw with zero or partial storage mutations FLW-A565B35EC6"]
  S2 -->|"outcome FLW-A565B35EC6"| O1
```

<!-- trace: FLW-21AF7F4E4D, BHV-F898CD867A, CMP-B6BB8BE661, BHV-8ED0438CC8, BHV-DDC0A35072 -->
## Global pause or unpause command — FLW-21AF7F4E4D
```mermaid
flowchart LR
  S0["1. Controller witnesses exactly five host-static keys and binds their ordered commitment. BHV-F898CD867A"]
  S1["2. Three valid signature slots authorize operation-prefixed data. BHV-8ED0438CC8"]
  S0 -->|"next FLW-21AF7F4E4D"| S1
  S2["3. Controller requires/increments nonce and explicitly writes paused Bool. BHV-DDC0A35072"]
  S1 -->|"next FLW-21AF7F4E4D"| S2
  O0["globally paused FLW-21AF7F4E4D"]
  S2 -->|"outcome FLW-21AF7F4E4D"| O0
  O1["globally unpaused FLW-21AF7F4E4D"]
  S2 -->|"outcome FLW-21AF7F4E4D"| O1
  O2["atomic rejection FLW-21AF7F4E4D"]
  S2 -->|"outcome FLW-21AF7F4E4D"| O2
```

<!-- trace: FLW-745B097927, BHV-8ED0438CC8, CMP-B6BB8BE661, BHV-F898CD867A, BHV-0D6A8D760E -->
## Emergency participant commitment rotation — FLW-745B097927
```mermaid
flowchart LR
  S0["1. Signatures bind current commitment, next commitment, and current nonce. BHV-8ED0438CC8"]
  S1["2. Controller verifies current participant preimage and consumes nonce. BHV-F898CD867A"]
  S0 -->|"next FLW-745B097927"| S1
  S2["3. Controller stores arbitrary next commitment; operator must update the static preimage out of band. BHV-0D6A8D760E"]
  S1 -->|"next FLW-745B097927"| S2
  O0["new authority active when host preimage matches FLW-745B097927"]
  S2 -->|"outcome FLW-745B097927"| O0
  O1["controller authorization unavailable when preimage is missing/malformed FLW-745B097927"]
  S2 -->|"outcome FLW-745B097927"| O1
  O2["atomic rejection FLW-745B097927"]
  S2 -->|"outcome FLW-745B097927"| O2
```

<!-- trace: FLW-9D28A6D299, BHV-5D3FCC7B93, CMP-E155326DD2, BHV-F2207732B4, CMP-5CAF19BDCD -->
## Approved partial payout — FLW-9D28A6D299
```mermaid
flowchart LR
  S0["1. Owner enforces global pause and next-lifecycle timing. BHV-5D3FCC7B93"]
  S1["2. Owner debits requested amount. BHV-5D3FCC7B93"]
  S0 -->|"next FLW-9D28A6D299"| S1
  S2["3. Proposal enforces APPROVED, recipient hash, and remaining amount-plus-bond cap. BHV-F2207732B4"]
  S1 -->|"next FLW-9D28A6D299"| S2
  S3["4. Proposal credits recipient and advances paidOutAmount; Owner emits execution event. BHV-F2207732B4"]
  S2 -->|"next FLW-9D28A6D299"| S3
  O0["partial or full recipient payment FLW-9D28A6D299"]
  S3 -->|"outcome FLW-9D28A6D299"| O0
  O1["zero-value no-progress event FLW-9D28A6D299"]
  S3 -->|"outcome FLW-9D28A6D299"| O1
  O2["atomic rejection FLW-9D28A6D299"]
  S3 -->|"outcome FLW-9D28A6D299"| O2
```

<!-- trace: FLW-6394A1B72B, BHV-5B1BD6B386, CMP-E155326DD2, BHV-5095682725, BHV-80247CE73D, BHV-5CBB373BE5, CMP-834A30297A -->
## Proposal creation and bond custody — FLW-6394A1B72B
```mermaid
flowchart LR
  S0["1. Owner snapshots staking epoch hash and total currency. BHV-5B1BD6B386"]
  S1["2. Owner enforces proposal period and global unpaused state. BHV-5095682725"]
  S0 -->|"next FLW-6394A1B72B"| S1
  S2["3. Containing transaction debits a bond source while Owner credits amount/10. BHV-80247CE73D"]
  S1 -->|"next FLW-6394A1B72B"| S2
  S3["4. Signed proposal token account receives committed proposal state, key, permissions, and URI. BHV-80247CE73D"]
  S2 -->|"next FLW-6394A1B72B"| S3
  S4["5. Owner emits creation event with sender labeled as proposer. BHV-5CBB373BE5"]
  S3 -->|"next FLW-6394A1B72B"| S4
  O0["proposal UNKNOWN and bond held by Owner FLW-6394A1B72B"]
  S4 -->|"outcome FLW-6394A1B72B"| O0
  O1["atomic rejection FLW-6394A1B72B"]
  S4 -->|"outcome FLW-6394A1B72B"| O1
```

<!-- trace: FLW-5AA543472A, BHV-10BA9AD71E, CMP-B6BB8BE661, BHV-8B6F3A639B, CMP-5CAF19BDCD, BHV-8FA351E512, CMP-E155326DD2 -->
## Proposal-specific pause toggle — FLW-5AA543472A
```mermaid
flowchart LR
  S0["1. Controller validates proposal-key-plus-nonce toggle and consumes nonce. BHV-10BA9AD71E"]
  S1["2. Proposal toggles shared status without desired-state input. BHV-8B6F3A639B"]
  S0 -->|"next FLW-5AA543472A"| S1
  S2["3. Owner emits the caller-provided paused Bool. BHV-8FA351E512"]
  S1 -->|"next FLW-5AA543472A"| S2
  O0["proposal PAUSED FLW-5AA543472A"]
  S2 -->|"outcome FLW-5AA543472A"| O0
  O1["proposal UNKNOWN FLW-5AA543472A"]
  S2 -->|"outcome FLW-5AA543472A"| O1
  O2["event may disagree with state FLW-5AA543472A"]
  S2 -->|"outcome FLW-5AA543472A"| O2
  O3["atomic rejection FLW-5AA543472A"]
  S2 -->|"outcome FLW-5AA543472A"| O3
```

<!-- trace: FLW-5E24C8B8E4, BHV-4866A87097, CMP-E155326DD2, BHV-1136BD4D08, CMP-5CAF19BDCD, BHV-A302A43C9F -->
## Proof-backed tally finalization — FLW-5E24C8B8E4
```mermaid
flowchart LR
  S0["1. Owner verifies both proofs and cooldown/global pause gates. BHV-4866A87097"]
  S1["2. Owner binds five action-history targets to current, found, non-initial, unique proposal action states. BHV-4866A87097"]
  S0 -->|"next FLW-5E24C8B8E4"| S1
  S2["3. Proposal re-verifies proofs and binds roots, indices, exhaustion, action head, and Treasury Owner account snapshot. BHV-1136BD4D08"]
  S1 -->|"next FLW-5E24C8B8E4"| S2
  S3["4. Proposal derives dynamic thresholds and stores outcome; Owner emits weights and result. BHV-A302A43C9F"]
  S2 -->|"next FLW-5E24C8B8E4"| S3
  O0["APPROVED FLW-5E24C8B8E4"]
  S3 -->|"outcome FLW-5E24C8B8E4"| O0
  O1["REJECTED when participation and nonzero directional votes exist but approval fails FLW-5E24C8B8E4"]
  S3 -->|"outcome FLW-5E24C8B8E4"| O1
  O2["UNKNOWN after rejected transaction FLW-5E24C8B8E4"]
  S3 -->|"outcome FLW-5E24C8B8E4"| O2
```

<!-- trace: FLW-A6B92A4E6D, BHV-8E9F5C3ECE, CMP-E155326DD2, BHV-9E1B7D1BA1, CMP-5CAF19BDCD -->
## Vote authorization and action dispatch — FLW-A6B92A4E6D
```mermaid
flowchart LR
  S0["1. Owner binds sender signature, pause state, lifecycle, and vote enum. BHV-8E9F5C3ECE"]
  S1["2. Proposal requires non-PAUSED and dispatches VoteAction. BHV-9E1B7D1BA1"]
  S0 -->|"next FLW-A6B92A4E6D"| S1
  S2["3. Owner emits event and requires the voter key signature through a signed account update. BHV-8E9F5C3ECE"]
  S1 -->|"next FLW-A6B92A4E6D"| S2
  O0["queued vote action FLW-A6B92A4E6D"]
  S2 -->|"outcome FLW-A6B92A4E6D"| O0
  O1["atomic rejection FLW-A6B92A4E6D"]
  S2 -->|"outcome FLW-A6B92A4E6D"| O1
```

<!-- trace: FLW-53B4410963, CMP-874E479BA1, BHV-17E3A4CB8C, BHV-E7ECC5B6FC -->
## Compose staking ranges and prove terminal boundary — FLW-53B4410963
```mermaid
flowchart LR
  S0["1. Merge adjacent digest/merged proofs using fixed root, index adjacency, and voting-root handoff. BHV-17E3A4CB8C"]
  S1["2. Verify the aggregate proof and bind outer public input to its input. BHV-17E3A4CB8C"]
  S0 -->|"next FLW-53B4410963"| S1
  S2["3. Witness Account.empty at terminal index plus one under the staking root. BHV-E7ECC5B6FC"]
  S1 -->|"next FLW-53B4410963"| S2
  O0["aggregate public output retains terminal index/root and marks exhausted=true FLW-53B4410963"]
  S2 -->|"outcome FLW-53B4410963"| O0
```

<!-- trace: FLW-7DA083B071, CMP-874E479BA1, BHV-C4F9C6CEE0, BHV-C01A568AAE -->
## Staking-to-voting digest batch — FLW-7DA083B071
```mermaid
flowchart LR
  S0["1. For each account, witness height-36 path and bind account hash to current consecutive index under fixed root. BHV-C4F9C6CEE0"]
  S1["2. Select account.delegate; witness delegate voting account/path and bind old leaf to rolling root plus Poseidon(delegate) index. BHV-C01A568AAE"]
  S0 -->|"next FLW-7DA083B071"| S1
  S2["3. Add account.balance, derive updated voting root, and invoke host record/tree writes. BHV-C01A568AAE"]
  S1 -->|"next FLW-7DA083B071"| S2
  S3["4. Increment index and repeat exactly five times. BHV-C4F9C6CEE0"]
  S2 -->|"next FLW-7DA083B071"| S3
  O0["last index and terminal voting root with exhausted=false FLW-7DA083B071"]
  S3 -->|"outcome FLW-7DA083B071"| O0
```

<!-- trace: FLW-9BB4E99B75, CMP-0F476A460D, BHV-67153EA362 -->
## Recursive vote-proof aggregation — FLW-9BB4E99B75
```mermaid
flowchart LR
  S0["1. Verify both proofs and bind caller input to proof1 input by Poseidon hash. BHV-67153EA362"]
  S1["2. Bind common voting root and action/nullifier adjacency. BHV-67153EA362"]
  S0 -->|"next FLW-9BB4E99B75"| S1
  S2["3. Bind target hashes, sum UInt64 tallies, and combine found flags. BHV-67153EA362"]
  S1 -->|"next FLW-9BB4E99B75"| S2
  O0["one recursively verified proof spanning both ordered ranges FLW-9BB4E99B75"]
  S2 -->|"outcome FLW-9BB4E99B75"| O0
```

<!-- trace: FLW-BFD5C6D535, CMP-0F476A460D, BHV-50C1B246E0, BHV-CEE91EC6D9, BHV-E79288F8DA, BHV-141ED40E5D, BHV-3946C60752 -->
## Vote reduction batch — FLW-BFD5C6D535
```mermaid
flowchart LR
  S0["1. Initialize rolling roots, zero tallies, and false target flags from public input. BHV-50C1B246E0"]
  S1["2. For each action, validate enum and classify exact dummy padding. BHV-CEE91EC6D9"]
  S0 -->|"next FLW-BFD5C6D535"| S1
  S2["3. Witness voting account/path and constrain root plus Poseidon(publicKey) index. BHV-E79288F8DA"]
  S1 -->|"next FLW-BFD5C6D535"| S2
  S3["4. Witness nullifier/path, constrain rolling root/index, and compute conditional true leaf. BHV-141ED40E5D"]
  S2 -->|"next FLW-BFD5C6D535"| S3
  S4["5. Attempt host nullifier record/tree persistence for non-dummy action. BHV-141ED40E5D"]
  S3 -->|"next FLW-BFD5C6D535"| S4
  S5["6. Add selected weight, append action commitment, and update target flags. BHV-3946C60752"]
  S4 -->|"next FLW-BFD5C6D535"| S5
  O0["public output contains terminal roots, batch tallies, and target history FLW-BFD5C6D535"]
  S5 -->|"outcome FLW-BFD5C6D535"| O0
```
