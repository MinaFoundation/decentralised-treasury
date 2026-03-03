## Scripts

`lightnet start` - Start a local Mina Lightnet network

## Miscelaneous

### Export the staking ledger (lightnet)

1. Run bash in the lightnet docker container

   ```
   docker exec -it $(docker ps -qf "name=mina-local-lightnet") /bin/bash
   ```

2. Export the staking ledger as JSON

   ```zsh
   mina ledger export staking-epoch-ledger --daemon-port 3100 > staking-epoch-ledger.json
   ```

3. Copy the ledger from the docker container
   ```zsh
   docker cp mina-local-lightnet:/root/staking-epoch-ledger.json ./staking-epoch-ledger.json
   ```

### Get lightnet private key(s)

#### deamon.json account breakdown

> Use the `dump-keypair` command from bellow to get private keys for the following accounts

| Name                    | Balance            | Public Key                                              | Private Key                                          |
| ----------------------- | ------------------ | ------------------------------------------------------- | ---------------------------------------------------- |
| snark coordinator       | 65500.000000000    | B62qr81JquSrKixS4x48fzCWmDHueZgqYmdyKp4kHsKnoXuzc8qcE9g | -                                                    |
| offline_fish_account_0  | 65500.000000000    | B62qpHQkVbe9dwvkS5799Quhi35rNCVzunj4Vn4xvyVKpn4N3rX5tri | -                                                    |
| online_fish_account_0   | 500.000000000      | B62qrEhYL7zPNxZ3Srnrw9KoXwJKvt5TF13z5tqofZiqKqp4osbzYXF | -                                                    |
| offline_whale_account_1 | 11550000.000000000 | B62qnMgZkY7pmyKb8a6rDzsyaNepkrUjrRSnkgaUVizLocD3nyzq6xx | -                                                    |
| online_whale_account_1  | 0.000000000        | B62qkU7JVGqvYgsYyEJKo7dKjoMtaPxVHmCh9Q5N135MD1a4mQYgQUG | EKERqTxjB7N9x2FzrQyaEJf8XAgm6ShsW4viGdgt6KDjFSfdeHAE |
| offline_whale_account_0 | 11550000.000000000 | B62qmhjWGhqLzA8aei9DTitL7S2kYNPtN7LWXBK9hsGk8o8F9zMXw6t | -                                                    |
| online_whale_account_0  | 1100.000000000     | B62qikT41XWwfMuoRC1SBvQxBfvHPnYfY7Hm9TUWNQXMLka5eP4xowB | EKFGQcsWmQR9Jj1W2XoGNQzF43T1PNqRhaQrm1vDS948GVbyemrj |
| additional accounts     | ...                | ...                                                     | ...                                                  |

> online_whale_account_0 and online_whale_account_1 hold combined voting power of 23101100000000000 nanoMINA out of total currency of 24782600000000000 nanoMINA, which constitutes ~93% of the voting power

#### Dump the entire daemon configuration

```zsh
docker cp mina-local-lightnet:/root/.mina-network/mina-local-network-2-1-1/daemon.json ./daemon.json
```

#### Dump existing keypairs

Do the following from within the lightnet docker container. Password is: `naughty blue worm`.

```zsh
mina advanced dump-keypair \
   --privkey-path ~/.mina-network/mina-local-network-2-1-1/offline_whale_keys/offline_whale_account_1
```

### Available commands

#### Convert staking ledger to voting ledger

```zsh
// TODO: see commands/staking-ledger-to-voting-ledger.ts
```

#### Generate keypairs for testing

```zsh
pnpm run cli generate-keypairs 4
```

#### Acquire a keypair from lightnet

```zsh
pnpm run cli lightnet-acquire-key-pair --lightnet-account-manager-endpoint=http://127.0.0.1:8181 --mina-node-url=http://127.0.0.1:8080/graphql
```

#### Transform staking ledger to voting ledgeer

```zsh
pnpm run cli staking-ledger-to-voting-ledger test/provable/staking-epoch-ledger.json .data/voting-ledger.json .data/digest-proof.json
```

#### Deploy the treasury owner contract

> Mainnet lifecycle period duration is 7140 slots, to match the epoch length
> Lightnet lifecycle period duration can be set to 720 to match the lightnet epoch length
> For additional testing, the lifecycle period duration can be configured to a custom number

```zsh
pnpm run cli deploy-treasury-owner \
  --treasury-owner-private-key=EKEZJDMXFKHPoyM5iTs8XVvLG9V7QaVk1JjZCdRtsvC3dbWx3p5R \
  --treasury-deployed-at-slot=0 \
  --multisig-participants-public-keys=B62qjTUDxfYAKoPkBrSWPfFChffK8dPREoKFk3ELBqJBxe6AqfGZH8A,B62qj5RNepExR8qw9mDriTnJPj4BGvnCYVHDj3kroaipiq9v1jLkUt3,B62qjsu47JP6Jd2komcdvXjw4RjKkYB8LVAhyZ8RyVZw9453Civi8R4 \
  --mina-node-url=http://127.0.0.1:8080/graphql \
  --sender-private-key=EKDpoov2DNs2aBLmm2yZNwLKHDvG42EdwPGaeCTrhm1kaFHc5f1g \
  --lifecycle-period-duration=720 \
  --permission-type=signature
```

#### Transfer $MINA

```zsh
pnpm run cli transfer \
  --sender-private-key=EKDpoov2DNs2aBLmm2yZNwLKHDvG42EdwPGaeCTrhm1kaFHc5f1g \
  --recipient-public-key=B62qrAk8soJccFVHw9spCn368Xfxoe3v1QmF6X16KupBh9S787HtDxw \
  --amount=1000000000000 \
  --mina-node-url=http://127.0.0.1:8080/graphql
```

#### Create proposal

```zsh
pnpm run cli create-proposal \
  --amount=100000000000 \
  --proposal-content-host-type=github \
  --proposal-content-identifier="https://gist.githubusercontent.com/maht0rz/a61f258584415f74f2520877c74e0c79/raw/13795618f6949ff8c54f6d43cd6d31f6847c0712/my_proposal.md" \
  --recipient-public-key=B62qjTUDxfYAKoPkBrSWPfFChffK8dPREoKFk3ELBqJBxe6AqfGZH8A \
  --proposal-lifecycle-id=0 \
  --treasury-owner-private-key=EKEZJDMXFKHPoyM5iTs8XVvLG9V7QaVk1JjZCdRtsvC3dbWx3p5R \
  --proposal-private-key=EKFVjQLhdW6GtBtbfKBcbVXpSYoLHnzM1q2Fk67knjtnBeydtWRY \
  --mina-node-url=http://127.0.0.1:8080/graphql \
  --treasury-owner-public-key=B62qrAk8soJccFVHw9spCn368Xfxoe3v1QmF6X16KupBh9S787HtDxw \
  --sender-private-key=EKEnVD7s9tbLmNoyfQweAMBgaobpWz42CppTtrFrj8eEth4ne5JH \
  --lifecycle-period-duration=720 \
  --permission-type=signature
```

#### Read proposal

```zsh
pnpm run cli read-proposal \
  --treasury-owner-public-key=B62qrAk8soJccFVHw9spCn368Xfxoe3v1QmF6X16KupBh9S787HtDxw \
  --proposal-public-key=B62qnARQw1VkACVTkke4r7stE6djS8P3rvWE2HEs1vUPC727S4d6Ds7 \
  --mina-node-url=http://127.0.0.1:8080/graphql
```

#### Tally votes

```zsh
pnpm run cli tally-votes \
  --treasury-owner-public-key=B62qrAk8soJccFVHw9spCn368Xfxoe3v1QmF6X16KupBh9S787HtDxw \
  --treasury-owner-private-key=EKEZJDMXFKHPoyM5iTs8XVvLG9V7QaVk1JjZCdRtsvC3dbWx3p5R \
  --proposal-public-key=B62qjCHgbZLQL1GvugA7m26ipVnhkAVEqfUQVukbmq492TcAzkxcCM7 \
  --proposal-private-key=EKFVjQLhdW6GtBtbfKBcbVXpSYoLHnzM1q2Fk67knjtnBeydtWRY \
  --mina-node-url=http://127.0.0.1:8080/graphql \
  --mina-archive-url=http://127.0.0.1:8282 \
  --sender-private-key=EKEAzRjG1XSUWFNothNV43N6KaXqfUCSErt99cStoc1biBN7NPAD \
  --fee=1000000000 \
  --lifecycle-period-duration=10 \
  --voting-ledger-input-path=.data/voting-ledger.json \
  --staking-ledger-to-voting-ledger-proof-input-path=.data/digest-proof.json \
  --permission-type=signature
```

TODO:

- vote
- tally votes
- execute
