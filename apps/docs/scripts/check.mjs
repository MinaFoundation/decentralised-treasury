#!/usr/bin/env node

import { printErrors } from "./lib.mjs";
import {
  checkInfrastructureRunbooks,
  expectedInfrastructureRunbooks,
} from "./generate-infrastructure-runbooks.mjs";
import { validateCoverage } from "./validate-coverage.mjs";
import { loadAndValidateDocs } from "./validate-docs.mjs";

const runbooks = await expectedInfrastructureRunbooks();
const docs = await loadAndValidateDocs();
const errors = [
  ...runbooks.errors,
  ...docs.errors,
  ...(await validateCoverage()),
];

if (errors.length === 0) {
  errors.push(...(await checkInfrastructureRunbooks(runbooks)));
}

printErrors(errors);
if (errors.length > 0) {
  process.exitCode = 1;
} else {
  process.stdout.write(
    "The documentation source, runbook, coverage, and Markdown checks passed.\n",
  );
}
