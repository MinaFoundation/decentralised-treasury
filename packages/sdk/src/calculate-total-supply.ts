import { createReadStream } from "fs";
import streamJson from "stream-json";
import StreamArray from "stream-json/streamers/StreamArray.js";

export async function calculateTotalSupply(
  stakingLedgerPath: string
): Promise<string> {
  const { parser } = streamJson;
  const { streamArray } = StreamArray;

  let totalSupply = 0n;
  let accountCount = 0;

  return new Promise((resolve, reject) => {
    createReadStream(stakingLedgerPath)
      .pipe(parser())
      .pipe(streamArray())
      .on("data", ({ value }) => {
        accountCount++;

        if (value?.balance != null) {
          totalSupply += BigInt(value.balance);
        }

        if (accountCount % 1000 === 0) {
          console.log(`Processed ${accountCount} accounts...`);
        }
      })
      .on("end", () => {
        console.log(`Total accounts processed: ${accountCount}`);
        // staking ledger already comes converted from nano MINA to MINA so we don't need to divide by 10^9
        console.log(`Total supply: ${totalSupply} $MINA`);
        resolve(totalSupply.toString());
      })
      .on("error", reject);
  });
}
