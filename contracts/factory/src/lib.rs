#![no_std]
use soroban_sdk::{
    contract, contractclient, contractimpl, BytesN, Address, Env, String, Symbol, Vec
};

#[contractclient(name = "CampaignClient")]
pub trait CampaignContractTrait {
    fn initialize(
        env: Env,
        creator: Address,
        token: Address,
        goal: i128,
        deadline: u64,
        metadata_uri: String,
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
        
        let campaigns: Vec<Address> = Vec::new(&env);
        env.storage().instance().set(&Symbol::new(&env, "campaigns"), &campaigns);

        env.storage().instance().extend_ttl(1000, 50000);
    }

    pub fn create_campaign(
        env: Env,
        creator: Address,
        token: Address,
        goal: i128,
        duration_secs: u64,
        metadata_uri: String,
    ) -> Address {
        env.storage().instance().extend_ttl(1000, 50000);

        let wasm_hash: BytesN<32> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "wasm"))
            .expect("factory not initialized");

        let mut campaigns: Vec<Address> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "campaigns"))
            .unwrap_or_else(|| Vec::new(&env));

        // Use the length of campaigns as a salt index for deterministic deployment
        let index = campaigns.len();
        let mut salt_arr = [0u8; 32];
        salt_arr[0..4].copy_from_slice(&index.to_be_bytes());
        let salt = BytesN::from_array(&env, &salt_arr);

        // Deploy campaign contract using deployer
        let campaign_address = env
            .deployer()
            .with_current_contract(salt)
            .deploy(wasm_hash);

        // Initialize the deployed campaign
        let deadline = env.ledger().timestamp() + duration_secs;
        let client = CampaignClient::new(&env, &campaign_address);
        client.initialize(
            &creator,
            &token,
            &goal,
            &deadline,
            &metadata_uri,
        );

        // Record the contract address
        campaigns.push_back(campaign_address.clone());
        env.storage().instance().set(&Symbol::new(&env, "campaigns"), &campaigns);

        // Emit campaign_created event
        env.events().publish(
            (Symbol::new(&env, "campaign_created"), creator, campaign_address.clone()),
            (goal, deadline, metadata_uri),
        );

        campaign_address
    }

    pub fn list_campaigns(env: Env) -> Vec<Address> {
        env.storage().instance().extend_ttl(1000, 50000);
        env.storage()
            .instance()
            .get(&Symbol::new(&env, "campaigns"))
            .unwrap_or_else(|| Vec::new(&env))
    }
}

#[cfg(test)]
mod test;
