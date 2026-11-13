use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::borsh::BorshSerialize;
use near_sdk::json_types::U128;
use near_sdk::store::LazyOption;
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue,
};

#[derive(BorshStorageKey, BorshSerialize)]
pub enum StorageKey {
    Token,
    Metadata,
}

/// `$MUT` is the mutation fuel. It is intentionally a plain NEP-141 token so
/// Ref Finance can create a pool against it without custom adapters.
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    token: FungibleToken,
    metadata: LazyOption<FungibleTokenMetadata>,
    owner_id: AccountId,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner_id: AccountId, total_supply: U128) -> Self {
        let mut token = FungibleToken::new(StorageKey::Token);
        token.internal_register_account(&owner_id);
        token.internal_deposit(&owner_id, total_supply.0);

        let metadata = FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Mutapixels".to_string(),
            symbol: "MUT".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 24,
        };
        metadata.assert_valid();

        Self {
            token,
            metadata: LazyOption::new(StorageKey::Metadata, Some(metadata)),
            owner_id,
        }
    }

    /// Owner-only issuance for the initial Ref pool / demo distribution.
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "Only owner can mint"
        );
        if !self.token.accounts.contains_key(&account_id) {
            self.token.internal_register_account(&account_id);
        }
        self.token.internal_deposit(&account_id, amount.0);
    }

    /// Any holder can burn their own tokens. The NFT contract calls this after
    /// accepting a mutation payment.
    pub fn burn(&mut self, amount: U128) {
        require!(amount.0 > 0, "Amount must be positive");
        let account_id = env::predecessor_account_id();
        self.token.internal_withdraw(&account_id, amount.0);
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner_id.clone()
    }
}

#[near]
impl FungibleTokenCore for Contract {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo);
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Contract {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used_amount, burned_amount) =
            self.token
                .internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        if burned_amount > 0 {
            near_sdk::log!("Account @{} burned {}", sender_id, burned_amount);
        }
        used_amount.into()
    }
}

#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.get().clone().expect("metadata missing")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn owner() -> AccountId {
        "owner.testnet".parse().unwrap()
    }

    fn ctx(predecessor: AccountId, deposit: u128) -> VMContextBuilder {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id("mut.testnet".parse().unwrap())
            .predecessor_account_id(predecessor)
            .account_balance(NearToken::from_near(10))
            .attached_deposit(NearToken::from_yoctonear(deposit));
        builder
    }

    #[test]
    fn mints_initial_supply_to_owner() {
        testing_env!(ctx(owner(), 0).build());
        let contract = Contract::new(owner(), U128(1_000_000_000_000_000_000_000_000));
        assert_eq!(
            contract.ft_balance_of(owner()).0,
            1_000_000_000_000_000_000_000_000
        );
        assert_eq!(
            contract.ft_total_supply().0,
            1_000_000_000_000_000_000_000_000
        );
    }

    #[test]
    fn owner_can_mint_more() {
        testing_env!(ctx(owner(), 0).build());
        let mut contract = Contract::new(owner(), U128(100));
        contract.mint(owner(), U128(50));
        assert_eq!(contract.ft_balance_of(owner()).0, 150);
    }

    #[test]
    #[should_panic(expected = "Only owner can mint")]
    fn non_owner_cannot_mint() {
        testing_env!(ctx(owner(), 0).build());
        let mut contract = Contract::new(owner(), U128(100));
        testing_env!(ctx("attacker.testnet".parse().unwrap(), 0).build());
        contract.mint("attacker.testnet".parse().unwrap(), U128(1));
    }

    #[test]
    fn holder_can_burn() {
        testing_env!(ctx(owner(), 0).build());
        let mut contract = Contract::new(owner(), U128(100));
        contract.burn(U128(40));
        assert_eq!(contract.ft_balance_of(owner()).0, 60);
        assert_eq!(contract.ft_total_supply().0, 60);
    }
}
