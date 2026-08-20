<!-- trace: CMP-B6BB8BE661 -->
<a id="cmp-b6bb8be661"></a>
# Treasury Pause Controller smart contract — CMP-B6BB8BE661

<!-- trace: CMP-B6BB8BE661, EVD-98C59C67BD, AST-41614D307F, SEC-10182FB352 -->
## Component summary
| Responsibility | Source paths | Static conclusion | Pass 2 |
| --- | --- | --- | --- |
| Treasury Pause Controller smart contract | None recorded. | The controller binds witnessed participant keys to an on-chain commitment and consumes its nonce on each authorized state-changing command. | [Exact technical value; STE length exception] CONFIRMED. The Pass-1 components interpretation for Treasury Pause Controller smart contract remains consistent with raw anchors and complete context; confirmation is static and does not claim runtime, deployment, or proof-system assurance. |

<!-- trace: CMP-B6BB8BE661, IO-4EA1C35B8D, IO-1F97CF4E82 -->
## Inputs and outputs
| Direction | Records |
| --- | --- |
| Inputs | [IO-4EA1C35B8D](../SPECIFICATION.md#io-4ea1c35b8d), [IO-1F97CF4E82](../SPECIFICATION.md#io-1f97cf4e82) |
| Outputs | None recorded. |

<!-- trace: CMP-B6BB8BE661, REL-52D00868F0, REL-4237EF6012, CL-C07EA8DC01, CL-EE7157BCAE, CL-DA4E524A76, CL-06DF3A63C6, CL-45EF6B9C3E, INV-1E832E77A4, INV-187FD2A7A9, INV-0697F6A5B4 -->
## State, permissions, and errors
| Topic | Records |
| --- | --- |
| State and invariants | [INV-1E832E77A4](../SPECIFICATION.md#inv-1e832e77a4), [INV-187FD2A7A9](../SPECIFICATION.md#inv-187fd2a7a9), [INV-0697F6A5B4](../SPECIFICATION.md#inv-0697f6a5b4) |
| Permissions | REL-52D00868F0, REL-4237EF6012 |
| Errors and rejection paths | CL-C07EA8DC01, CL-EE7157BCAE, CL-DA4E524A76, CL-06DF3A63C6, CL-45EF6B9C3E |

<!-- trace: CMP-B6BB8BE661, REQ-8BFD766005, CMP-7DB1B15B38, BHV-8ED0438CC8, BHV-DDC0A35072, FLW-FD2B1F4966, FLW-21AF7F4E4D, FLW-745B097927, FLW-5AA543472A, CL-C07EA8DC01, CL-EE7157BCAE, CL-DA4E524A76, CL-06DF3A63C6, CL-45EF6B9C3E, INV-1E832E77A4, INV-187FD2A7A9, INV-0697F6A5B4, IO-4EA1C35B8D, IO-1F97CF4E82, REL-63B84007BB, REL-DB7F631FEE, REL-1FB12A6A77, REL-26D4DBC387, REL-3F2BE04199, REL-9F3429D10A, REL-08A70D7B33, REL-50D332175F, REL-B1A7D393B9, REL-F1C0CEA10E, REL-F2F467DE44, REL-52D00868F0, REL-4237EF6012, REL-DEB2AB770C, REL-00AEF1536B, THR-77C87EDE62, THR-0DEBF32E0A, ASM-E6AE27B10D, ASM-E0E1752AF7, ZKP-EFB3E28391 -->
## Dependencies, tests, and open matters
| Topic | Records |
| --- | --- |
| Dependencies and relations | [Exact technical value; STE length exception] [REL-63B84007BB](../SPECIFICATION.md#rel-63b84007bb), [REL-DB7F631FEE](../SPECIFICATION.md#rel-db7f631fee), [REL-1FB12A6A77](../SPECIFICATION.md#rel-1fb12a6a77), [REL-26D4DBC387](../SPECIFICATION.md#rel-26d4dbc387), [REL-3F2BE04199](../SPECIFICATION.md#rel-3f2be04199), [REL-9F3429D10A](../SPECIFICATION.md#rel-9f3429d10a), [REL-08A70D7B33](../SPECIFICATION.md#rel-08a70d7b33), [REL-50D332175F](../SPECIFICATION.md#rel-50d332175f), [REL-B1A7D393B9](../SPECIFICATION.md#rel-b1a7d393b9), [REL-F1C0CEA10E](../SPECIFICATION.md#rel-f1c0cea10e), [REL-F2F467DE44](../SPECIFICATION.md#rel-f2f467de44), [REL-52D00868F0](../SPECIFICATION.md#rel-52d00868f0), [REL-4237EF6012](../SPECIFICATION.md#rel-4237ef6012), [REL-DEB2AB770C](../SPECIFICATION.md#rel-deb2ab770c), [REL-00AEF1536B](../SPECIFICATION.md#rel-00aef1536b) |
| Tests | None recorded. |
| Findings | None recorded. |
| Gaps | None recorded. |
| Unresolved | None recorded. |

<!-- trace: CMP-B6BB8BE661, REQ-8BFD766005, CMP-7DB1B15B38, BHV-8ED0438CC8, BHV-DDC0A35072, FLW-FD2B1F4966, FLW-21AF7F4E4D, FLW-745B097927, FLW-5AA543472A, CL-C07EA8DC01, CL-EE7157BCAE, CL-DA4E524A76, CL-06DF3A63C6, CL-45EF6B9C3E, INV-1E832E77A4, INV-187FD2A7A9, INV-0697F6A5B4, IO-4EA1C35B8D, IO-1F97CF4E82, REL-63B84007BB, REL-DB7F631FEE, REL-1FB12A6A77, REL-26D4DBC387, REL-3F2BE04199, REL-9F3429D10A, REL-08A70D7B33, REL-50D332175F, REL-B1A7D393B9, REL-F1C0CEA10E, REL-F2F467DE44, REL-52D00868F0, REL-4237EF6012, REL-DEB2AB770C, REL-00AEF1536B, THR-77C87EDE62, THR-0DEBF32E0A, ASM-E6AE27B10D, ASM-E0E1752AF7, ZKP-EFB3E28391 -->
## Related semantic records
| ID | Type | Topic |
| --- | --- | --- |
| [REQ-8BFD766005](../SPECIFICATION.md#req-8bfd766005) | REQ | Break-glass multisig intervention |
| [CMP-7DB1B15B38](../SPECIFICATION.md#cmp-7db1b15b38) | CMP | Pause-controller multisig messages |
| [BHV-8ED0438CC8](../SPECIFICATION.md#bhv-8ed0438cc8) | BHV | Construct operation-prefixed signature data |
| [BHV-DDC0A35072](../SPECIFICATION.md#bhv-ddc0a35072) | BHV | Set global treasury pause state |
| [FLW-FD2B1F4966](../SPECIFICATION.md#flw-fd2b1f4966) | FLW | Pause-controller command authorization |
| [FLW-21AF7F4E4D](../SPECIFICATION.md#flw-21af7f4e4d) | FLW | Global pause or unpause command |
| [FLW-745B097927](../SPECIFICATION.md#flw-745b097927) | FLW | Emergency participant commitment rotation |
| [FLW-5AA543472A](../SPECIFICATION.md#flw-5aa543472a) | FLW | Proposal-specific pause toggle |
| [CL-C07EA8DC01](../SPECIFICATION.md#cl-c07ea8dc01) | CL | clause:treasury-contracts:multisig:commitment |
| [CL-EE7157BCAE](../SPECIFICATION.md#cl-ee7157bcae) | CL | clause:treasury-contracts:multisig:threshold |
| [CL-DA4E524A76](../SPECIFICATION.md#cl-da4e524a76) | CL | clause:treasury-contracts:pause:init-count |
| [CL-06DF3A63C6](../SPECIFICATION.md#cl-06df3a63c6) | CL | clause:treasury-contracts:pause:nonce |
| [CL-45EF6B9C3E](../SPECIFICATION.md#cl-45ef6b9c3e) | CL | clause:treasury-contracts:pause:verify-count |
| [INV-1E832E77A4](../SPECIFICATION.md#inv-1e832e77a4) | INV | Emergency commands require at least three valid signature slots under the ordered participant list committed in controller state. |
| [INV-187FD2A7A9](../SPECIFICATION.md#inv-187fd2a7a9) | INV | An accepted emergency command cannot be replayed against the same controller nonce. |
| [INV-0697F6A5B4](../SPECIFICATION.md#inv-0697f6a5b4) | INV | Every stored multisig commitment must have an available exact five-key host-static preimage controlled by the intended distinct participants. |
| [IO-4EA1C35B8D](../SPECIFICATION.md#io-4ea1c35b8d) | IO | Emergency command authorization |
| [IO-1F97CF4E82](../SPECIFICATION.md#io-1f97cf4e82) | IO | Pause-controller private participant witness |
| [REL-63B84007BB](../SPECIFICATION.md#rel-63b84007bb) | REL | relation:source-multisig:depends-on:hashing |
| [REL-DB7F631FEE](../SPECIFICATION.md#rel-db7f631fee) | REL | relation:source-multisig:depends-on:o1js |
| [REL-1FB12A6A77](../SPECIFICATION.md#rel-1fb12a6a77) | REL | relation:source-pause-controller:depends-on:logger |
| [REL-26D4DBC387](../SPECIFICATION.md#rel-26d4dbc387) | REL | relation:source-pause-controller:depends-on:multisig |
| [REL-3F2BE04199](../SPECIFICATION.md#rel-3f2be04199) | REL | relation:source-pause-controller:depends-on:o1js |
| [REL-9F3429D10A](../SPECIFICATION.md#rel-9f3429d10a) | REL | relation:source-treasury-owner:depends-on:multisig |
| [REL-08A70D7B33](../SPECIFICATION.md#rel-08a70d7b33) | REL | relation:source-treasury-owner:depends-on:pause-controller |
| [REL-50D332175F](../SPECIFICATION.md#rel-50d332175f) | REL | relation:test-multisig:tests:multisig |
| [REL-B1A7D393B9](../SPECIFICATION.md#rel-b1a7d393b9) | REL | relation:test-pause-controller:tests:multisig |
| [REL-F1C0CEA10E](../SPECIFICATION.md#rel-f1c0cea10e) | REL | relation:test-pause-controller:tests:pause-controller |
| [REL-F2F467DE44](../SPECIFICATION.md#rel-f2f467de44) | REL | relation:test-treasury-owner:tests:pause-controller |
| [REL-52D00868F0](../SPECIFICATION.md#rel-52d00868f0) | REL | relation:treasury-contracts:pause:commands:authorize |
| [REL-4237EF6012](../SPECIFICATION.md#rel-4237ef6012) | REL | relation:treasury-contracts:pause:rotation:authorizes |
| [REL-DEB2AB770C](../SPECIFICATION.md#rel-deb2ab770c) | REL | relation:treasury-contracts:pause:test-negative-partitions |
| [REL-00AEF1536B](../SPECIFICATION.md#rel-00aef1536b) | REL | Participant witness commitment binding |
| [THR-77C87EDE62](../SPECIFICATION.md#thr-77c87ede62) | THR | Repeated participant identities collapse the emergency threshold |
| [THR-0DEBF32E0A](../SPECIFICATION.md#thr-0debf32e0a) | THR | Emergency signatures replay across aligned deployments or networks |
| [ASM-E6AE27B10D](../SPECIFICATION.md#asm-e6ae27b10d) | ASM | Current multisig participant preimage is available and contains five distinct keys |
| [ASM-E0E1752AF7](../SPECIFICATION.md#asm-e0e1752af7) | ASM | Custom o1js fork preserves assumed circuit and account-update semantics |
| [ZKP-EFB3E28391](../SPECIFICATION.md#zkp-efb3e28391) | ZKP | Pause-controller participant witness binding |
