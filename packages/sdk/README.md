## Scripts

`lightnet:start` - Start a local Mina Lightnet network

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

### Calculate total supply

```zsh
pnpm --filter=@repo/sdk run cli calculate-total-supply $PWD/staking-epoch-ledger.json
```

### Create a testing ledger

Creates a mock ledger with randomized accounts, balances & delegates.

```zsh
pnpm --filter=@repo/sdk run cli create-test-ledger 10000 $PWD/test-ledger.json
```

```zsh
/usr/bin/time -l pnpm --filter=@repo/sdk run cli create-test-ledger 10000 $PWD/test-ledger.json
```
