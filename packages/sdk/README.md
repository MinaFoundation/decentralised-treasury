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
   ./mina.exe ledger export staking-epoch-ledger > staking-epoch-ledger.json
   ```

3. Copy the ledger from the docker container
   ```zsh
   docker cp mina-local-lightnet:/root/staking-epoch-ledger.json ./staking-epoch-ledger.json
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

#### Deploy the treasury owner contract

```zsh
pnpm run cli deploy-treasury-owner \
  --treasury-owner-private-key=EKEZJDMXFKHPoyM5iTs8XVvLG9V7QaVk1JjZCdRtsvC3dbWx3p5R \
  --treasury-deployed-at-slot=0 \
  --multisig-participants-public-keys=B62qjTUDxfYAKoPkBrSWPfFChffK8dPREoKFk3ELBqJBxe6AqfGZH8A,B62qj5RNepExR8qw9mDriTnJPj4BGvnCYVHDj3kroaipiq9v1jLkUt3,B62qjsu47JP6Jd2komcdvXjw4RjKkYB8LVAhyZ8RyVZw9453Civi8R4 \
  --mina-node-url=http://127.0.0.1:8080/graphql \
  --sender-private-key=EKDpoov2DNs2aBLmm2yZNwLKHDvG42EdwPGaeCTrhm1kaFHc5f1g \
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
  --amount=100000000000
  --proposal-content-host-type=github
  --proposal-content-identifier=https://gist.githubusercontent.com/maht0rz/a61f258584415f74f2520877c74e0c79/raw/13795618f6949ff8c54f6d43cd6d31f6847c0712/my_proposal.md \
  --recipient-public-key=B62qjTUDxfYAKoPkBrSWPfFChffK8dPREoKFk3ELBqJBxe6AqfGZH8A \
  --proposal-lifecycle-id=0 \
  --treasury-owner-private-key=EKEZJDMXFKHPoyM5iTs8XVvLG9V7QaVk1JjZCdRtsvC3dbWx3p5R \
  --proposal-private-key=EKE1ATCF6oD6Sek2prmLz8BAnkwE5NhcYLw3HGUHVfed38dksd72
  --mina-node-url=http://127.0.0.1:8080/graphql \
  --sender-private-key=EKDpoov2DNs2aBLmm2yZNwLKHDvG42EdwPGaeCTrhm1kaFHc5f1g \
  --permission-type=signature
```

TODO:

- configure appropriate period lengths for the demo
- show proposal (read content from host type), based on zkAppUri
- vote
- tally votes
- execute
