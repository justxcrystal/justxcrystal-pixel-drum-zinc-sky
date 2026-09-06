import type { Account, AccountId } from "./types";

export const ACCOUNTS: Account[] = [
  {
    id: "atlas",
    code: "ATLAS",
    name: "Atlas",
    sizeLabel: "100K PROP",
    starting: 100_000,
    sessionId: "ATLAS#1605503b-b5ad-4c02-afcb-cf21b17864f0#3#3",
  },
  {
    id: "horizon",
    code: "HORIZON",
    name: "Horizon",
    sizeLabel: "50K PROP",
    starting: 50_000,
    sessionId: "HORIZON#7c21e90a-3b44-4d1f-9a12-e8c0d4f6a1b2#3#3",
  },
  {
    id: "citadel",
    code: "CITADEL",
    name: "Citadel",
    sizeLabel: "150K PROP",
    starting: 150_000,
    sessionId: "CITADEL#b4f09d22-81ae-4c77-a055-2d91c8e3f704#3#3",
  },
];

export function getAccount(id: AccountId): Account {
  return ACCOUNTS.find((a) => a.id === id) ?? ACCOUNTS[0];
}
