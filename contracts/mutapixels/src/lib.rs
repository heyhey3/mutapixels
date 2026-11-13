use near_contract_standards::non_fungible_token::approval::NonFungibleTokenApproval;
use near_contract_standards::non_fungible_token::core::{
    NonFungibleTokenCore, NonFungibleTokenResolver,
};
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_contract_standards::non_fungible_token::events::NftMint;
use near_contract_standards::non_fungible_token::metadata::{
    NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata, NFT_METADATA_SPEC,
};
use near_contract_standards::non_fungible_token::{NonFungibleToken, Token, TokenId};
use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::json_types::U128;
use near_sdk::serde_json::{json, Value};
use near_sdk::store::{IterableSet, LazyOption, LookupMap};
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, IntoStorageKey, NearToken, PanicOnDefault,
    Promise, PromiseOrValue,
};
use std::collections::HashMap;

const GAS_FOR_BURN: Gas = Gas::from_tgas(20);
const GAS_FOR_FT_TRANSFER: Gas = Gas::from_tgas(30);
const GAS_FOR_WITHDRAW_CALLBACK: Gas = Gas::from_tgas(30);
const MAX_PAGE: u64 = 100;
const MAX_HISTORY: usize = 100;

const BPS_DENOM: u128 = 10_000;
/// Share of the mint price seeded into the token's own vault.
const VAULT_SEED_BPS: u16 = 1_500;
/// Share of every mutation fee credited to the token's vault.
const MUTATION_VAULT_BPS: u16 = 2_000;
/// Share of every mutation fee credited to the club treasury.
const MUTATION_TREASURY_BPS: u16 = 2_000;
/// The remaining mutation fee is burned.
const MUTATION_BURN_BPS: u16 = 6_000;

#[derive(BorshStorageKey, BorshSerialize)]
pub enum StorageKey {
    Tokens,
    TokenMetadata,
    Enumeration,
    ContractMetadata,
    Pixels,
    PixelIds,
    // Appended in v2; appending keeps the v1 storage keys stable.
    Approvals,
    Vaults,
    Histories,
    PendingWithdrawals,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Pixel {
    pub token_id: TokenId,
    pub genome: Vec<u8>,
    pub rarity: u8,
    pub mutation_count: u32,
    pub no_change_streak: u8,
    pub minted_at: u64,
    pub last_mutation_at: u64,
    pub name: String,
    pub lore: String,
    pub last_outcome: String,
}

/// Per-token bookkeeping account. Funds are custodied by the NFT contract,
/// but only the *current* holder of `token_id` can move them.
#[near(serializers = [borsh])]
#[derive(Clone, Debug, Default)]
pub struct Vault {
    pub near_amount: u128,
    pub mut_amount: u128,
    pub near_earned: u128,
    pub mut_earned: u128,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct HistoryRecord {
    pub at: u64,
    pub kind: String,
    pub from: Option<AccountId>,
    pub to: Option<AccountId>,
    pub near_amount: u128,
    pub mut_amount: u128,
    pub note: String,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct PendingWithdrawal {
    pub token_id: TokenId,
    pub amount: u128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct PixelView {
    pub token_id: TokenId,
    pub owner_id: AccountId,
    pub genome: Vec<u8>,
    pub rarity: u8,
    pub mutation_count: u32,
    pub no_change_streak: u8,
    pub minted_at: u64,
    pub last_mutation_at: u64,
    pub name: String,
    pub lore: String,
    pub last_outcome: String,
    pub media: String,
    pub vault_near: U128,
    pub vault_mut: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct VaultView {
    pub token_id: TokenId,
    pub owner_id: AccountId,
    pub near_amount: U128,
    pub mut_amount: U128,
    pub near_earned: U128,
    pub mut_earned: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct HistoryView {
    pub at: u64,
    pub kind: String,
    pub from: Option<AccountId>,
    pub to: Option<AccountId>,
    pub near_amount: U128,
    pub mut_amount: U128,
    pub note: String,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct VaultStatsView {
    pub total_vault_near: U128,
    pub total_vault_mut: U128,
    pub treasury_near: U128,
    pub treasury_mut: U128,
    pub pending_mut: U128,
    pub total_tips_near: U128,
    pub total_tips_mut: U128,
    pub total_royalty_mut: U128,
    pub near_balance: U128,
    pub near_storage_locked: U128,
    pub near_withdrawable: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct RenderData {
    pub token_id: TokenId,
    pub owner_id: AccountId,
    pub genome: Vec<u8>,
    pub rarity: u8,
    pub mutation_count: u32,
    pub name: String,
    pub lore: String,
    pub last_outcome: String,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct MutationBand {
    pub name: String,
    pub min: u16,
    pub max: u16,
    pub description: String,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct ConfigView {
    pub owner_id: AccountId,
    pub mut_token: AccountId,
    pub mint_price: U128,
    pub mutation_cost: U128,
    pub renderer_base: String,
    pub vault_seed_bps: u16,
    pub mutation_vault_bps: u16,
    pub mutation_treasury_bps: u16,
    pub mutation_burn_bps: u16,
}

/// Mutapixels: a NEP-171 pixel creature whose genome changes through
/// probabilistic, on-chain mutation rolls paid in `$MUT`.
///
/// Each token also owns a virtual vault ("sub-account"):
/// - mint seeds 15% of the mint price into the token vault;
/// - every mutation pays 20% of the fee to the vault, 20% to the club treasury
///   and burns the remaining 60%;
/// - anyone can tip NEAR/$MUT into a token vault;
/// - only the current NFT holder can withdraw, and the vault moves with the
///   token on every transfer.
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    tokens: NonFungibleToken,
    metadata: LazyOption<NFTContractMetadata>,
    owner_id: AccountId,
    mut_token: AccountId,
    mint_price: u128,
    mutation_cost: u128,
    renderer_base: String,
    pixels: LookupMap<TokenId, Pixel>,
    pixel_ids: IterableSet<TokenId>,
    next_id: u64,
    total_mutations: u64,
    // v2: per-token vaults, accounting history and the club treasury.
    vaults: LookupMap<TokenId, Vault>,
    histories: LookupMap<TokenId, Vec<HistoryRecord>>,
    pending_withdrawals: LookupMap<u64, PendingWithdrawal>,
    next_withdrawal_id: u64,
    treasury_near: u128,
    treasury_mut: u128,
    total_vault_near: u128,
    total_vault_mut: u128,
    pending_mut_total: u128,
    total_tips_near: u128,
    total_tips_mut: u128,
    total_royalty_mut: u128,
}

#[near]
impl Contract {
    #[init]
    pub fn new(
        owner_id: AccountId,
        mut_token: AccountId,
        mint_price: U128,
        mutation_cost: U128,
        renderer_base: String,
    ) -> Self {
        require!(mint_price.0 > 0, "mint price must be positive");
        require!(mutation_cost.0 > 0, "mutation cost must be positive");

        let tokens = NonFungibleToken::new(
            StorageKey::Tokens,
            owner_id.clone(),
            Some(StorageKey::TokenMetadata),
            Some(StorageKey::Enumeration),
            Some(StorageKey::Approvals),
        );
        let contract_metadata = NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: "Mutapixels".to_string(),
            symbol: "PIXEL".to_string(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        };

        Self {
            tokens,
            metadata: LazyOption::new(StorageKey::ContractMetadata, Some(contract_metadata)),
            owner_id,
            mut_token,
            mint_price: mint_price.0,
            mutation_cost: mutation_cost.0,
            renderer_base,
            pixels: LookupMap::new(StorageKey::Pixels),
            pixel_ids: IterableSet::new(StorageKey::PixelIds),
            next_id: 1,
            total_mutations: 0,
            vaults: LookupMap::new(StorageKey::Vaults),
            histories: LookupMap::new(StorageKey::Histories),
            pending_withdrawals: LookupMap::new(StorageKey::PendingWithdrawals),
            next_withdrawal_id: 0,
            treasury_near: 0,
            treasury_mut: 0,
            total_vault_near: 0,
            total_vault_mut: 0,
            pending_mut_total: 0,
            total_tips_near: 0,
            total_tips_mut: 0,
            total_royalty_mut: 0,
        }
    }

    /// Upgrades a v1 deployment in place. The caller must be the stored owner.
    /// Only call this through `deploy ... with-init-call migrate` on an account
    /// that already holds v1 state.
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        let old: ContractV1 = env::state_read().expect("no v1 state to migrate");
        require!(
            env::predecessor_account_id() == old.owner_id,
            "only the owner can migrate"
        );

        let mut tokens = old.tokens;
        let approval_prefix: Vec<u8> = StorageKey::Approvals.into_storage_key();
        // `NonFungibleToken` uses the legacy collection types.
        tokens.approvals_by_id = Some(near_sdk::collections::LookupMap::new(
            approval_prefix.clone(),
        ));
        tokens.next_approval_id_by_id = Some(near_sdk::collections::LookupMap::new(
            [approval_prefix, b"n".to_vec()].concat(),
        ));

        let storage_locked =
            env::storage_usage() as u128 * env::storage_byte_cost().as_yoctonear();
        let treasury_near = env::account_balance()
            .as_yoctonear()
            .saturating_sub(storage_locked);

        Self {
            tokens,
            metadata: old.metadata,
            owner_id: old.owner_id,
            mut_token: old.mut_token,
            mint_price: old.mint_price,
            mutation_cost: old.mutation_cost,
            renderer_base: old.renderer_base,
            pixels: old.pixels,
            pixel_ids: old.pixel_ids,
            next_id: old.next_id,
            total_mutations: old.total_mutations,
            vaults: LookupMap::new(StorageKey::Vaults),
            histories: LookupMap::new(StorageKey::Histories),
            pending_withdrawals: LookupMap::new(StorageKey::PendingWithdrawals),
            next_withdrawal_id: 0,
            treasury_near,
            treasury_mut: 0,
            total_vault_near: 0,
            total_vault_mut: 0,
            pending_mut_total: 0,
            total_tips_near: 0,
            total_tips_mut: 0,
            total_royalty_mut: 0,
        }
    }

    #[payable]
    pub fn mint(&mut self) -> TokenId {
        let attached = env::attached_deposit().as_yoctonear();
        require!(attached >= self.mint_price, "attach at least the mint price");
        let excess = attached - self.mint_price;
        let owner = env::predecessor_account_id();

        let token_id = self.next_id.to_string();
        self.next_id += 1;
        let now = now_secs();

        let seed = self.seed(&token_id, 0, &owner, now);
        let genome: Vec<u8> = (0..8).map(|i| seed[i] % 8).collect();
        let rarity = initial_rarity(&seed);
        let name = pixel_name(&genome);
        let lore = pixel_lore(&genome, rarity, 0);

        let pixel = Pixel {
            token_id: token_id.clone(),
            genome,
            rarity,
            mutation_count: 0,
            no_change_streak: 0,
            minted_at: now,
            last_mutation_at: 0,
            name,
            lore,
            last_outcome: "minted".to_string(),
        };

        // Fund the token's own vault from the mint price. The rest becomes
        // club treasury; the contract pays storage out of its own balance.
        let seed_near = self.mint_price * VAULT_SEED_BPS as u128 / BPS_DENOM;
        let treasury_share = self.mint_price - seed_near;
        self.vaults.insert(
            token_id.clone(),
            Vault {
                near_amount: seed_near,
                mut_amount: 0,
                near_earned: seed_near,
                mut_earned: 0,
            },
        );
        self.total_vault_near += seed_near;
        self.treasury_near += treasury_share;

        let metadata = self.metadata_for(&pixel);
        self.tokens.internal_mint_with_refund(
            token_id.clone(),
            owner.clone(),
            Some(metadata),
            None,
        );
        NftMint {
            owner_id: owner.as_ref(),
            token_ids: &[token_id.as_str()],
            memo: Some("Mutapixel mint"),
        }
        .emit();

        self.pixels.insert(token_id.clone(), pixel.clone());
        self.pixel_ids.insert(token_id.clone());
        self.push_history(
            &token_id,
            HistoryRecord {
                at: now,
                kind: "mint".to_string(),
                from: None,
                to: Some(owner.clone()),
                near_amount: seed_near,
                mut_amount: 0,
                note: format!(
                    "Mint seeded the pixel vault with {}% of the mint price",
                    VAULT_SEED_BPS / 100
                ),
            },
        );

        if excess > 0 {
            Promise::new(owner.clone())
                .transfer(NearToken::from_yoctonear(excess))
                .detach();
        }

        emit(
            "pixel_minted",
            json!({
                "token_id": token_id,
                "owner": owner,
                "genome": pixel.genome,
                "rarity": pixel.rarity,
                "name": pixel.name,
                "vault_seed_near": U128(seed_near),
                "treasury_near": U128(treasury_share),
            }),
        );

        token_id
    }

    /// NEP-141 receiver. The user calls `$MUT.ft_transfer_call(nft, cost, msg)`.
    ///
    /// `msg = {"token_id":"1"}` rolls a mutation.
    /// `msg = {"tip":"1"}` tips the pixel's vault (any amount).
    ///
    /// Invalid messages are refunded instead of panicking, as required by
    /// NEP-141.
    #[payable]
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        require!(
            env::predecessor_account_id() == self.mut_token,
            "only $MUT can call this"
        );

        let request: Value = match near_sdk::serde_json::from_str(&msg) {
            Ok(value) => value,
            Err(_) => return PromiseOrValue::Value(amount),
        };

        if let Some(token_id) = request.get("token_id").and_then(Value::as_str) {
            let token_id = token_id.to_string();
            let owner = match self.tokens.owner_by_id.get(&token_id) {
                Some(owner) => owner.clone(),
                None => return PromiseOrValue::Value(amount),
            };
            if owner != sender_id || amount.0 != self.mutation_cost {
                return PromiseOrValue::Value(amount);
            }
            self.roll_mutation(&sender_id, &token_id, amount.0);
            return PromiseOrValue::Value(U128(0));
        }

        if let Some(token_id) = request.get("tip").and_then(Value::as_str) {
            let token_id = token_id.to_string();
            if amount.0 == 0 || self.tokens.owner_by_id.get(&token_id).is_none() {
                return PromiseOrValue::Value(amount);
            }
            self.credit_mut_tip(&sender_id, &token_id, amount.0);
            return PromiseOrValue::Value(U128(0));
        }

        PromiseOrValue::Value(amount)
    }

    /// Tip a pixel's vault with NEAR. Anyone can feed any pixel.
    #[payable]
    pub fn tip(&mut self, token_id: TokenId) {
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "attach NEAR to feed this pixel");
        let owner = self
            .tokens
            .owner_by_id
            .get(&token_id)
            .expect("token not found")
            .clone();
        let sender = env::predecessor_account_id();

        let mut vault = self.vault_for(&token_id);
        vault.near_amount += amount;
        vault.near_earned += amount;
        self.vaults.insert(token_id.clone(), vault);
        self.total_vault_near += amount;
        self.total_tips_near += amount;
        self.push_history(
            &token_id,
            HistoryRecord {
                at: now_secs(),
                kind: "tip".to_string(),
                from: Some(sender.clone()),
                to: Some(owner.clone()),
                near_amount: amount,
                mut_amount: 0,
                note: "NEAR tip credited to the pixel vault".to_string(),
            },
        );
        self.refresh_metadata(&token_id);

        emit(
            "pixel_tipped",
            json!({
                "token_id": token_id,
                "from": sender,
                "owner": owner,
                "amount": U128(amount),
                "currency": "NEAR",
            }),
        );
    }

    /// Withdraw this token's vault. Only the current holder can call this.
    /// The NFT contract custodies the funds, so this never touches the seller
    /// after a transfer: ownership is checked at call time.
    pub fn withdraw_vault(&mut self, token_id: TokenId, near_amount: U128, mut_amount: U128) {
        let owner = self
            .tokens
            .owner_by_id
            .get(&token_id)
            .expect("token not found")
            .clone();
        require!(
            env::predecessor_account_id() == owner,
            "only the current holder can withdraw the vault"
        );
        require!(
            near_amount.0 > 0 || mut_amount.0 > 0,
            "nothing to withdraw"
        );

        let mut vault = self.vault_for(&token_id);
        require!(
            near_amount.0 <= vault.near_amount,
            "insufficient NEAR in pixel vault"
        );
        require!(
            mut_amount.0 <= vault.mut_amount,
            "insufficient MUT in pixel vault"
        );

        vault.near_amount -= near_amount.0;
        vault.mut_amount -= mut_amount.0;
        self.total_vault_near -= near_amount.0;
        self.total_vault_mut -= mut_amount.0;
        self.vaults.insert(token_id.clone(), vault);
        self.push_history(
            &token_id,
            HistoryRecord {
                at: now_secs(),
                kind: "withdraw".to_string(),
                from: Some(owner.clone()),
                to: Some(owner.clone()),
                near_amount: near_amount.0,
                mut_amount: mut_amount.0,
                note: "Current holder withdrew from the pixel vault".to_string(),
            },
        );
        self.refresh_metadata(&token_id);

        if near_amount.0 > 0 {
            Promise::new(owner.clone())
                .transfer(NearToken::from_yoctonear(near_amount.0))
                .detach();
        }

        if mut_amount.0 > 0 {
            let withdrawal_id = self.next_withdrawal_id;
            self.next_withdrawal_id += 1;
            self.pending_withdrawals.insert(
                withdrawal_id,
                PendingWithdrawal {
                    token_id: token_id.clone(),
                    amount: mut_amount.0,
                },
            );
            self.pending_mut_total += mut_amount.0;

            Promise::new(self.mut_token.clone())
                .function_call(
                    "ft_transfer".to_string(),
                    json!({
                        "receiver_id": owner,
                        "amount": U128(mut_amount.0),
                        "memo": "Mutapixels pixel vault withdrawal",
                    })
                    .to_string()
                    .into_bytes(),
                    NearToken::from_yoctonear(1),
                    GAS_FOR_FT_TRANSFER,
                )
                .then(
                    Promise::new(env::current_account_id()).function_call(
                        "on_withdraw_transfer".to_string(),
                        json!({ "withdrawal_id": withdrawal_id })
                            .to_string()
                            .into_bytes(),
                        NearToken::from_yoctonear(0),
                        GAS_FOR_WITHDRAW_CALLBACK,
                    ),
                )
                .detach();
        }

        emit(
            "vault_withdrawn",
            json!({
                "token_id": token_id,
                "holder": owner,
                "near_amount": near_amount,
                "mut_amount": mut_amount,
            }),
        );
    }

    /// Callback for the $MUT leg of a withdrawal. If the FT transfer failed
    /// (for example the holder has no $MUT storage), the amount is restored to
    /// the token's vault, not to the seller. If the NFT was sold while this
    /// promise was in flight, the new holder therefore receives the restored
    /// funds.
    #[private]
    pub fn on_withdraw_transfer(&mut self, withdrawal_id: u64) -> bool {
        // `ft_transfer` returns JSON `null` (4 bytes). A bounded read avoids
        // the deprecated, unbounded `promise_result` helper.
        let success = env::promise_result_checked(0, 256).is_ok();
        self.finalize_withdrawal(withdrawal_id, success)
    }

    fn finalize_withdrawal(&mut self, withdrawal_id: u64, success: bool) -> bool {
        let Some(pending) = self.pending_withdrawals.get(&withdrawal_id).cloned() else {
            return false;
        };
        self.pending_withdrawals.remove(&withdrawal_id);
        self.pending_mut_total = self.pending_mut_total.saturating_sub(pending.amount);

        if success {
            return true;
        }

        let mut vault = self.vault_for(&pending.token_id);
        vault.mut_amount += pending.amount;
        self.vaults.insert(pending.token_id.clone(), vault);
        self.total_vault_mut += pending.amount;

        let holder = self.tokens.owner_by_id.get(&pending.token_id);
        self.push_history(
            &pending.token_id,
            HistoryRecord {
                at: now_secs(),
                kind: "withdraw_failed".to_string(),
                from: None,
                to: holder.clone(),
                near_amount: 0,
                mut_amount: pending.amount,
                note: "MUT transfer failed; funds were restored to the pixel vault"
                    .to_string(),
            },
        );
        self.refresh_metadata(&pending.token_id);

        emit(
            "vault_withdraw_failed",
            json!({
                "token_id": pending.token_id,
                "holder": holder,
                "amount": U128(pending.amount),
            }),
        );
        false
    }

    pub fn get_pixel(&self, token_id: TokenId) -> Option<PixelView> {
        let pixel = self.pixels.get(&token_id)?;
        let owner = self.tokens.owner_by_id.get(&token_id)?.clone();
        Some(self.pixel_view(pixel, owner))
    }

    pub fn get_pixels(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<PixelView> {
        let from = from_index.map(|v| v.0 as usize).unwrap_or(0);
        let take = limit.unwrap_or(MAX_PAGE).min(MAX_PAGE) as usize;
        self.pixel_ids
            .iter()
            .skip(from)
            .take(take)
            .filter_map(|token_id| {
                let pixel = self.pixels.get(token_id)?;
                let owner = self.tokens.owner_by_id.get(token_id)?.clone();
                Some(self.pixel_view(pixel, owner))
            })
            .collect()
    }

    pub fn get_vault(&self, token_id: TokenId) -> Option<VaultView> {
        let owner = self.tokens.owner_by_id.get(&token_id)?.clone();
        let vault = self.vaults.get(&token_id).cloned().unwrap_or_default();
        Some(VaultView {
            token_id,
            owner_id: owner,
            near_amount: U128(vault.near_amount),
            mut_amount: U128(vault.mut_amount),
            near_earned: U128(vault.near_earned),
            mut_earned: U128(vault.mut_earned),
        })
    }

    pub fn get_history(
        &self,
        token_id: TokenId,
        from_index: Option<U128>,
        limit: Option<u64>,
    ) -> Vec<HistoryView> {
        let Some(records) = self.histories.get(&token_id) else {
            return Vec::new();
        };
        let from = from_index.map(|v| v.0 as usize).unwrap_or(0);
        let take = limit.unwrap_or(50).min(MAX_PAGE) as usize;
        records
            .iter()
            .rev()
            .skip(from)
            .take(take)
            .map(|record| HistoryView {
                at: record.at,
                kind: record.kind.clone(),
                from: record.from.clone(),
                to: record.to.clone(),
                near_amount: U128(record.near_amount),
                mut_amount: U128(record.mut_amount),
                note: record.note.clone(),
            })
            .collect()
    }

    pub fn get_vault_stats(&self) -> VaultStatsView {
        let near_balance = env::account_balance().as_yoctonear();
        let near_storage_locked =
            env::storage_usage() as u128 * env::storage_byte_cost().as_yoctonear();
        VaultStatsView {
            total_vault_near: U128(self.total_vault_near),
            total_vault_mut: U128(self.total_vault_mut),
            treasury_near: U128(self.treasury_near),
            treasury_mut: U128(self.treasury_mut),
            pending_mut: U128(self.pending_mut_total),
            total_tips_near: U128(self.total_tips_near),
            total_tips_mut: U128(self.total_tips_mut),
            total_royalty_mut: U128(self.total_royalty_mut),
            near_balance: U128(near_balance),
            near_storage_locked: U128(near_storage_locked),
            near_withdrawable: U128(near_balance.saturating_sub(near_storage_locked)),
        }
    }

    pub fn is_holder(&self, token_id: TokenId, account_id: AccountId) -> bool {
        self.tokens
            .owner_by_id
            .get(&token_id)
            .map(|owner| owner == account_id)
            .unwrap_or(false)
    }

    pub fn get_mutation_table(&self) -> Vec<MutationBand> {
        vec![
            MutationBand {
                name: "none".into(),
                min: 0,
                max: 4499,
                description: "No visible change. The creature is stable — for now.".into(),
            },
            MutationBand {
                name: "common".into(),
                min: 4500,
                max: 7499,
                description: "One gene shifts. A small, permanent evolution.".into(),
            },
            MutationBand {
                name: "rare".into(),
                min: 7500,
                max: 8999,
                description: "Two genes shift. Rarity rises to at least 3.".into(),
            },
            MutationBand {
                name: "epic".into(),
                min: 9000,
                max: 9799,
                description: "Three genes shift. Rarity rises to at least 4.".into(),
            },
            MutationBand {
                name: "legendary".into(),
                min: 9800,
                max: 9999,
                description: "Four genes shift. Rarity becomes 5. Extremely rare.".into(),
            },
        ]
    }

    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            owner_id: self.owner_id.clone(),
            mut_token: self.mut_token.clone(),
            mint_price: U128(self.mint_price),
            mutation_cost: U128(self.mutation_cost),
            renderer_base: self.renderer_base.clone(),
            vault_seed_bps: VAULT_SEED_BPS,
            mutation_vault_bps: MUTATION_VAULT_BPS,
            mutation_treasury_bps: MUTATION_TREASURY_BPS,
            mutation_burn_bps: MUTATION_BURN_BPS,
        }
    }

    pub fn get_render_data(&self, token_id: TokenId) -> Option<RenderData> {
        let pixel = self.pixels.get(&token_id)?;
        let owner = self.tokens.owner_by_id.get(&token_id)?.clone();
        Some(RenderData {
            token_id,
            owner_id: owner,
            genome: pixel.genome.clone(),
            rarity: pixel.rarity,
            mutation_count: pixel.mutation_count,
            name: pixel.name.clone(),
            lore: pixel.lore.clone(),
            last_outcome: pixel.last_outcome.clone(),
        })
    }

    pub fn get_total_mutations(&self) -> u64 {
        self.total_mutations
    }

    pub fn get_pixel_count(&self) -> u64 {
        self.pixel_ids.len() as u64
    }

    pub fn set_mutation_cost(&mut self, cost: U128) {
        self.assert_owner();
        require!(cost.0 > 0, "cost must be positive");
        self.mutation_cost = cost.0;
    }

    pub fn set_mint_price(&mut self, price: U128) {
        self.assert_owner();
        require!(price.0 > 0, "price must be positive");
        self.mint_price = price.0;
    }

    pub fn set_renderer_base(&mut self, renderer_base: String) {
        self.assert_owner();
        self.renderer_base = renderer_base;
    }

    /// Rewrites token metadata after a renderer change (for example during a
    /// migration). Returns the number of tokens refreshed in this page.
    pub fn refresh_metadata_batch(
        &mut self,
        from_index: Option<U128>,
        limit: Option<u64>,
    ) -> u64 {
        self.assert_owner();
        let from = from_index.map(|v| v.0 as usize).unwrap_or(0);
        let take = limit.unwrap_or(20).min(50) as usize;
        let ids: Vec<TokenId> = self
            .pixel_ids
            .iter()
            .skip(from)
            .take(take)
            .cloned()
            .collect();
        for token_id in &ids {
            self.refresh_metadata(token_id);
        }
        ids.len() as u64
    }

    /// Owner withdrawal from the club treasury. The per-token vaults are
    /// deliberately not reachable from owner-only methods.
    pub fn withdraw_treasury_near(&mut self, to: AccountId, amount: U128) {
        self.assert_owner();
        require!(amount.0 > 0, "amount must be positive");
        require!(
            amount.0 <= self.treasury_near,
            "amount exceeds club treasury"
        );
        // Do not let an owner withdrawal leave the token vaults unfunded.
        let storage_locked =
            env::storage_usage() as u128 * env::storage_byte_cost().as_yoctonear();
        let available = env::account_balance()
            .as_yoctonear()
            .saturating_sub(storage_locked);
        require!(
            available >= self.total_vault_near.saturating_add(amount.0),
            "withdrawal would leave pixel vaults unfunded"
        );
        self.treasury_near -= amount.0;
        Promise::new(to)
            .transfer(NearToken::from_yoctonear(amount.0))
            .detach();
    }

    /// Kept for v1 ABI compatibility. It now only spends the club treasury.
    pub fn withdraw_near(&mut self, to: AccountId, amount: U128) {
        self.withdraw_treasury_near(to, amount);
    }

    pub fn withdraw_treasury_mut(&mut self, to: AccountId, amount: U128) {
        self.assert_owner();
        require!(amount.0 > 0, "amount must be positive");
        require!(
            amount.0 <= self.treasury_mut,
            "amount exceeds club treasury"
        );
        self.treasury_mut -= amount.0;
        Promise::new(self.mut_token.clone())
            .function_call(
                "ft_transfer".to_string(),
                json!({
                    "receiver_id": to,
                    "amount": U128(amount.0),
                    "memo": "Mutapixels club treasury",
                })
                .to_string()
                .into_bytes(),
                NearToken::from_yoctonear(1),
                GAS_FOR_FT_TRANSFER,
            )
            .detach();
    }

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner_id, "only owner");
    }

    fn vault_for(&self, token_id: &TokenId) -> Vault {
        self.vaults.get(token_id).cloned().unwrap_or_default()
    }

    fn push_history(&mut self, token_id: &TokenId, record: HistoryRecord) {
        let mut records = self.histories.get(token_id).cloned().unwrap_or_default();
        records.push(record);
        if records.len() > MAX_HISTORY {
            records.remove(0);
        }
        self.histories.insert(token_id.clone(), records);
    }

    fn refresh_metadata(&mut self, token_id: &TokenId) {
        let Some(pixel) = self.pixels.get(token_id).cloned() else {
            return;
        };
        let metadata = self.metadata_for(&pixel);
        self.tokens
            .token_metadata_by_id
            .as_mut()
            .expect("metadata enabled")
            .insert(token_id, &metadata);
    }

    fn record_transfer(
        &mut self,
        token_id: &TokenId,
        from: &AccountId,
        to: &AccountId,
        memo: Option<String>,
    ) {
        // The caller controls `memo`, so cap it before storing it in history.
        let note: String = memo
            .unwrap_or_else(|| "NFT transferred; vault control moved with it".to_string())
            .chars()
            .take(160)
            .collect();
        self.push_history(
            token_id,
            HistoryRecord {
                at: now_secs(),
                kind: "transfer".to_string(),
                from: Some(from.clone()),
                to: Some(to.clone()),
                near_amount: 0,
                mut_amount: 0,
                note,
            },
        );
        emit(
            "pixel_transferred",
            json!({
                "token_id": token_id,
                "from": from,
                "to": to,
                "vault_moves_with_token": true,
            }),
        );
    }

    fn credit_mut_tip(&mut self, sender: &AccountId, token_id: &TokenId, amount: u128) {
        let owner = self
            .tokens
            .owner_by_id
            .get(token_id)
            .expect("token exists")
            .clone();
        let mut vault = self.vault_for(token_id);
        vault.mut_amount += amount;
        vault.mut_earned += amount;
        self.vaults.insert(token_id.clone(), vault);
        self.total_vault_mut += amount;
        self.total_tips_mut += amount;
        self.push_history(
            token_id,
            HistoryRecord {
                at: now_secs(),
                kind: "tip".to_string(),
                from: Some(sender.clone()),
                to: Some(owner.clone()),
                near_amount: 0,
                mut_amount: amount,
                note: "$MUT tip credited to the pixel vault".to_string(),
            },
        );
        self.refresh_metadata(token_id);

        emit(
            "pixel_tipped",
            json!({
                "token_id": token_id,
                "from": sender,
                "owner": owner,
                "amount": U128(amount),
                "currency": "MUT"
            }),
        );
    }

    fn roll_mutation(&mut self, sender: &AccountId, token_id: &TokenId, amount: u128) {
        let mut pixel = self.pixels.get(token_id).expect("pixel exists").clone();
        let seed = self.seed(token_id, pixel.mutation_count, sender, now_secs());
        let roll = u16::from_le_bytes([seed[0], seed[1]]) % 10_000;

        let mut outcome = if roll < 4500 {
            "none"
        } else if roll < 7500 {
            "common"
        } else if roll < 9000 {
            "rare"
        } else if roll < 9800 {
            "epic"
        } else {
            "legendary"
        };

        // Pity: after three uneventful rolls, the next is at least common.
        if outcome == "none" && pixel.no_change_streak >= 3 {
            outcome = "common";
        }

        match outcome {
            "none" => {
                pixel.no_change_streak = pixel.no_change_streak.saturating_add(1);
                pixel.last_outcome = "none".to_string();
            }
            "common" => {
                mutate_genes(&mut pixel.genome, 1, &seed);
                pixel.rarity = pixel.rarity.max(2);
                pixel.no_change_streak = 0;
                pixel.last_outcome = "common".to_string();
            }
            "rare" => {
                mutate_genes(&mut pixel.genome, 2, &seed);
                pixel.rarity = pixel.rarity.max(3);
                pixel.no_change_streak = 0;
                pixel.last_outcome = "rare".to_string();
            }
            "epic" => {
                mutate_genes(&mut pixel.genome, 3, &seed);
                pixel.rarity = pixel.rarity.max(4);
                pixel.no_change_streak = 0;
                pixel.last_outcome = "epic".to_string();
            }
            _ => {
                mutate_genes(&mut pixel.genome, 4, &seed);
                pixel.rarity = 5;
                pixel.no_change_streak = 0;
                pixel.last_outcome = "legendary".to_string();
            }
        }

        pixel.mutation_count = pixel.mutation_count.saturating_add(1);
        pixel.last_mutation_at = now_secs();
        pixel.name = pixel_name(&pixel.genome);
        pixel.lore = pixel_lore(&pixel.genome, pixel.rarity, pixel.mutation_count);

        // Fee split: 20% vault royalty, 20% club treasury, 60% burned.
        let vault_share = amount * MUTATION_VAULT_BPS as u128 / BPS_DENOM;
        let treasury_share = amount * MUTATION_TREASURY_BPS as u128 / BPS_DENOM;
        let burn_share = amount.saturating_sub(vault_share + treasury_share);

        if vault_share > 0 {
            let mut vault = self.vault_for(token_id);
            vault.mut_amount += vault_share;
            vault.mut_earned += vault_share;
            self.vaults.insert(token_id.clone(), vault);
            self.total_vault_mut += vault_share;
            self.total_royalty_mut += vault_share;
        }
        self.treasury_mut += treasury_share;

        self.pixels.insert(token_id.clone(), pixel.clone());
        self.total_mutations = self.total_mutations.saturating_add(1);
        self.push_history(
            token_id,
            HistoryRecord {
                at: now_secs(),
                kind: "royalty".to_string(),
                from: Some(sender.clone()),
                to: Some(sender.clone()),
                near_amount: 0,
                mut_amount: vault_share,
                note: format!(
                    "{} mutation: {} MUT paid ({} to vault, {} to treasury, {} burned)",
                    outcome, amount, vault_share, treasury_share, burn_share
                ),
            },
        );
        self.refresh_metadata(token_id);

        if burn_share > 0 {
            Promise::new(self.mut_token.clone())
                .function_call(
                    "burn".to_string(),
                    json!({ "amount": U128(burn_share) })
                        .to_string()
                        .into_bytes(),
                    NearToken::from_yoctonear(0),
                    GAS_FOR_BURN,
                )
                .detach();
        }

        emit(
            "pixel_mutated",
            json!({
                "token_id": token_id,
                "owner": sender,
                "roll": roll,
                "outcome": outcome,
                "genome": pixel.genome,
                "rarity": pixel.rarity,
                "mutation_count": pixel.mutation_count,
                "name": pixel.name,
                "lore": pixel.lore,
                "paid_mut": U128(amount),
                "vault_royalty_mut": U128(vault_share),
                "treasury_mut": U128(treasury_share),
                "burned_mut": U128(burn_share),
            }),
        );
    }

    fn seed(&self, token_id: &str, nonce: u32, sender: &AccountId, now: u64) -> Vec<u8> {
        let mut input = Vec::with_capacity(96);
        input.extend_from_slice(&env::random_seed());
        input.extend_from_slice(token_id.as_bytes());
        input.extend_from_slice(&nonce.to_le_bytes());
        input.extend_from_slice(sender.as_bytes());
        input.extend_from_slice(&now.to_le_bytes());
        env::sha256(&input)
    }

    fn metadata_for(&self, pixel: &Pixel) -> TokenMetadata {
        let media = format!(
            "{}/{}/{}.svg",
            self.renderer_base.trim_end_matches('/'),
            env::current_account_id(),
            pixel.token_id
        );
        let vault = self.vaults.get(&pixel.token_id).cloned().unwrap_or_default();
        let extra = json!({
            "genome": pixel.genome,
            "rarity": pixel.rarity,
            "mutation_count": pixel.mutation_count,
            "no_change_streak": pixel.no_change_streak,
            "name": pixel.name,
            "lore": pixel.lore,
            "last_outcome": pixel.last_outcome,
            "vault_near": U128(vault.near_amount),
            "vault_mut": U128(vault.mut_amount),
            "vault_near_earned": U128(vault.near_earned),
            "vault_mut_earned": U128(vault.mut_earned),
            "holder_controls_vault": true,
        })
        .to_string();

        TokenMetadata {
            title: Some(pixel.name.clone()),
            description: Some(pixel.lore.clone()),
            media: Some(media),
            media_hash: None,
            copies: Some(1),
            issued_at: Some(pixel.minted_at.to_string()),
            expires_at: None,
            starts_at: None,
            updated_at: Some(now_secs().to_string()),
            extra: Some(extra),
            reference: None,
            reference_hash: None,
        }
    }

    fn pixel_view(&self, pixel: &Pixel, owner: AccountId) -> PixelView {
        let vault = self.vaults.get(&pixel.token_id).cloned().unwrap_or_default();
        PixelView {
            token_id: pixel.token_id.clone(),
            owner_id: owner,
            genome: pixel.genome.clone(),
            rarity: pixel.rarity,
            mutation_count: pixel.mutation_count,
            no_change_streak: pixel.no_change_streak,
            minted_at: pixel.minted_at,
            last_mutation_at: pixel.last_mutation_at,
            name: pixel.name.clone(),
            lore: pixel.lore.clone(),
            last_outcome: pixel.last_outcome.clone(),
            media: format!(
                "{}/{}/{}.svg",
                self.renderer_base.trim_end_matches('/'),
                env::current_account_id(),
                pixel.token_id
            ),
            vault_near: U128(vault.near_amount),
            vault_mut: U128(vault.mut_amount),
        }
    }
}

// -------------------------------------------------------------------------
// NEP-171 core / transfers / approvals / enumeration / metadata
// -------------------------------------------------------------------------

#[near]
impl NonFungibleTokenCore for Contract {
    #[payable]
    fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
    ) {
        let previous_owner = self
            .tokens
            .owner_by_id
            .get(&token_id)
            .expect("token not found")
            .clone();
        self.tokens.nft_transfer(
            receiver_id.clone(),
            token_id.clone(),
            approval_id,
            memo.clone(),
        );
        self.record_transfer(&token_id, &previous_owner, &receiver_id, memo);
    }

    #[payable]
    fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<bool> {
        let previous_owner = self
            .tokens
            .owner_by_id
            .get(&token_id)
            .expect("token not found")
            .clone();
        let result = self.tokens.nft_transfer_call(
            receiver_id.clone(),
            token_id.clone(),
            approval_id,
            memo.clone(),
            msg,
        );
        self.record_transfer(&token_id, &previous_owner, &receiver_id, memo);
        result
    }

    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.tokens.nft_token(token_id)
    }
}

#[near]
impl NonFungibleTokenResolver for Contract {
    #[private]
    fn nft_resolve_transfer(
        &mut self,
        previous_owner_id: AccountId,
        receiver_id: AccountId,
        token_id: TokenId,
        approved_account_ids: Option<HashMap<AccountId, u64>>,
    ) -> bool {
        let success = self.tokens.nft_resolve_transfer(
            previous_owner_id.clone(),
            receiver_id.clone(),
            token_id.clone(),
            approved_account_ids,
        );
        if !success {
            self.push_history(
                &token_id,
                HistoryRecord {
                    at: now_secs(),
                    kind: "transfer_reverted".to_string(),
                    from: Some(receiver_id),
                    to: Some(previous_owner_id),
                    near_amount: 0,
                    mut_amount: 0,
                    note: "nft_transfer_call failed; ownership returned to the seller"
                        .to_string(),
                },
            );
        }
        success
    }
}

#[near]
impl NonFungibleTokenApproval for Contract {
    #[payable]
    fn nft_approve(
        &mut self,
        token_id: TokenId,
        account_id: AccountId,
        msg: Option<String>,
    ) -> Option<Promise> {
        self.tokens.nft_approve(token_id, account_id, msg)
    }

    #[payable]
    fn nft_revoke(&mut self, token_id: TokenId, account_id: AccountId) {
        self.tokens.nft_revoke(token_id, account_id);
    }

    #[payable]
    fn nft_revoke_all(&mut self, token_id: TokenId) {
        self.tokens.nft_revoke_all(token_id);
    }

    fn nft_is_approved(
        &self,
        token_id: TokenId,
        approved_account_id: AccountId,
        approval_id: Option<u64>,
    ) -> bool {
        self.tokens
            .nft_is_approved(token_id, approved_account_id, approval_id)
    }
}

#[near]
impl NonFungibleTokenEnumeration for Contract {
    fn nft_total_supply(&self) -> U128 {
        self.tokens.nft_total_supply()
    }

    fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.tokens.nft_tokens(from_index, limit)
    }

    fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        self.tokens.nft_supply_for_owner(account_id)
    }

    fn nft_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<U128>,
        limit: Option<u64>,
    ) -> Vec<Token> {
        self.tokens
            .nft_tokens_for_owner(account_id, from_index, limit)
    }
}

#[near]
impl NonFungibleTokenMetadataProvider for Contract {
    fn nft_metadata(&self) -> NFTContractMetadata {
        self.metadata
            .get()
            .clone()
            .expect("contract metadata missing")
    }
}

// -------------------------------------------------------------------------
// Migration support
// -------------------------------------------------------------------------

/// Exact v1 state layout. Only used by `migrate`.
#[derive(BorshSerialize, BorshDeserialize)]
struct ContractV1 {
    tokens: NonFungibleToken,
    metadata: LazyOption<NFTContractMetadata>,
    owner_id: AccountId,
    mut_token: AccountId,
    mint_price: u128,
    mutation_cost: u128,
    renderer_base: String,
    pixels: LookupMap<TokenId, Pixel>,
    pixel_ids: IterableSet<TokenId>,
    next_id: u64,
    total_mutations: u64,
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

const PREFIXES: [&str; 8] = [
    "Neon", "Glitch", "Moss", "Solar", "Void", "Candy", "Rust", "Pixel",
];
const NOUNS: [&str; 8] = [
    "Wisp", "Golem", "Moth", "Slime", "Sprite", "Crab", "Fox", "Orb",
];

fn pixel_name(genome: &[u8]) -> String {
    format!(
        "{} {}",
        PREFIXES[(genome[0] % 8) as usize],
        NOUNS[(genome[1] % 8) as usize]
    )
}

fn pixel_lore(genome: &[u8], rarity: u8, mutations: u32) -> String {
    let temperament = [
        "patient", "restless", "curious", "feral", "gentle", "sly", "loud", "quiet",
    ][(genome[2] % 8) as usize];
    let aura = [
        "static",
        "moss",
        "copper",
        "moonlight",
        "ink",
        "sugar",
        "rust",
        "neon",
    ][(genome[3] % 8) as usize];
    format!(
        "A {temperament} pixel creature with a {aura} aura. Rarity {rarity}, {mutations} mutations survived."
    )
}

fn initial_rarity(seed: &[u8]) -> u8 {
    let roll = u16::from_le_bytes([seed[2], seed[3]]) % 100;
    if roll < 70 {
        1
    } else if roll < 95 {
        2
    } else {
        3
    }
}

fn mutate_genes(genome: &mut [u8], count: usize, seed: &[u8]) {
    for i in 0..count {
        let index = (seed[4 + i] as usize) % genome.len();
        let value = genome[index];
        genome[index] = (value + 1 + (seed[12 + i] % 7)) % 8;
    }
}

fn now_secs() -> u64 {
    env::block_timestamp() / 1_000_000_000
}

fn emit(event: &str, data: Value) {
    let payload = json!({
        "standard": "mutapixels",
        "version": "2.0.0",
        "event": event,
        "data": data,
    });
    env::log_str(&format!("EVENT_JSON:{}", payload));
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const MINT_PRICE: u128 = 500_000_000_000_000_000_000_000; // 0.5 NEAR
    const MUTATION_COST: u128 = 10_000_000_000_000_000_000_000_000; // 10 MUT
    const ONE_NEAR: u128 = 1_000_000_000_000_000_000_000_000;
    const ONE_YOCTO: u128 = 1;

    fn owner() -> AccountId {
        "owner.testnet".parse().unwrap()
    }

    fn alice() -> AccountId {
        "alice.testnet".parse().unwrap()
    }

    fn bob() -> AccountId {
        "bob.testnet".parse().unwrap()
    }

    fn carol() -> AccountId {
        "carol.testnet".parse().unwrap()
    }

    fn mut_token() -> AccountId {
        "mut.testnet".parse().unwrap()
    }

    fn ctx(predecessor: AccountId, deposit: u128) -> VMContextBuilder {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id("nft.testnet".parse().unwrap())
            .predecessor_account_id(predecessor)
            .account_balance(NearToken::from_near(100))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .block_timestamp(1_700_000_000_000_000_000);
        builder
    }

    fn contract() -> Contract {
        testing_env!(ctx(owner(), 0).build());
        Contract::new(
            owner(),
            mut_token(),
            U128(MINT_PRICE),
            U128(MUTATION_COST),
            "http://localhost:8788/api/render".to_string(),
        )
    }

    fn mint_pixel(c: &mut Contract) -> TokenId {
        testing_env!(ctx(alice(), MINT_PRICE).build());
        c.mint()
    }

    fn vault_of(c: &Contract, token_id: &TokenId) -> Vault {
        c.vault_for(token_id)
    }

    fn mutate(c: &mut Contract, token_id: &TokenId, amount: u128) {
        testing_env!(ctx(mut_token(), 1).build());
        let result = c.ft_on_transfer(
            alice(),
            U128(amount),
            format!("{{\"token_id\":\"{}\"}}", token_id),
        );
        assert!(matches!(result, PromiseOrValue::Value(U128(0))));
    }

    // ------------------------------------------------------------------
    // Mint / vault seeding
    // ------------------------------------------------------------------

    #[test]
    fn mint_creates_pixel_with_metadata_and_vault_seed() {
        let mut c = contract();
        let id = mint_pixel(&mut c);
        let pixel = c.get_pixel(id.clone()).unwrap();
        assert_eq!(pixel.owner_id, alice());
        assert_eq!(pixel.genome.len(), 8);
        assert!(c.nft_token(id.clone()).unwrap().metadata.is_some());

        let expected_seed = MINT_PRICE * VAULT_SEED_BPS as u128 / BPS_DENOM;
        let vault = c.get_vault(id.clone()).unwrap();
        assert_eq!(vault.near_amount.0, expected_seed);
        assert_eq!(vault.near_earned.0, expected_seed);
        assert_eq!(vault.mut_amount.0, 0);
        assert_eq!(c.treasury_near, MINT_PRICE - expected_seed);
        assert_eq!(c.total_vault_near, expected_seed);
        assert_eq!(c.get_pixel_count(), 1);

        let history = c.get_history(id, None, None);
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].kind, "mint");
        assert_eq!(history[0].near_amount.0, expected_seed);
    }

    #[test]
    fn mint_refunds_excess_above_price_without_touching_price() {
        let mut c = contract();
        testing_env!(ctx(alice(), MINT_PRICE + ONE_NEAR).build());
        let id = c.mint();
        // The full mint price is retained; only the excess is promised back.
        assert_eq!(
            c.get_vault(id.clone()).unwrap().near_amount.0,
            MINT_PRICE * VAULT_SEED_BPS as u128 / BPS_DENOM
        );
        assert_eq!(
            c.treasury_near,
            MINT_PRICE - MINT_PRICE * VAULT_SEED_BPS as u128 / BPS_DENOM
        );
    }

    // ------------------------------------------------------------------
    // Tips
    // ------------------------------------------------------------------

    #[test]
    fn near_tip_credits_pixel_vault_and_history() {
        let mut c = contract();
        let id = mint_pixel(&mut c);
        let before = vault_of(&c, &id).near_amount;

        testing_env!(ctx(bob(), ONE_NEAR).build());
        c.tip(id.clone());

        let vault = vault_of(&c, &id);
        assert_eq!(vault.near_amount, before + ONE_NEAR);
        assert_eq!(vault.near_earned, before + ONE_NEAR);
        assert_eq!(c.total_tips_near, ONE_NEAR);
        assert_eq!(c.total_vault_near, before + ONE_NEAR);

        let history = c.get_history(id, None, None);
        assert_eq!(history[0].kind, "tip");
        assert_eq!(history[0].near_amount.0, ONE_NEAR);
        assert_eq!(history[0].from, Some(bob()));
    }

    #[test]
    fn mut_tip_credits_vault_and_returns_zero() {
        let mut c = contract();
        let id = mint_pixel(&mut c);
        testing_env!(ctx(mut_token(), 1).build());
        let result = c.ft_on_transfer(
            bob(),
            U128(5_000_000_000_000_000_000_000_000),
            format!("{{\"tip\":\"{}\"}}", id),
        );
        assert!(matches!(result, PromiseOrValue::Value(U128(0))));
        assert_eq!(vault_of(&c, &id).mut_amount, 5_000_000_000_000_000_000_000_000);
        assert_eq!(c.total_tips_mut, 5_000_000_000_000_000_000_000_000);
        assert_eq!(c.get_history(id, None, None)[0].kind, "tip");
    }

    #[test]
    fn mut_tip_unknown_token_is_refunded() {
        let mut c = contract();
        testing_env!(ctx(mut_token(), 1).build());
        let result = c.ft_on_transfer(bob(), U128(1_000), "{\"tip\":\"999\"}".to_string());
        assert!(matches!(result, PromiseOrValue::Value(amount) if amount.0 == 1_000));
    }

    // ------------------------------------------------------------------
    // Mutations and fee split
    // ------------------------------------------------------------------

    #[test]
    fn mutation_is_paid_in_mut_and_splits_fee() {
        let mut c = contract();
        let id = mint_pixel(&mut c);
        let before = c.get_pixel(id.clone()).unwrap();

        mutate(&mut c, &id, MUTATION_COST);

        let after = c.get_pixel(id.clone()).unwrap();
        assert_eq!(after.mutation_count, 1);
        assert!(after.genome != before.genome || after.last_outcome == "none");

        let vault_share = MUTATION_COST * MUTATION_VAULT_BPS as u128 / BPS_DENOM;
        let treasury_share = MUTATION_COST * MUTATION_TREASURY_BPS as u128 / BPS_DENOM;
        assert_eq!(vault_of(&c, &id).mut_amount, vault_share);
        assert_eq!(c.treasury_mut, treasury_share);
        assert_eq!(c.total_vault_mut, vault_share);
        assert_eq!(c.total_royalty_mut, vault_share);
        assert_eq!(c.get_history(id, None, None)[0].kind, "royalty");
    }

    #[test]
    fn wrong_payment_is_refunded() {
        let mut c = contract();
        let id = mint_pixel(&mut c);
        testing_env!(ctx(mut_token(), 1).build());
        let result = c.ft_on_transfer(alice(), U128(1), format!("{{\"token_id\":\"{id}\"}}"));
        assert!(matches!(result, PromiseOrValue::Value(amount) if amount.0 == 1));
    }

    #[test]
    fn non_owner_cannot_mutate_token() {
        let mut c = contract();
        let id = mint_pixel(&mut c);
        testing_env!(ctx(mut_token(), 1).build());
        let result = c.ft_on_transfer(
            "attacker.testnet".parse().unwrap(),
            U128(MUTATION_COST),
            format!("{{\"token_id\":\"{id}\"}}"),
        );
        assert!(matches!(result, PromiseOrValue::Value(_)));
    }

    #[test]
    #[should_panic(expected = "only $MUT can call this")]
    fn non_mut_contract_cannot_call_ft_on_transfer() {
        let mut c = contract();
        let id = mint_pixel(&mut c);
        testing_env!(ctx(carol(), 1).build());
        c.ft_on_transfer(
            alice(),
            U128(MUTATION_COST),
            format!("{{\"token_id\":\"{id}\"}}"),
        );
    }

    // ------------------------------------------------------------------
    // Transfers and per-token control
    // ------------------------------------------------------------------

    #[test]
    fn transfer_moves_vault_control_to_new_holder() {
        let mut c = contract();
        let id = mint_pixel(&mut c);
        testing_env!(ctx(bob(), ONE_NEAR).build());
        c.tip(id.clone());

        testing_env!(ctx(alice(), ONE_YOCTO).build());
        c.nft_transfer(bob(), id.clone(), None, None);
        assert_eq!(c.get_pixel(id.clone()).unwrap().owner_id, bob());
        assert_eq!(c.get_vault(id.clone()).unwrap().owner_id, bob());

        let kinds: Vec<String> = c
            .get_history(id.clone(), None, None)
            .iter()
            .map(|entry| entry.kind.clone())
            .collect();
        assert!(kinds.iter().any(|kind| kind == "transfer"));

        testing_env!(ctx(bob(), 0).build());
        c.withdraw_vault(id, U128(ONE_NEAR), U128(0));
        assert_eq!(c.total_vault_near, MINT_PRICE * VAULT_SEED_BPS as u128 / BPS_DENOM);
    }

    #[test]
    #[should_panic(expected = "only the current holder can withdraw")]
    fn previous_owner_cannot_withdraw_after_transfer() {
        let mut c = contract();
        let id = mint_pixel(&mut c);
        testing_env!(ctx(alice(), ONE_YOCTO).build());
        c.nft_transfer(bob(), id.clone(), None, None);
        testing_env!(ctx(alice(), 0).build());
        c.withdraw_vault(id, U128(1), U128(0));
    }

    #[test]
    fn sale_in_the_middle_of_a_payout_restores_funds_to_the_new_holder() {
        let mut c = contract();
        let id = mint_pixel(&mut c);

        // Fund the vault with MUT and have Alice request a MUT withdrawal,
        // which is now pending on a cross-contract ft_transfer.
        let tip: u128 = 5_000_000_000_000_000_000_000_000;
        testing_env!(ctx(mut_token(), 1).build());
        let _ = c.ft_on_transfer(bob(), U128(tip), format!("{{\"tip\":\"{id}\"}}"));

        testing_env!(ctx(alice(), 0).build());
        let withdrawal_id = c.next_withdrawal_id;
        c.withdraw_vault(id.clone(), U128(0), U128(tip));
        assert_eq!(vault_of(&c, &id).mut_amount, 0);
        assert_eq!(c.pending_mut_total, tip);

        // Alice sells the NFT while the payout promise is still in flight.
        testing_env!(ctx(alice(), ONE_YOCTO).build());
        c.nft_transfer(bob(), id.clone(), None, None);

        // The FT transfer failed (e.g. receiver has no $MUT storage). The
        // callback restores the amount to the token vault — now Bob's vault.
        let restored = c.finalize_withdrawal(withdrawal_id, false);
        assert!(!restored);
        assert_eq!(vault_of(&c, &id).mut_amount, tip);
        assert_eq!(c.pending_mut_total, 0);
        assert_eq!(c.get_vault(id.clone()).unwrap().owner_id, bob());

        // Bob can withdraw the restored funds; Alice has no claim.
        testing_env!(ctx(bob(), 0).build());
        c.withdraw_vault(id.clone(), U128(0), U128(tip));
        assert_eq!(vault_of(&c, &id).mut_amount, 0);
        assert_eq!(
            c.get_history(id, None, None)[0].kind,
            "withdraw"
        );
    }

    #[test]
    fn successful_withdraw_callback_does_not_restore_funds() {
        let mut c = contract();
        let id = mint_pixel(&mut c);
        let tip: u128 = 5_000_000_000_000_000_000_000_000;

        testing_env!(ctx(mut_token(), 1).build());
        let _ = c.ft_on_transfer(bob(), U128(tip), format!("{{\"tip\":\"{id}\"}}"));

        testing_env!(ctx(alice(), 0).build());
        let withdrawal_id = c.next_withdrawal_id;
        c.withdraw_vault(id.clone(), U128(0), U128(tip));
        assert_eq!(c.pending_mut_total, tip);

        // A successful FT transfer keeps the withdrawal final and does not
        // restore the vault balance.
        assert!(c.finalize_withdrawal(withdrawal_id, true));
        assert_eq!(vault_of(&c, &id).mut_amount, 0);
        assert_eq!(c.pending_mut_total, 0);
        assert_eq!(c.get_history(id, None, None)[0].kind, "withdraw");
    }

    #[test]
    fn approvals_do_not_grant_vault_access_and_are_cleared_on_transfer() {
        let mut c = contract();
        let id = mint_pixel(&mut c);

        testing_env!(ctx(alice(), 100_000_000_000_000_000_000_000).build());
        c.nft_approve(id.clone(), bob(), None);
        assert!(c.nft_is_approved(id.clone(), bob(), None));

        testing_env!(ctx(alice(), ONE_YOCTO).build());
        c.nft_transfer(carol(), id.clone(), None, None);
        assert!(!c.nft_is_approved(id.clone(), bob(), None));
        assert_eq!(c.get_pixel(id).unwrap().owner_id, carol());
    }

    #[test]
    #[should_panic(expected = "only the current holder can withdraw")]
    fn approved_account_cannot_withdraw_vault() {
        let mut c = contract();
        let id = mint_pixel(&mut c);
        testing_env!(ctx(alice(), 100_000_000_000_000_000_000_000).build());
        c.nft_approve(id.clone(), bob(), None);

        testing_env!(ctx(bob(), 0).build());
        c.withdraw_vault(id, U128(1), U128(0));
    }

    // ------------------------------------------------------------------
    // Treasury isolation
    // ------------------------------------------------------------------

    #[test]
    fn owner_withdraws_only_the_treasury_share() {
        let mut c = contract();
        let _id = mint_pixel(&mut c);
        let treasury = c.treasury_near;
        assert!(treasury > 0);

        testing_env!(ctx(owner(), 0).build());
        c.withdraw_near(owner(), U128(treasury));
        assert_eq!(c.treasury_near, 0);
        assert_eq!(
            c.total_vault_near,
            MINT_PRICE * VAULT_SEED_BPS as u128 / BPS_DENOM
        );
    }

    #[test]
    #[should_panic(expected = "amount exceeds club treasury")]
    fn owner_cannot_drain_pixel_vaults() {
        let mut c = contract();
        let _id = mint_pixel(&mut c);
        testing_env!(ctx(owner(), 0).build());
        c.withdraw_near(owner(), U128(c.treasury_near + 1));
    }

    #[test]
    #[should_panic(expected = "withdrawal would leave pixel vaults unfunded")]
    fn treasury_withdrawal_respects_vault_solvency() {
        let mut c = contract();
        let _id = mint_pixel(&mut c);
        let mut builder = ctx(owner(), 0);
        builder.account_balance(NearToken::from_yoctonear(1));
        testing_env!(builder.build());
        c.withdraw_near(owner(), U128(1));
    }

    // ------------------------------------------------------------------
    // History and stats
    // ------------------------------------------------------------------

    #[test]
    fn history_records_earnings_payouts_and_holders_newest_first() {
        let mut c = contract();
        let id = mint_pixel(&mut c);

        testing_env!(ctx(bob(), ONE_NEAR).build());
        c.tip(id.clone());

        testing_env!(ctx(mut_token(), 1).build());
        let _ = c.ft_on_transfer(
            alice(),
            U128(MUTATION_COST),
            format!("{{\"token_id\":\"{id}\"}}"),
        );

        testing_env!(ctx(alice(), ONE_YOCTO).build());
        c.nft_transfer(bob(), id.clone(), None, None);

        let history = c.get_history(id.clone(), None, None);
        let kinds: Vec<&str> = history.iter().map(|entry| entry.kind.as_str()).collect();
        assert_eq!(kinds[0], "transfer");
        assert!(kinds.contains(&"royalty"));
        assert!(kinds.contains(&"tip"));
        assert_eq!(kinds.last(), Some(&"mint"));

        let page_one = c.get_history(id.clone(), Some(U128(1)), Some(2));
        assert_eq!(page_one.len(), 2);
        assert_eq!(page_one[0].kind, history[1].kind);

        let stats = c.get_vault_stats();
        assert_eq!(stats.total_tips_near.0, ONE_NEAR);
        assert!(stats.total_royalty_mut.0 > 0);
        assert!(stats.near_balance.0 >= stats.total_vault_near.0);
    }

    #[test]
    fn is_holder_tracks_current_owner() {
        let mut c = contract();
        let id = mint_pixel(&mut c);
        assert!(c.is_holder(id.clone(), alice()));
        assert!(!c.is_holder(id.clone(), bob()));

        testing_env!(ctx(alice(), ONE_YOCTO).build());
        c.nft_transfer(bob(), id.clone(), None, None);
        assert!(!c.is_holder(id.clone(), alice()));
        assert!(c.is_holder(id.clone(), bob()));
    }

    #[test]
    fn migration_reads_v1_state_and_initializes_v2_accounting() {
        testing_env!(ctx(owner(), 0).build());
        let v1 = ContractV1 {
            tokens: NonFungibleToken::new(
                StorageKey::Tokens,
                owner(),
                Some(StorageKey::TokenMetadata),
                Some(StorageKey::Enumeration),
                None::<StorageKey>,
            ),
            metadata: LazyOption::new(
                StorageKey::ContractMetadata,
                Some(NFTContractMetadata {
                    spec: NFT_METADATA_SPEC.to_string(),
                    name: "Mutapixels".to_string(),
                    symbol: "PIXEL".to_string(),
                    icon: None,
                    base_uri: None,
                    reference: None,
                    reference_hash: None,
                }),
            ),
            owner_id: owner(),
            mut_token: mut_token(),
            mint_price: MINT_PRICE,
            mutation_cost: MUTATION_COST,
            renderer_base: "http://localhost:8788/api/render".to_string(),
            pixels: LookupMap::new(StorageKey::Pixels),
            pixel_ids: IterableSet::new(StorageKey::PixelIds),
            next_id: 7,
            total_mutations: 3,
        };
        env::state_write(&v1);

        let migrated = Contract::migrate();
        assert_eq!(migrated.owner_id, owner());
        assert_eq!(migrated.mut_token, mut_token());
        assert_eq!(migrated.mint_price, MINT_PRICE);
        assert_eq!(migrated.mutation_cost, MUTATION_COST);
        assert_eq!(migrated.next_id, 7);
        assert_eq!(migrated.total_mutations, 3);
        assert_eq!(migrated.total_vault_near, 0);
        assert_eq!(migrated.treasury_mut, 0);
        assert!(migrated.tokens.approvals_by_id.is_some());
        assert!(migrated.tokens.next_approval_id_by_id.is_some());
    }

    #[test]
    #[should_panic(expected = "only the owner can migrate")]
    fn migration_is_owner_only() {
        testing_env!(ctx(owner(), 0).build());
        let v1 = ContractV1 {
            tokens: NonFungibleToken::new(
                StorageKey::Tokens,
                owner(),
                Some(StorageKey::TokenMetadata),
                Some(StorageKey::Enumeration),
                None::<StorageKey>,
            ),
            metadata: LazyOption::new(
                StorageKey::ContractMetadata,
                Some(NFTContractMetadata {
                    spec: NFT_METADATA_SPEC.to_string(),
                    name: "Mutapixels".to_string(),
                    symbol: "PIXEL".to_string(),
                    icon: None,
                    base_uri: None,
                    reference: None,
                    reference_hash: None,
                }),
            ),
            owner_id: owner(),
            mut_token: mut_token(),
            mint_price: MINT_PRICE,
            mutation_cost: MUTATION_COST,
            renderer_base: "http://localhost:8788/api/render".to_string(),
            pixels: LookupMap::new(StorageKey::Pixels),
            pixel_ids: IterableSet::new(StorageKey::PixelIds),
            next_id: 1,
            total_mutations: 0,
        };
        env::state_write(&v1);
        testing_env!(ctx(alice(), 0).build());
        let _ = Contract::migrate();
    }

    #[test]
    fn owner_can_refresh_token_metadata_after_renderer_change() {
        let mut c = contract();
        let id = mint_pixel(&mut c);

        testing_env!(ctx(owner(), 0).build());
        c.set_renderer_base("https://render.example/api/render".to_string());
        let refreshed = c.refresh_metadata_batch(None, Some(10));
        assert_eq!(refreshed, 1);

        let metadata = c.nft_token(id).unwrap().metadata.unwrap();
        assert!(metadata
            .media
            .unwrap()
            .starts_with("https://render.example/api/render"));
        assert!(metadata.extra.unwrap().contains("vault_near"));
    }

    #[test]
    fn config_exposes_split_schedule() {
        let c = contract();
        let config = c.get_config();
        assert_eq!(
            (config.mutation_vault_bps + config.mutation_treasury_bps + config.mutation_burn_bps)
                as u128,
            BPS_DENOM
        );
        assert_eq!(config.vault_seed_bps, VAULT_SEED_BPS);
        assert!(config.vault_seed_bps < BPS_DENOM as u16);
    }
}
