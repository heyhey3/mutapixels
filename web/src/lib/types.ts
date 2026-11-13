export type Pixel = {
  token_id: string;
  owner_id: string;
  genome: number[];
  rarity: number;
  mutation_count: number;
  no_change_streak: number;
  minted_at: number;
  last_mutation_at: number;
  name: string;
  lore: string;
  last_outcome: string;
  media: string;
  vault_near?: string;
  vault_mut?: string;
};

export type Vault = {
  token_id: string;
  owner_id: string;
  near_amount: string;
  mut_amount: string;
  near_earned: string;
  mut_earned: string;
};

export type HistoryEntry = {
  at: number;
  kind: string;
  from: string | null;
  to: string | null;
  near_amount: string;
  mut_amount: string;
  note: string;
};

export type VaultStats = {
  total_vault_near: string;
  total_vault_mut: string;
  treasury_near: string;
  treasury_mut: string;
  pending_mut: string;
  total_tips_near: string;
  total_tips_mut: string;
  total_royalty_mut: string;
  near_balance: string;
  near_storage_locked: string;
  near_withdrawable: string;
};

export type MutationBand = {
  name: string;
  min: number;
  max: number;
  description: string;
};

export type Config = {
  owner_id: string;
  mut_token: string;
  mint_price: string;
  mutation_cost: string;
  renderer_base: string;
  vault_seed_bps?: number;
  mutation_vault_bps?: number;
  mutation_treasury_bps?: number;
  mutation_burn_bps?: number;
};

export type RefPool = {
  poolId: number;
  pool: {
    token_account_ids: string[];
    amounts: string[];
    total_fee: number;
    shares_total_supply: string;
  };
  quote: string;
  tokenMeta: { symbol: string; decimals: number };
  ref: string;
  token: string;
};

export type RefQuote = {
  direction: "sell" | "buy";
  amountIn: string;
  amountOut: string;
  tokenIn: string;
  tokenOut: string;
  feeBps: number;
  pool: {
    token_account_ids: string[];
    amounts: string[];
  };
};

export type GateChallenge = {
  challengeId: string;
  message: string;
  recipient: string;
  nonce: string;
  expiresAt: number;
};

export type GateClub = {
  pass: string;
  note: string;
  privileges: string[];
};

export type GateInfo = {
  accountId: string;
  tokenId: string;
  checkedAt: string;
  pixel: Pixel;
  vault: Vault | null;
  history: HistoryEntry[];
  holderSince: number;
  club: GateClub;
};
