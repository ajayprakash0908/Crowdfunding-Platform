#![no_std]
use soroban_sdk::{
    contract, contractclient, contractimpl, BytesN, Address, Env, String, Symbol, Vec
};

#[contractclient(name = "AuctionClient")]
pub trait AuctionContractTrait {
    fn initialize(
        env: Env,
        seller: Address,
        token: Address,
        item_name: String,
        item_metadata_uri: String,
        reserve_price: i128,
        end_time: u64,
    );
}

#[contract]
pub struct FactoryContract;

#[contractimpl]
impl FactoryContract {
    pub fn init(env: Env, wasm_hash: BytesN<32>) {
        if env.storage().instance().has(&Symbol::new(&env, "wasm")) {
            panic!("already initialized");
        }
        env.storage().instance().set(&Symbol::new(&env, "wasm"), &wasm_hash);
        
        let auctions: Vec<Address> = Vec::new(&env);
        env.storage().instance().set(&Symbol::new(&env, "auctions"), &auctions);

        env.storage().instance().extend_ttl(1000, 50000);
    }

    pub fn create_auction(
        env: Env,
        seller: Address,
        token: Address,
        item_name: String,
        item_metadata_uri: String,
        reserve_price: i128,
        duration_secs: u64,
    ) -> Address {
        env.storage().instance().extend_ttl(1000, 50000);

        let wasm_hash: BytesN<32> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "wasm"))
            .expect("factory not initialized");

        let mut auctions: Vec<Address> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "auctions"))
            .unwrap_or_else(|| Vec::new(&env));

        // Use the length of auctions as a salt index for deterministic deployment
        let index = auctions.len();
        let mut salt_arr = [0u8; 32];
        salt_arr[0..4].copy_from_slice(&index.to_be_bytes());
        let salt = BytesN::from_array(&env, &salt_arr);

        // Deploy auction contract using deployer
        let auction_address = env
            .deployer()
            .with_current_contract(salt)
            .deploy(wasm_hash);

        // Initialize the deployed auction
        let end_time = env.ledger().timestamp() + duration_secs;
        let client = AuctionClient::new(&env, &auction_address);
        client.initialize(
            &seller,
            &token,
            &item_name,
            &item_metadata_uri,
            &reserve_price,
            &end_time,
        );

        // Record the contract address
        auctions.push_back(auction_address.clone());
        env.storage().instance().set(&Symbol::new(&env, "auctions"), &auctions);

        // Emit event
        env.events().publish(
            (Symbol::new(&env, "auction_created"), seller, auction_address.clone()),
            (item_name, reserve_price, end_time),
        );

        auction_address
    }

    pub fn list_auctions(env: Env) -> Vec<Address> {
        env.storage().instance().extend_ttl(1000, 50000);
        env.storage()
            .instance()
            .get(&Symbol::new(&env, "auctions"))
            .unwrap_or_else(|| Vec::new(&env))
    }
}

#[cfg(test)]
mod test;
