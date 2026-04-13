export function createReadStream(): never {
  throw new Error("fs is not available in the browser.");
}

export function statSync(): never {
  throw new Error("fs is not available in the browser.");
}

const fsShim = {
  createReadStream,
  statSync,
};

export default fsShim;
