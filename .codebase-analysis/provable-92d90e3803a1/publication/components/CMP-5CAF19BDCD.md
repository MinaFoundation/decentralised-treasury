<!-- trace: CMP-5CAF19BDCD -->
<a id="cmp-5caf19bdcd"></a>
# Treasury Proposal smart contract — CMP-5CAF19BDCD

<!-- trace: CMP-5CAF19BDCD, EVD-79754810F6, AST-33AF9A2EDB, SEC-BC2C476AE2 -->
## Component summary
| Responsibility | Source paths | Static conclusion | Pass 2 |
| --- | --- | --- | --- |
| Treasury Proposal smart contract | None recorded. | The proposal consumes both proof outputs, binds them to its snapshot and action state, computes a final status, and controls destination and cumulative payout. | [Exact technical value; STE length exception] CONFIRMED. The Pass-1 components interpretation for Treasury Proposal smart contract remains consistent with raw anchors and complete context; confirmation is static and does not claim runtime, deployment, or proof-system assurance. |

<!-- trace: CMP-5CAF19BDCD, IO-52293E36B5, IO-A50C2C8E31, IO-CA2719CA24, IO-F754025CE7, IO-C49FFCF2D2, IO-69D7AB53EB, IO-36024E02E3, IO-DD1852B56B, IO-C3A08EF697, IO-D653830A9E, IO-1945E257FC, IO-82C055F932, IO-A0335A63F4, IO-140ADF5967, IO-62DAAB413D, IO-2C9ACC139E, IO-E15D49F2A2, IO-9C80690415, IO-4B9BD5AA91, IO-67C38AAD67, IO-5B7DDF71A2, IO-626345DDF5, IO-B0282188FD, IO-0467289092, IO-E9661CD282, IO-3F0DC7DE94, IO-13802BA54F, IO-EC980A7F95, IO-65764C55DD, IO-DEB6DB3865, IO-623DE360CA, IO-C22A925F5B, IO-E34414723E, IO-A27752072E, IO-9C3461F78B, IO-0E41C22124, IO-B36955C5A4, IO-0AE4C61332, IO-87B5865B4B, IO-8095F5006E, IO-5C4505832E, IO-FEAE73D285, IO-DCDD0F8C40, IO-C1EF5A7724, IO-1DBB80C4F3, IO-5A9F3E8AB4, IO-7B2F867805, IO-A0F8C1C59A, IO-51ADBABB02, IO-9F704E650F, IO-0B01C8B840, IO-C65F44E217, IO-CA717F12D5, IO-F1C491BFA4, IO-1437898F9F, IO-33EF11CDC4 -->
## Inputs and outputs
| Direction | Records |
| --- | --- |
| Inputs | [Exact technical value; STE length exception] [IO-36024E02E3](../SPECIFICATION.md#io-36024e02e3), [IO-C3A08EF697](../SPECIFICATION.md#io-c3a08ef697), [IO-D653830A9E](../SPECIFICATION.md#io-d653830a9e), [IO-1945E257FC](../SPECIFICATION.md#io-1945e257fc), [IO-82C055F932](../SPECIFICATION.md#io-82c055f932), [IO-A0335A63F4](../SPECIFICATION.md#io-a0335a63f4), [IO-140ADF5967](../SPECIFICATION.md#io-140adf5967), [IO-9C80690415](../SPECIFICATION.md#io-9c80690415), [IO-4B9BD5AA91](../SPECIFICATION.md#io-4b9bd5aa91), [IO-67C38AAD67](../SPECIFICATION.md#io-67c38aad67), [IO-5B7DDF71A2](../SPECIFICATION.md#io-5b7ddf71a2), [IO-65764C55DD](../SPECIFICATION.md#io-65764c55dd), [IO-DEB6DB3865](../SPECIFICATION.md#io-deb6db3865), [IO-623DE360CA](../SPECIFICATION.md#io-623de360ca), [IO-C22A925F5B](../SPECIFICATION.md#io-c22a925f5b), [IO-E34414723E](../SPECIFICATION.md#io-e34414723e), [IO-A27752072E](../SPECIFICATION.md#io-a27752072e), [IO-9C3461F78B](../SPECIFICATION.md#io-9c3461f78b), [IO-0E41C22124](../SPECIFICATION.md#io-0e41c22124), [IO-B36955C5A4](../SPECIFICATION.md#io-b36955c5a4), [IO-0AE4C61332](../SPECIFICATION.md#io-0ae4c61332), [IO-87B5865B4B](../SPECIFICATION.md#io-87b5865b4b), [IO-8095F5006E](../SPECIFICATION.md#io-8095f5006e), [IO-5C4505832E](../SPECIFICATION.md#io-5c4505832e), [IO-FEAE73D285](../SPECIFICATION.md#io-feae73d285), [IO-DCDD0F8C40](../SPECIFICATION.md#io-dcdd0f8c40), [IO-C1EF5A7724](../SPECIFICATION.md#io-c1ef5a7724), [IO-5A9F3E8AB4](../SPECIFICATION.md#io-5a9f3e8ab4), [IO-A0F8C1C59A](../SPECIFICATION.md#io-a0f8c1c59a), [IO-51ADBABB02](../SPECIFICATION.md#io-51adbabb02), [IO-9F704E650F](../SPECIFICATION.md#io-9f704e650f), [IO-CA717F12D5](../SPECIFICATION.md#io-ca717f12d5), [IO-F1C491BFA4](../SPECIFICATION.md#io-f1c491bfa4), [IO-1437898F9F](../SPECIFICATION.md#io-1437898f9f), [IO-33EF11CDC4](../SPECIFICATION.md#io-33ef11cdc4) |
| Outputs | [Exact technical value; STE length exception] [IO-52293E36B5](../SPECIFICATION.md#io-52293e36b5), [IO-A50C2C8E31](../SPECIFICATION.md#io-a50c2c8e31), [IO-CA2719CA24](../SPECIFICATION.md#io-ca2719ca24), [IO-F754025CE7](../SPECIFICATION.md#io-f754025ce7), [IO-C49FFCF2D2](../SPECIFICATION.md#io-c49ffcf2d2), [IO-62DAAB413D](../SPECIFICATION.md#io-62daab413d), [IO-2C9ACC139E](../SPECIFICATION.md#io-2c9acc139e), [IO-E15D49F2A2](../SPECIFICATION.md#io-e15d49f2a2), [IO-626345DDF5](../SPECIFICATION.md#io-626345ddf5), [IO-B0282188FD](../SPECIFICATION.md#io-b0282188fd), [IO-0467289092](../SPECIFICATION.md#io-0467289092), [IO-E9661CD282](../SPECIFICATION.md#io-e9661cd282), [IO-3F0DC7DE94](../SPECIFICATION.md#io-3f0dc7de94), [IO-13802BA54F](../SPECIFICATION.md#io-13802ba54f), [IO-EC980A7F95](../SPECIFICATION.md#io-ec980a7f95), [IO-1DBB80C4F3](../SPECIFICATION.md#io-1dbb80c4f3), [IO-7B2F867805](../SPECIFICATION.md#io-7b2f867805), [IO-0B01C8B840](../SPECIFICATION.md#io-0b01c8b840), [IO-C65F44E217](../SPECIFICATION.md#io-c65f44e217) |

<!-- trace: CMP-5CAF19BDCD, CL-72C688955E, CL-33D744DEBC, CL-944081AB4C, CL-7A13BAC4AA, CL-B6F99A74D4, CL-A9E8CDAD73, CL-454A642590, CL-0E9183DED0, CL-F95D8D95BE, CL-2EE46748BE, CL-D0B87D2135, CL-2311B61899, CL-F38468278D, CL-CE68CFDE0A, CL-9DDDB05A64, CL-14F284A0F4, CL-96F95D8CE6, CL-9C7B0C38F5, CL-2F056FA9A9, CL-631833DB43, INV-EF3059DB8A, INV-A2C6F00258, INV-DEFE674779 -->
## State, permissions, and errors
| Topic | Records |
| --- | --- |
| State and invariants | [INV-EF3059DB8A](../SPECIFICATION.md#inv-ef3059db8a), [INV-A2C6F00258](../SPECIFICATION.md#inv-a2c6f00258), [INV-DEFE674779](../SPECIFICATION.md#inv-defe674779) |
| Permissions | None recorded. |
| Errors and rejection paths | CL-72C688955E, CL-33D744DEBC, CL-944081AB4C, CL-7A13BAC4AA, CL-B6F99A74D4, CL-A9E8CDAD73, CL-454A642590, CL-0E9183DED0, CL-F95D8D95BE, CL-2EE46748BE, CL-D0B87D2135, CL-2311B61899, CL-F38468278D, CL-CE68CFDE0A, CL-9DDDB05A64, CL-14F284A0F4, CL-96F95D8CE6, CL-9C7B0C38F5, CL-2F056FA9A9, CL-631833DB43 |

<!-- trace: CMP-5CAF19BDCD, BHV-A302A43C9F, BHV-9E1B7D1BA1, BHV-F2207732B4, FLW-BEFDEF1197, FLW-E60ABD1745, FLW-9D28A6D299, FLW-5AA543472A, FLW-5E24C8B8E4, FLW-A6B92A4E6D, CL-72C688955E, CL-33D744DEBC, CL-944081AB4C, CL-7A13BAC4AA, CL-6989AB70EA, CL-B6F99A74D4, CL-A9E8CDAD73, CL-454A642590, CL-0E9183DED0, CL-F95D8D95BE, CL-2EE46748BE, CL-D0B87D2135, CL-5D1DBDDB89, CL-EED9250B77, CL-0C9F68A22B, CL-2311B61899, CL-0966A605CA, CL-55DB15A0CC, CL-C137D28905, CL-F38468278D, CL-CE68CFDE0A, CL-9DDDB05A64, CL-14F284A0F4, CL-96F95D8CE6, CL-9C7B0C38F5, CL-61EF5A92CB, CL-034C97475E, CL-2F056FA9A9, CL-631833DB43, INV-EF3059DB8A, INV-A2C6F00258, INV-DEFE674779, IO-52293E36B5, IO-A50C2C8E31, IO-CA2719CA24, IO-F754025CE7, IO-C49FFCF2D2, IO-69D7AB53EB, IO-36024E02E3, IO-DD1852B56B, IO-C3A08EF697, IO-D653830A9E, IO-1945E257FC, IO-82C055F932, IO-A0335A63F4, IO-140ADF5967, IO-62DAAB413D, IO-2C9ACC139E, IO-E15D49F2A2, IO-9C80690415, IO-4B9BD5AA91, IO-67C38AAD67, IO-5B7DDF71A2, IO-626345DDF5, IO-B0282188FD, IO-0467289092, IO-E9661CD282, IO-3F0DC7DE94, IO-13802BA54F, IO-EC980A7F95, IO-65764C55DD, IO-DEB6DB3865, IO-623DE360CA, IO-C22A925F5B, IO-E34414723E, IO-A27752072E, IO-9C3461F78B, IO-0E41C22124, IO-B36955C5A4, IO-0AE4C61332, IO-87B5865B4B, IO-8095F5006E, IO-5C4505832E, IO-FEAE73D285, IO-DCDD0F8C40, IO-C1EF5A7724, IO-1DBB80C4F3, IO-5A9F3E8AB4, IO-7B2F867805, IO-A0F8C1C59A, IO-51ADBABB02, IO-9F704E650F, IO-0B01C8B840, IO-C65F44E217, IO-CA717F12D5, IO-F1C491BFA4, IO-1437898F9F, IO-33EF11CDC4, REL-8D94358D1F, REL-E20DC14C1E, REL-A38D47D128, REL-568A442056, REL-589CBF628B, REL-DEA7407543, REL-C7975C3671, REL-B4EBED13D8, REL-EC7623BEA0, REL-E527B51106, REL-00EBA2ADAB, REL-A3B3E26666, REL-90D77C3467, REL-276593D308, REL-E5F8590514, REL-DD43BE2BCF, REL-B26C9DEED0, REL-9FD39CA0BF, REL-E78B1A4B91, REL-1D6D923385, REL-B6B58FC464, REL-18168F74F0, REL-091EC29FB8, REL-7EFB214FA7, REL-CD42F66A0B, REL-A2F41756C4, REL-489BD1D399, REL-D37A248DDE, REL-C23B183670, REL-5D19ED4CA6, REL-F0676059EC, REL-E8C18D1D66, REL-2B8B758DBD, REL-D5F524F3C8, REL-A7E0080416, REL-4810C50C7E, REL-B9BE0F0531, REL-9320DFA9E7, REL-8F340CD1A7, REL-CE966AA43A, REL-7C3831D8EC, REL-DA430F1EDD, REL-C5386D41BC, REL-96992E7E50, REL-D6AFDBBC16, REL-1884583AD7, REL-4D9D9DF877, REL-03AA6118C2, REL-E3A8EF7E65, REL-5DA946B3A1, REL-296CAFE207, REL-5EDF6F2962, REL-ADD56A64B3, REL-67A94DDB19, REL-70D1CDE363, REL-FA211B3844, REL-C73428091B, REL-022A0995FF, REL-9F87928AEA, REL-5BAB584F4B, REL-3CDDF609DA, REL-6AE927936D, REL-E1F0545D1D, REL-7C92E212B4, REL-346BB31D1A, REL-EC2F02C65F, REL-37CDC651DC, REL-5F2D985D2E, REL-F82E54D4F3, REL-549A32EEBD, FND-CA0F83CE86, FND-3B35F91A1C, FND-4C6DF9502F, ASM-C093AE5452, ASM-79662ECECE, ASM-E6AE27B10D, ASM-E0E1752AF7, GAP-B798CE8DB1, GAP-A25D114C6F, UNR-C23B2D9729, ZKP-547C93E79B, ZKP-BA11C90A9F -->
## Dependencies, tests, and open matters
| Topic | Records |
| --- | --- |
| Dependencies and relations | [Exact technical value; STE length exception] [REL-8D94358D1F](../SPECIFICATION.md#rel-8d94358d1f), [REL-E20DC14C1E](../SPECIFICATION.md#rel-e20dc14c1e), [REL-A38D47D128](../SPECIFICATION.md#rel-a38d47d128), [REL-568A442056](../SPECIFICATION.md#rel-568a442056), [REL-589CBF628B](../SPECIFICATION.md#rel-589cbf628b), [REL-DEA7407543](../SPECIFICATION.md#rel-dea7407543), [REL-C7975C3671](../SPECIFICATION.md#rel-c7975c3671), [REL-B4EBED13D8](../SPECIFICATION.md#rel-b4ebed13d8), [REL-EC7623BEA0](../SPECIFICATION.md#rel-ec7623bea0), [REL-E527B51106](../SPECIFICATION.md#rel-e527b51106), [REL-00EBA2ADAB](../SPECIFICATION.md#rel-00eba2adab), [REL-A3B3E26666](../SPECIFICATION.md#rel-a3b3e26666), [REL-90D77C3467](../SPECIFICATION.md#rel-90d77c3467), [REL-276593D308](../SPECIFICATION.md#rel-276593d308), [REL-E5F8590514](../SPECIFICATION.md#rel-e5f8590514), [REL-DD43BE2BCF](../SPECIFICATION.md#rel-dd43be2bcf), [REL-B26C9DEED0](../SPECIFICATION.md#rel-b26c9deed0), [REL-9FD39CA0BF](../SPECIFICATION.md#rel-9fd39ca0bf), [REL-E78B1A4B91](../SPECIFICATION.md#rel-e78b1a4b91), [REL-1D6D923385](../SPECIFICATION.md#rel-1d6d923385), [REL-B6B58FC464](../SPECIFICATION.md#rel-b6b58fc464), [REL-18168F74F0](../SPECIFICATION.md#rel-18168f74f0), [REL-091EC29FB8](../SPECIFICATION.md#rel-091ec29fb8), [REL-7EFB214FA7](../SPECIFICATION.md#rel-7efb214fa7), [REL-CD42F66A0B](../SPECIFICATION.md#rel-cd42f66a0b), [REL-A2F41756C4](../SPECIFICATION.md#rel-a2f41756c4), [REL-489BD1D399](../SPECIFICATION.md#rel-489bd1d399), [REL-D37A248DDE](../SPECIFICATION.md#rel-d37a248dde), [REL-C23B183670](../SPECIFICATION.md#rel-c23b183670), [REL-5D19ED4CA6](../SPECIFICATION.md#rel-5d19ed4ca6), [REL-F0676059EC](../SPECIFICATION.md#rel-f0676059ec), [REL-E8C18D1D66](../SPECIFICATION.md#rel-e8c18d1d66), [REL-2B8B758DBD](../SPECIFICATION.md#rel-2b8b758dbd), [REL-D5F524F3C8](../SPECIFICATION.md#rel-d5f524f3c8), [REL-A7E0080416](../SPECIFICATION.md#rel-a7e0080416), [REL-4810C50C7E](../SPECIFICATION.md#rel-4810c50c7e), [REL-B9BE0F0531](../SPECIFICATION.md#rel-b9be0f0531), [REL-9320DFA9E7](../SPECIFICATION.md#rel-9320dfa9e7), [REL-8F340CD1A7](../SPECIFICATION.md#rel-8f340cd1a7), [REL-CE966AA43A](../SPECIFICATION.md#rel-ce966aa43a), [REL-7C3831D8EC](../SPECIFICATION.md#rel-7c3831d8ec), [REL-DA430F1EDD](../SPECIFICATION.md#rel-da430f1edd), [REL-C5386D41BC](../SPECIFICATION.md#rel-c5386d41bc), [REL-96992E7E50](../SPECIFICATION.md#rel-96992e7e50), [REL-D6AFDBBC16](../SPECIFICATION.md#rel-d6afdbbc16), [REL-1884583AD7](../SPECIFICATION.md#rel-1884583ad7), [REL-4D9D9DF877](../SPECIFICATION.md#rel-4d9d9df877), [REL-03AA6118C2](../SPECIFICATION.md#rel-03aa6118c2), [REL-E3A8EF7E65](../SPECIFICATION.md#rel-e3a8ef7e65), [REL-5DA946B3A1](../SPECIFICATION.md#rel-5da946b3a1), [REL-296CAFE207](../SPECIFICATION.md#rel-296cafe207), [REL-5EDF6F2962](../SPECIFICATION.md#rel-5edf6f2962), [REL-ADD56A64B3](../SPECIFICATION.md#rel-add56a64b3), [REL-67A94DDB19](../SPECIFICATION.md#rel-67a94ddb19), [REL-70D1CDE363](../SPECIFICATION.md#rel-70d1cde363), [REL-FA211B3844](../SPECIFICATION.md#rel-fa211b3844), [REL-C73428091B](../SPECIFICATION.md#rel-c73428091b), [REL-022A0995FF](../SPECIFICATION.md#rel-022a0995ff), [REL-9F87928AEA](../SPECIFICATION.md#rel-9f87928aea), [REL-5BAB584F4B](../SPECIFICATION.md#rel-5bab584f4b), [REL-3CDDF609DA](../SPECIFICATION.md#rel-3cddf609da), [REL-6AE927936D](../SPECIFICATION.md#rel-6ae927936d), [REL-E1F0545D1D](../SPECIFICATION.md#rel-e1f0545d1d), [REL-7C92E212B4](../SPECIFICATION.md#rel-7c92e212b4), [REL-346BB31D1A](../SPECIFICATION.md#rel-346bb31d1a), [REL-EC2F02C65F](../SPECIFICATION.md#rel-ec2f02c65f), [REL-37CDC651DC](../SPECIFICATION.md#rel-37cdc651dc), [REL-5F2D985D2E](../SPECIFICATION.md#rel-5f2d985d2e), [REL-F82E54D4F3](../SPECIFICATION.md#rel-f82e54d4f3), [REL-549A32EEBD](../SPECIFICATION.md#rel-549a32eebd) |
| Tests | None recorded. |
| Findings | [FND-CA0F83CE86](../SPECIFICATION.md#fnd-ca0f83ce86), [FND-3B35F91A1C](../SPECIFICATION.md#fnd-3b35f91a1c), [FND-4C6DF9502F](../SPECIFICATION.md#fnd-4c6df9502f) |
| Gaps | [GAP-B798CE8DB1](../SPECIFICATION.md#gap-b798ce8db1), [GAP-A25D114C6F](../SPECIFICATION.md#gap-a25d114c6f) |
| Unresolved | [UNR-C23B2D9729](../SPECIFICATION.md#unr-c23b2d9729) |

<!-- trace: CMP-5CAF19BDCD, BHV-A302A43C9F, BHV-9E1B7D1BA1, BHV-F2207732B4, FLW-BEFDEF1197, FLW-E60ABD1745, FLW-9D28A6D299, FLW-5AA543472A, FLW-5E24C8B8E4, FLW-A6B92A4E6D, CL-72C688955E, CL-33D744DEBC, CL-944081AB4C, CL-7A13BAC4AA, CL-6989AB70EA, CL-B6F99A74D4, CL-A9E8CDAD73, CL-454A642590, CL-0E9183DED0, CL-F95D8D95BE, CL-2EE46748BE, CL-D0B87D2135, CL-5D1DBDDB89, CL-EED9250B77, CL-0C9F68A22B, CL-2311B61899, CL-0966A605CA, CL-55DB15A0CC, CL-C137D28905, CL-F38468278D, CL-CE68CFDE0A, CL-9DDDB05A64, CL-14F284A0F4, CL-96F95D8CE6, CL-9C7B0C38F5, CL-61EF5A92CB, CL-034C97475E, CL-2F056FA9A9, CL-631833DB43, INV-EF3059DB8A, INV-A2C6F00258, INV-DEFE674779, IO-52293E36B5, IO-A50C2C8E31, IO-CA2719CA24, IO-F754025CE7, IO-C49FFCF2D2, IO-69D7AB53EB, IO-36024E02E3, IO-DD1852B56B, IO-C3A08EF697, IO-D653830A9E, IO-1945E257FC, IO-82C055F932, IO-A0335A63F4, IO-140ADF5967, IO-62DAAB413D, IO-2C9ACC139E, IO-E15D49F2A2, IO-9C80690415, IO-4B9BD5AA91, IO-67C38AAD67, IO-5B7DDF71A2, IO-626345DDF5, IO-B0282188FD, IO-0467289092, IO-E9661CD282, IO-3F0DC7DE94, IO-13802BA54F, IO-EC980A7F95, IO-65764C55DD, IO-DEB6DB3865, IO-623DE360CA, IO-C22A925F5B, IO-E34414723E, IO-A27752072E, IO-9C3461F78B, IO-0E41C22124, IO-B36955C5A4, IO-0AE4C61332, IO-87B5865B4B, IO-8095F5006E, IO-5C4505832E, IO-FEAE73D285, IO-DCDD0F8C40, IO-C1EF5A7724, IO-1DBB80C4F3, IO-5A9F3E8AB4, IO-7B2F867805, IO-A0F8C1C59A, IO-51ADBABB02, IO-9F704E650F, IO-0B01C8B840, IO-C65F44E217, IO-CA717F12D5, IO-F1C491BFA4, IO-1437898F9F, IO-33EF11CDC4, REL-8D94358D1F, REL-E20DC14C1E, REL-A38D47D128, REL-568A442056, REL-589CBF628B, REL-DEA7407543, REL-C7975C3671, REL-B4EBED13D8, REL-EC7623BEA0, REL-E527B51106, REL-00EBA2ADAB, REL-A3B3E26666, REL-90D77C3467, REL-276593D308, REL-E5F8590514, REL-DD43BE2BCF, REL-B26C9DEED0, REL-9FD39CA0BF, REL-E78B1A4B91, REL-1D6D923385, REL-B6B58FC464, REL-18168F74F0, REL-091EC29FB8, REL-7EFB214FA7, REL-CD42F66A0B, REL-A2F41756C4, REL-489BD1D399, REL-D37A248DDE, REL-C23B183670, REL-5D19ED4CA6, REL-F0676059EC, REL-E8C18D1D66, REL-2B8B758DBD, REL-D5F524F3C8, REL-A7E0080416, REL-4810C50C7E, REL-B9BE0F0531, REL-9320DFA9E7, REL-8F340CD1A7, REL-CE966AA43A, REL-7C3831D8EC, REL-DA430F1EDD, REL-C5386D41BC, REL-96992E7E50, REL-D6AFDBBC16, REL-1884583AD7, REL-4D9D9DF877, REL-03AA6118C2, REL-E3A8EF7E65, REL-5DA946B3A1, REL-296CAFE207, REL-5EDF6F2962, REL-ADD56A64B3, REL-67A94DDB19, REL-70D1CDE363, REL-FA211B3844, REL-C73428091B, REL-022A0995FF, REL-9F87928AEA, REL-5BAB584F4B, REL-3CDDF609DA, REL-6AE927936D, REL-E1F0545D1D, REL-7C92E212B4, REL-346BB31D1A, REL-EC2F02C65F, REL-37CDC651DC, REL-5F2D985D2E, REL-F82E54D4F3, REL-549A32EEBD, FND-CA0F83CE86, FND-3B35F91A1C, FND-4C6DF9502F, ASM-C093AE5452, ASM-79662ECECE, ASM-E6AE27B10D, ASM-E0E1752AF7, GAP-B798CE8DB1, GAP-A25D114C6F, UNR-C23B2D9729, ZKP-547C93E79B, ZKP-BA11C90A9F -->
## Related semantic records
| ID | Type | Topic |
| --- | --- | --- |
| [BHV-A302A43C9F](../SPECIFICATION.md#bhv-a302a43c9f) | BHV | Calculate participation and vote result |
| [BHV-9E1B7D1BA1](../SPECIFICATION.md#bhv-9e1b7d1ba1) | BHV | Expose lifecycle and dispatch vote action |
| [BHV-F2207732B4](../SPECIFICATION.md#bhv-f2207732b4) | BHV | Enforce approved recipient payout cap |
| [FLW-BEFDEF1197](../SPECIFICATION.md#flw-befdef1197) | FLW | Proposal-local payout |
| [FLW-E60ABD1745](../SPECIFICATION.md#flw-e60abd1745) | FLW | Proposal-local tally |
| [FLW-9D28A6D299](../SPECIFICATION.md#flw-9d28a6d299) | FLW | Approved partial payout |
| [FLW-5AA543472A](../SPECIFICATION.md#flw-5aa543472a) | FLW | Proposal-specific pause toggle |
| [FLW-5E24C8B8E4](../SPECIFICATION.md#flw-5e24c8b8e4) | FLW | Proof-backed tally finalization |
| [FLW-A6B92A4E6D](../SPECIFICATION.md#flw-a6b92a4e6d) | FLW | Vote authorization and action dispatch |
| [CL-72C688955E](../SPECIFICATION.md#cl-72c688955e) | CL | clause:treasury-contracts:owner:vote-enum |
| [CL-33D744DEBC](../SPECIFICATION.md#cl-33d744debc) | CL | clause:treasury-contracts:proposal:pause-transition |
| [CL-944081AB4C](../SPECIFICATION.md#cl-944081ab4c) | CL | clause:treasury-contracts:proposal:payout-cap |
| [CL-7A13BAC4AA](../SPECIFICATION.md#cl-7a13bac4aa) | CL | clause:treasury-contracts:proposal:payout-status |
| [CL-6989AB70EA](../SPECIFICATION.md#cl-6989ab70ea) | CL | clause:treasury-contracts:proposal:ratio-cap |
| [CL-B6F99A74D4](../SPECIFICATION.md#cl-b6f99a74d4) | CL | clause:treasury-contracts:proposal:recipient-binding |
| [CL-A9E8CDAD73](../SPECIFICATION.md#cl-a9e8cdad73) | CL | clause:treasury-contracts:proposal:tally-participation |
| [CL-454A642590](../SPECIFICATION.md#cl-454a642590) | CL | clause:treasury-contracts:proposal:tally-proof-bindings |
| [CL-0E9183DED0](../SPECIFICATION.md#cl-0e9183ded0) | CL | clause:treasury-contracts:proposal:tally-status-unknown |
| [CL-F95D8D95BE](../SPECIFICATION.md#cl-f95d8d95be) | CL | clause:treasury-contracts:proposal:zero-directional-votes |
| [CL-2EE46748BE](../SPECIFICATION.md#cl-2ee46748be) | CL | clause:zk-programs:proof-consumer:staking-genesis-bindings |
| [CL-D0B87D2135](../SPECIFICATION.md#cl-d0b87d2135) | CL | clause:zk-programs:proof-consumer:vote-genesis-and-action-bindings |
| [CL-5D1DBDDB89](../SPECIFICATION.md#cl-5d1dbddb89) | CL | clause:zk-programs:vote-reducer:action-hash-selection |
| [CL-EED9250B77](../SPECIFICATION.md#cl-eed9250b77) | CL | clause:zk-programs:vote-reducer:batch-loop-bound |
| [CL-0C9F68A22B](../SPECIFICATION.md#cl-0c9f68a22b) | CL | clause:zk-programs:vote-reducer:dummy-conjunction |
| [CL-2311B61899](../SPECIFICATION.md#cl-2311b61899) | CL | clause:zk-programs:vote-reducer:enum-membership |
| [CL-0966A605CA](../SPECIFICATION.md#cl-0966a605ca) | CL | clause:zk-programs:vote-reducer:found-monotonic |
| [CL-55DB15A0CC](../SPECIFICATION.md#cl-55db15a0cc) | CL | clause:zk-programs:vote-reducer:host-nullifier-record-write |
| [CL-C137D28905](../SPECIFICATION.md#cl-c137d28905) | CL | clause:zk-programs:vote-reducer:host-nullifier-tree-write |
| [CL-F38468278D](../SPECIFICATION.md#cl-f38468278d) | CL | clause:zk-programs:vote-reducer:json-catch-default |
| [CL-CE68CFDE0A](../SPECIFICATION.md#cl-ce68cfde0a) | CL | clause:zk-programs:vote-reducer:merge-history |
| [CL-9DDDB05A64](../SPECIFICATION.md#cl-9dddb05a64) | CL | clause:zk-programs:vote-reducer:merge-input-hash-equality |
| [CL-14F284A0F4](../SPECIFICATION.md#cl-14f284a0f4) | CL | clause:zk-programs:vote-reducer:merge-proof-verification |
| [CL-96F95D8CE6](../SPECIFICATION.md#cl-96f95d8ce6) | CL | clause:zk-programs:vote-reducer:merge-root-continuity |
| [CL-9C7B0C38F5](../SPECIFICATION.md#cl-9c7b0c38f5) | CL | clause:zk-programs:vote-reducer:nullifier-membership |
| [CL-61EF5A92CB](../SPECIFICATION.md#cl-61ef5a92cb) | CL | clause:zk-programs:vote-reducer:nullifier-transition |
| [CL-034C97475E](../SPECIFICATION.md#cl-034c97475e) | CL | clause:zk-programs:vote-reducer:tally-selectors |
| [CL-2F056FA9A9](../SPECIFICATION.md#cl-2f056fa9a9) | CL | clause:zk-programs:vote-reducer:voting-membership |
| [CL-631833DB43](../SPECIFICATION.md#cl-631833db43) | CL | clause:zk-programs:vote-reducer:weight-selection |
| [INV-EF3059DB8A](../SPECIFICATION.md#inv-ef3059db8a) | INV | Cumulative recipient credit cannot exceed amount + floor(amount/10), and every credit goes to the committed recipient. |
| [INV-A2C6F00258](../SPECIFICATION.md#inv-a2c6f00258) | INV | A proposal tally uses the staking root and total currency captured at proposal creation. |
| [INV-DEFE674779](../SPECIFICATION.md#inv-defe674779) | INV | Emergency pause should not erase APPROVED or REJECTED unless governance reset is explicit intent. |
| [IO-52293E36B5](../SPECIFICATION.md#io-52293e36b5) | IO | proposalCreated event |
| [IO-A50C2C8E31](../SPECIFICATION.md#io-a50c2c8e31) | IO | proposalExecuted event |
| [IO-CA2719CA24](../SPECIFICATION.md#io-ca2719ca24) | IO | proposalPauseToggled event |
| [IO-F754025CE7](../SPECIFICATION.md#io-f754025ce7) | IO | proposalVotesTallied event |
| [IO-C49FFCF2D2](../SPECIFICATION.md#io-c49ffcf2d2) | IO | proposalVoteDispatched event |
| [IO-69D7AB53EB](../SPECIFICATION.md#io-69d7ab53eb) | IO | Payout request and effects |
| [IO-36024E02E3](../SPECIFICATION.md#io-36024e02e3) | IO | Tally proof package |
| [IO-DD1852B56B](../SPECIFICATION.md#io-dd1852b56b) | IO | host nullifier value/witness and persistence writes |
| [IO-C3A08EF697](../SPECIFICATION.md#io-c3a08ef697) | IO | host voting account and PrefixedMerkleWitness255 |
| [IO-D653830A9E](../SPECIFICATION.md#io-d653830a9e) | IO | voteActions[0..4].vote/publicKey |
| [IO-1945E257FC](../SPECIFICATION.md#io-1945e257fc) | IO | actionStateHistoryTarget[1..5] |
| [IO-82C055F932](../SPECIFICATION.md#io-82c055f932) | IO | fromActionsHash |
| [IO-A0335A63F4](../SPECIFICATION.md#io-a0335a63f4) | IO | fromNullifierRoot |
| [IO-140ADF5967](../SPECIFICATION.md#io-140adf5967) | IO | votingLedgerRoot |
| [IO-62DAAB413D](../SPECIFICATION.md#io-62daab413d) | IO | actionStateHistory[1..5].hash/found |
| [IO-2C9ACC139E](../SPECIFICATION.md#io-2c9acc139e) | IO | yay/nay/abstain |
| [IO-E15D49F2A2](../SPECIFICATION.md#io-e15d49f2a2) | IO | toActionsHash/toNullifierRoot |
| [IO-9C80690415](../SPECIFICATION.md#io-9c80690415) | IO | VoteReducer.merge proof1 |
| [IO-4B9BD5AA91](../SPECIFICATION.md#io-4b9bd5aa91) | IO | VoteReducer.merge proof2 |
| [IO-67C38AAD67](../SPECIFICATION.md#io-67c38aad67) | IO | VoteReducer.merge mergedPublicOutput |
| [IO-5B7DDF71A2](../SPECIFICATION.md#io-5b7ddf71a2) | IO | VoteReducer.merge outerPublicInput |
| [IO-626345DDF5](../SPECIFICATION.md#io-626345ddf5) | IO | VoteReducer.reduceBatch abstain |
| [IO-B0282188FD](../SPECIFICATION.md#io-b0282188fd) | IO | VoteReducer.reduceBatch actionStateHistory[5].found |
| [IO-0467289092](../SPECIFICATION.md#io-0467289092) | IO | VoteReducer.reduceBatch actionStateHistory[5].hash |
| [IO-E9661CD282](../SPECIFICATION.md#io-e9661cd282) | IO | VoteReducer.reduceBatch nay |
| [IO-3F0DC7DE94](../SPECIFICATION.md#io-3f0dc7de94) | IO | VoteReducer.reduceBatch toActionsHash |
| [IO-13802BA54F](../SPECIFICATION.md#io-13802ba54f) | IO | VoteReducer.reduceBatch toNullifierRoot |
| [IO-EC980A7F95](../SPECIFICATION.md#io-ec980a7f95) | IO | VoteReducer.reduceBatch yay |
| [IO-65764C55DD](../SPECIFICATION.md#io-65764c55dd) | IO | VoteReducer.reduceBatch nullifierWitness[iteration] |
| [IO-DEB6DB3865](../SPECIFICATION.md#io-deb6db3865) | IO | VoteReducer.reduceBatch priorNullifier[iteration] |
| [IO-623DE360CA](../SPECIFICATION.md#io-623de360ca) | IO | VoteReducer.reduceBatch voteActions[5].publicKey |
| [IO-C22A925F5B](../SPECIFICATION.md#io-c22a925f5b) | IO | VoteReducer.reduceBatch voteActions[5].vote |
| [IO-E34414723E](../SPECIFICATION.md#io-e34414723e) | IO | VoteReducer.reduceBatch votingAccount[iteration].balance |
| [IO-A27752072E](../SPECIFICATION.md#io-a27752072e) | IO | VoteReducer.reduceBatch votingWitness[iteration] |
| [IO-9C3461F78B](../SPECIFICATION.md#io-9c3461f78b) | IO | VoteReducer.reduceBatch actionStateFive |
| [IO-0E41C22124](../SPECIFICATION.md#io-0e41c22124) | IO | VoteReducer.reduceBatch actionStateFour |
| [IO-B36955C5A4](../SPECIFICATION.md#io-b36955c5a4) | IO | VoteReducer.reduceBatch actionStateOne |
| [IO-0AE4C61332](../SPECIFICATION.md#io-0ae4c61332) | IO | VoteReducer.reduceBatch actionStateThree |
| [IO-87B5865B4B](../SPECIFICATION.md#io-87b5865b4b) | IO | VoteReducer.reduceBatch actionStateTwo |
| [IO-8095F5006E](../SPECIFICATION.md#io-8095f5006e) | IO | VoteReducer.reduceBatch fromActionsHash |
| [IO-5C4505832E](../SPECIFICATION.md#io-5c4505832e) | IO | VoteReducer.reduceBatch fromNullifierRoot |
| [IO-FEAE73D285](../SPECIFICATION.md#io-feae73d285) | IO | VoteReducer.reduceBatch votingLedgerRoot |
| [IO-DCDD0F8C40](../SPECIFICATION.md#io-dcdd0f8c40) | IO | vote.reduce.fromActionsHash |
| [IO-C1EF5A7724](../SPECIFICATION.md#io-c1ef5a7724) | IO | vote.reduce.fromNullifierRoot |
| [IO-1DBB80C4F3](../SPECIFICATION.md#io-1dbb80c4f3) | IO | vote.reduce.actionStateHistory[1..5] |
| [IO-5A9F3E8AB4](../SPECIFICATION.md#io-5a9f3e8ab4) | IO | vote.reduce.actionStateHistoryTarget[1..5] |
| [IO-7B2F867805](../SPECIFICATION.md#io-7b2f867805) | IO | vote.reduce.hostNullifierPersistence |
| [IO-A0F8C1C59A](../SPECIFICATION.md#io-a0f8c1c59a) | IO | vote.reduce.nullifierMerkleWitness255 |
| [IO-51ADBABB02](../SPECIFICATION.md#io-51adbabb02) | IO | vote.reduce.witnessedVoteNullifier |
| [IO-9F704E650F](../SPECIFICATION.md#io-9f704e650f) | IO | vote.merge.proof1/proof2 |
| [IO-0B01C8B840](../SPECIFICATION.md#io-0b01c8b840) | IO | vote.reduce.yay/nay/abstain |
| [IO-C65F44E217](../SPECIFICATION.md#io-c65f44e217) | IO | vote.reduce.toActionsHash/toNullifierRoot |
| [IO-CA717F12D5](../SPECIFICATION.md#io-ca717f12d5) | IO | vote.reduce.voteActions[0..4] |
| [IO-F1C491BFA4](../SPECIFICATION.md#io-f1c491bfa4) | IO | vote.reduce.witnessedVotingAccount |
| [IO-1437898F9F](../SPECIFICATION.md#io-1437898f9f) | IO | vote.reduce.votingMerkleWitness255 |
| [IO-33EF11CDC4](../SPECIFICATION.md#io-33ef11cdc4) | IO | vote.reduce.votingLedgerRoot |
| [REL-8D94358D1F](../SPECIFICATION.md#rel-8d94358d1f) | REL | relation:proposal:binds:proof-ledger-roots |
| [REL-E20DC14C1E](../SPECIFICATION.md#rel-e20dc14c1e) | REL | relation:proposal:verifies:staking-transform-proof |
| [REL-A38D47D128](../SPECIFICATION.md#rel-a38d47d128) | REL | relation:proposal:verifies:vote-reducer-proof |
| [REL-568A442056](../SPECIFICATION.md#rel-568a442056) | REL | relation:source-events:depends-on:o1js |
| [REL-589CBF628B](../SPECIFICATION.md#rel-589cbf628b) | REL | relation:source-events:depends-on:vote-reducer |
| [REL-DEA7407543](../SPECIFICATION.md#rel-dea7407543) | REL | relation:source-proposal:depends-on:account |
| [REL-C7975C3671](../SPECIFICATION.md#rel-c7975c3671) | REL | relation:source-proposal:depends-on:constants |
| [REL-B4EBED13D8](../SPECIFICATION.md#rel-b4ebed13d8) | REL | relation:source-proposal:depends-on:hashing |
| [REL-EC7623BEA0](../SPECIFICATION.md#rel-ec7623bea0) | REL | relation:source-proposal:depends-on:logger |
| [REL-E527B51106](../SPECIFICATION.md#rel-e527b51106) | REL | relation:source-proposal:depends-on:o1js |
| [REL-00EBA2ADAB](../SPECIFICATION.md#rel-00eba2adab) | REL | relation:source-proposal:depends-on:prefixed-merkle |
| [REL-A3B3E26666](../SPECIFICATION.md#rel-a3b3e26666) | REL | relation:source-proposal:depends-on:staking-ledger |
| [REL-90D77C3467](../SPECIFICATION.md#rel-90d77c3467) | REL | relation:source-proposal:depends-on:staking-to-voting |
| [REL-276593D308](../SPECIFICATION.md#rel-276593d308) | REL | relation:source-proposal:depends-on:vote-reducer |
| [REL-E5F8590514](../SPECIFICATION.md#rel-e5f8590514) | REL | relation:source-treasury-owner:depends-on:events |
| [REL-DD43BE2BCF](../SPECIFICATION.md#rel-dd43be2bcf) | REL | relation:source-treasury-owner:depends-on:proposal |
| [REL-B26C9DEED0](../SPECIFICATION.md#rel-b26c9deed0) | REL | relation:source-treasury-owner:depends-on:vote-reducer |
| [REL-9FD39CA0BF](../SPECIFICATION.md#rel-9fd39ca0bf) | REL | relation:source-vote-reducer:depends-on:context-provider |
| [REL-E78B1A4B91](../SPECIFICATION.md#rel-e78b1a4b91) | REL | relation:source-vote-reducer:depends-on:hashing |
| [REL-1D6D923385](../SPECIFICATION.md#rel-1d6d923385) | REL | relation:source-vote-reducer:depends-on:logger |
| [REL-B6B58FC464](../SPECIFICATION.md#rel-b6b58fc464) | REL | relation:source-vote-reducer:depends-on:nullifier-ledger |
| [REL-18168F74F0](../SPECIFICATION.md#rel-18168f74f0) | REL | relation:source-vote-reducer:depends-on:o1js |
| [REL-091EC29FB8](../SPECIFICATION.md#rel-091ec29fb8) | REL | relation:source-vote-reducer:depends-on:prefixed-merkle |
| [REL-7EFB214FA7](../SPECIFICATION.md#rel-7efb214fa7) | REL | relation:source-vote-reducer:depends-on:voting-account |
| [REL-CD42F66A0B](../SPECIFICATION.md#rel-cd42f66a0b) | REL | relation:source-vote-reducer:depends-on:voting-ledger |
| [REL-A2F41756C4](../SPECIFICATION.md#rel-a2f41756c4) | REL | relation:test-events:tests:events |
| [REL-489BD1D399](../SPECIFICATION.md#rel-489bd1d399) | REL | relation:test-proposal:tests:proposal |
| [REL-D37A248DDE](../SPECIFICATION.md#rel-d37a248dde) | REL | relation:test-treasury-owner:tests:proposal |
| [REL-C23B183670](../SPECIFICATION.md#rel-c23b183670) | REL | relation:test-vote-reducer:tests:hashing |
| [REL-5D19ED4CA6](../SPECIFICATION.md#rel-5d19ed4ca6) | REL | relation:test-vote-reducer:tests:vote-reducer |
| [REL-F0676059EC](../SPECIFICATION.md#rel-f0676059ec) | REL | relation:test-vote-reducer:tests:voting-account |
| [REL-E8C18D1D66](../SPECIFICATION.md#rel-e8c18d1d66) | REL | relation:treasury-contracts:events:test-roundtrip |
| [REL-2B8B758DBD](../SPECIFICATION.md#rel-2b8b758dbd) | REL | relation:treasury-contracts:owner:create:writes-proposal-state |
| [REL-D5F524F3C8](../SPECIFICATION.md#rel-d5f524f3c8) | REL | relation:treasury-contracts:proposal:execute:writes-recipient |
| [REL-A7E0080416](../SPECIFICATION.md#rel-a7e0080416) | REL | relation:treasury-contracts:proposal:tally:depends-staking-transform |
| [REL-4810C50C7E](../SPECIFICATION.md#rel-4810c50c7e) | REL | relation:treasury-contracts:proposal:tally:depends-vote-reducer |
| [REL-B9BE0F0531](../SPECIFICATION.md#rel-b9be0f0531) | REL | relation:vote-reducer:bound-by-constraint:nullifier-root |
| [REL-9320DFA9E7](../SPECIFICATION.md#rel-9320dfa9e7) | REL | relation:vote-reducer:bound-by-constraint:voting-root |
| [REL-8F340CD1A7](../SPECIFICATION.md#rel-8f340cd1a7) | REL | relation:vote-reducer:host-write:not-proved |
| [REL-CE966AA43A](../SPECIFICATION.md#rel-ce966aa43a) | REL | votereducer_merge_private_proof1 constraint binding |
| [REL-7C3831D8EC](../SPECIFICATION.md#rel-7c3831d8ec) | REL | votereducer_merge_private_proof2 constraint binding |
| [REL-DA430F1EDD](../SPECIFICATION.md#rel-da430f1edd) | REL | votereducer_merge_public_mergedpublicoutput constraint binding |
| [REL-C5386D41BC](../SPECIFICATION.md#rel-c5386d41bc) | REL | votereducer_merge_public_outerpublicinput constraint binding |
| [REL-96992E7E50](../SPECIFICATION.md#rel-96992e7e50) | REL | votereducer_reducebatch_output_abstain constraint binding |
| [REL-D6AFDBBC16](../SPECIFICATION.md#rel-d6afdbbc16) | REL | votereducer_reducebatch_output_actionstatehistory-5-found constraint binding |
| [REL-1884583AD7](../SPECIFICATION.md#rel-1884583ad7) | REL | votereducer_reducebatch_output_actionstatehistory-5-hash constraint binding |
| [REL-4D9D9DF877](../SPECIFICATION.md#rel-4d9d9df877) | REL | votereducer_reducebatch_output_nay constraint binding |
| [REL-03AA6118C2](../SPECIFICATION.md#rel-03aa6118c2) | REL | votereducer_reducebatch_output_toactionshash constraint binding |
| [REL-E3A8EF7E65](../SPECIFICATION.md#rel-e3a8ef7e65) | REL | votereducer_reducebatch_output_tonullifierroot constraint binding |
| [REL-5DA946B3A1](../SPECIFICATION.md#rel-5da946b3a1) | REL | votereducer_reducebatch_output_yay constraint binding |
| [REL-296CAFE207](../SPECIFICATION.md#rel-296cafe207) | REL | votereducer_reducebatch_private_nullifierwitness-iteration constraint binding |
| [REL-5EDF6F2962](../SPECIFICATION.md#rel-5edf6f2962) | REL | votereducer_reducebatch_private_priornullifier-iteration constraint binding |
| [REL-ADD56A64B3](../SPECIFICATION.md#rel-add56a64b3) | REL | votereducer_reducebatch_private_voteactions-5-publickey constraint binding |
| [REL-67A94DDB19](../SPECIFICATION.md#rel-67a94ddb19) | REL | votereducer_reducebatch_private_voteactions-5-vote constraint binding |
| [REL-70D1CDE363](../SPECIFICATION.md#rel-70d1cde363) | REL | votereducer_reducebatch_private_votingaccount-iteration-balance constraint binding |
| [REL-FA211B3844](../SPECIFICATION.md#rel-fa211b3844) | REL | votereducer_reducebatch_private_votingwitness-iteration constraint binding |
| [REL-C73428091B](../SPECIFICATION.md#rel-c73428091b) | REL | votereducer_reducebatch_public_actionstatefive constraint binding |
| [REL-022A0995FF](../SPECIFICATION.md#rel-022a0995ff) | REL | votereducer_reducebatch_public_actionstatefour constraint binding |
| [REL-9F87928AEA](../SPECIFICATION.md#rel-9f87928aea) | REL | votereducer_reducebatch_public_actionstateone constraint binding |
| [REL-5BAB584F4B](../SPECIFICATION.md#rel-5bab584f4b) | REL | votereducer_reducebatch_public_actionstatethree constraint binding |
| [REL-3CDDF609DA](../SPECIFICATION.md#rel-3cddf609da) | REL | votereducer_reducebatch_public_actionstatetwo constraint binding |
| [REL-6AE927936D](../SPECIFICATION.md#rel-6ae927936d) | REL | votereducer_reducebatch_public_fromactionshash constraint binding |
| [REL-E1F0545D1D](../SPECIFICATION.md#rel-e1f0545d1d) | REL | votereducer_reducebatch_public_fromnullifierroot constraint binding |
| [REL-7C92E212B4](../SPECIFICATION.md#rel-7c92e212b4) | REL | votereducer_reducebatch_public_votingledgerroot constraint binding |
| [REL-346BB31D1A](../SPECIFICATION.md#rel-346bb31d1a) | REL | relation:zk-programs:proof-consumer:staking-root-to-vote-root |
| [REL-EC2F02C65F](../SPECIFICATION.md#rel-ec2f02c65f) | REL | relation:zk-programs:vote-reducer:host-write-may-flow |
| [REL-37CDC651DC](../SPECIFICATION.md#rel-37cdc651dc) | REL | relation:zk-programs:vote-reducer:nullifier-path-bound-to-root |
| [REL-5F2D985D2E](../SPECIFICATION.md#rel-5f2d985d2e) | REL | relation:zk-programs:vote-reducer:nullifier-read-bound-to-root |
| [REL-F82E54D4F3](../SPECIFICATION.md#rel-f82e54d4f3) | REL | relation:zk-programs:vote-reducer:voting-path-bound-to-root |
| [REL-549A32EEBD](../SPECIFICATION.md#rel-549a32eebd) | REL | relation:zk-programs:vote-reducer:voting-read-bound-to-root |
| [FND-CA0F83CE86](../SPECIFICATION.md#fnd-ca0f83ce86) | FND | Staking proof exhaustion is not a terminal recursive state |
| [FND-3B35F91A1C](../SPECIFICATION.md#fnd-3b35f91a1c) | FND | Prior audit: proposal status uses raw Field(0) |
| [FND-4C6DF9502F](../SPECIFICATION.md#fnd-4c6df9502f) | FND | Voting-weight transformation has no account token/class eligibility predicate |
| [ASM-C093AE5452](../SPECIFICATION.md#asm-c093ae5452) | ASM | Owner deployment statics are initialized correctly |
| [ASM-79662ECECE](../SPECIFICATION.md#asm-79662ecece) | ASM | Global proof contexts are set, isolated, and revision-consistent |
| [ASM-E6AE27B10D](../SPECIFICATION.md#asm-e6ae27b10d) | ASM | Current multisig participant preimage is available and contains five distinct keys |
| [ASM-E0E1752AF7](../SPECIFICATION.md#asm-e0e1752af7) | ASM | Custom o1js fork preserves assumed circuit and account-update semantics |
| [GAP-B798CE8DB1](../SPECIFICATION.md#gap-b798ce8db1) | GAP | Approved proposal claims lack expiry and an explicit completion state |
| [GAP-A25D114C6F](../SPECIFICATION.md#gap-a25d114c6f) | GAP | Static batch sizes expose a potentially material proof backlog without an established lifecycle capacity budget |
| [UNR-C23B2D9729](../SPECIFICATION.md#unr-c23b2d9729) | UNR | [Exact technical value; STE length exception] All account balances, voting leaves, and the three vote tallies are UInt64. Source-visible additions are checked typed arithmetic, so overflow is an overconstraint/liveness boundary rather than silent wraparound; however the bounded scope supplies no authoritative bound proving every delegate aggregate and every choice aggregate fits UInt64 after the implemented all-account eligibility rule. |
| [ZKP-547C93E79B](../SPECIFICATION.md#zkp-547c93e79b) | ZKP | VoteReducer.merge statement |
| [ZKP-BA11C90A9F](../SPECIFICATION.md#zkp-ba11c90a9f) | ZKP | VoteReducer.reduceBatch statement |
