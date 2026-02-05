import { UInt64 } from "o1js";

// TODO: configure appropriate values based on real world data
export const BOND_AMOUNT_DIVISOR = 10;
export const BASIS_POINTS = UInt64.from(10_000);

export const MIN_PARTICIPATION_BP = UInt64.from(2_000);
export const MIN_APPROVAL_BP = UInt64.from(5_100);

export const MAX_PARTICIPATION_BP = UInt64.from(5_000);
export const MAX_APPROVAL_BP = UInt64.from(7_000);

// 10000 = 1 = linear, higher = slower, lower = steper
export const CURVE_CONSTANT_PARTICIPATION_BP = UInt64.from(500);
export const CURVE_CONSTANT_APPROVAL_BP = UInt64.from(1_000); 
