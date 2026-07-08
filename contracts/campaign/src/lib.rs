#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, Env, String, Symbol
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CampaignStatus {
    pub raised: i128,
    pub goal: i128,
    pub deadline: u64,
    pub goal_met: bool,
    pub creator: Address,
    pub token: Address,
    pub ended: bool,
    pub metadata_uri: String,
}

#[contract]
pub struct CampaignContract;

#[contractimpl]
impl CampaignContract {
    pub fn initialize(
        env: Env,
        creator: Address,
        token: Address,
        goal: i128,
        deadline: u64,
        metadata_uri: String,
    ) {
        if env.storage().instance().has(&Symbol::new(&env, "creator")) {
            panic!("already initialized");
        }
        if goal <= 0 {
            panic!("goal must be positive");
        }
        
        env.storage().instance().set(&Symbol::new(&env, "creator"), &creator);
        env.storage().instance().set(&Symbol::new(&env, "token"), &token);
        env.storage().instance().set(&Symbol::new(&env, "goal"), &goal);
        env.storage().instance().set(&Symbol::new(&env, "deadline"), &deadline);
        env.storage().instance().set(&Symbol::new(&env, "raised"), &0i128);
        env.storage().instance().set(&Symbol::new(&env, "ended"), &false);
        env.storage().instance().set(&Symbol::new(&env, "metadata"), &metadata_uri);

        env.storage().instance().extend_ttl(1000, 50000);
    }

    pub fn contribute(env: Env, donor: Address, amount: i128) {
        donor.require_auth();
        if amount <= 0 {
            panic!("contribution amount must be positive");
        }

        let deadline: u64 = env.storage().instance().get(&Symbol::new(&env, "deadline")).unwrap();
        if env.ledger().timestamp() >= deadline {
            panic!("campaign deadline passed");
        }

        let ended: bool = env.storage().instance().get(&Symbol::new(&env, "ended")).unwrap_or(false);
        if ended {
            panic!("campaign already finalized");
        }

        let token_addr: Address = env.storage().instance().get(&Symbol::new(&env, "token")).unwrap();
        let current_contract = env.current_contract_address();

        // Cross-contract call: Move funds from donor to campaign escrow
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&donor, &current_contract, &amount);

        // Update donor contribution tracking
        let key = (Symbol::new(&env, "donor"), donor.clone());
        let mut donor_raised = env.storage().persistent().get(&key).unwrap_or(0i128);
        donor_raised += amount;
        env.storage().persistent().set(&key, &donor_raised);
        env.storage().persistent().extend_ttl(&key, 1000, 50000);

        // Update campaign totals
        let mut total_raised: i128 = env.storage().instance().get(&Symbol::new(&env, "raised")).unwrap_or(0);
        total_raised += amount;
        env.storage().instance().set(&Symbol::new(&env, "raised"), &total_raised);
        env.storage().instance().extend_ttl(1000, 50000);

        // Emit contribution event: topic=(contribution, donor), value=total_raised
        env.events().publish(
            (Symbol::new(&env, "contribution"), donor.clone()),
            total_raised
        );
    }

    pub fn withdraw(env: Env, caller: Address) {
        let creator: Address = env.storage().instance().get(&Symbol::new(&env, "creator")).unwrap();
        if caller != creator {
            panic!("only campaign creator can withdraw");
        }
        creator.require_auth();

        let deadline: u64 = env.storage().instance().get(&Symbol::new(&env, "deadline")).unwrap();
        if env.ledger().timestamp() < deadline {
            panic!("cannot withdraw before deadline");
        }

        let ended: bool = env.storage().instance().get(&Symbol::new(&env, "ended")).unwrap_or(false);
        if ended {
            panic!("campaign already ended");
        }

        let total_raised: i128 = env.storage().instance().get(&Symbol::new(&env, "raised")).unwrap_or(0);
        let goal: i128 = env.storage().instance().get(&Symbol::new(&env, "goal")).unwrap();
        if total_raised < goal {
            panic!("campaign goal not met");
        }

        // Set ended true before cross-contract transfer (reentrancy guard)
        env.storage().instance().set(&Symbol::new(&env, "ended"), &true);
        env.storage().instance().extend_ttl(1000, 50000);

        let token_addr: Address = env.storage().instance().get(&Symbol::new(&env, "token")).unwrap();
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&env.current_contract_address(), &creator, &total_raised);

        // Emit withdrawn event: topic=(withdrawn, creator), value=total_raised
        env.events().publish(
            (Symbol::new(&env, "withdrawn"), creator.clone()),
            total_raised
        );
    }

    pub fn refund(env: Env, donor: Address) {
        donor.require_auth();

        let deadline: u64 = env.storage().instance().get(&Symbol::new(&env, "deadline")).unwrap();
        if env.ledger().timestamp() < deadline {
            panic!("cannot request refund before deadline");
        }

        let total_raised: i128 = env.storage().instance().get(&Symbol::new(&env, "raised")).unwrap_or(0);
        let goal: i128 = env.storage().instance().get(&Symbol::new(&env, "goal")).unwrap();
        if total_raised >= goal {
            panic!("campaign goal met, refund not allowed");
        }

        let key = (Symbol::new(&env, "donor"), donor.clone());
        let donor_raised = env.storage().persistent().get(&key).unwrap_or(0i128);
        if donor_raised <= 0 {
            panic!("no contributions found for donor");
        }

        // Reset donor contribution to 0 before transfer (reentrancy guard)
        env.storage().persistent().set(&key, &0i128);

        let token_addr: Address = env.storage().instance().get(&Symbol::new(&env, "token")).unwrap();
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&env.current_contract_address(), &donor, &donor_raised);

        // Emit refunded event: topic=(refunded, donor), value=donor_raised
        env.events().publish(
            (Symbol::new(&env, "refunded"), donor.clone()),
            donor_raised
        );
    }

    pub fn get_status(env: Env) -> CampaignStatus {
        let raised: i128 = env.storage().instance().get(&Symbol::new(&env, "raised")).unwrap_or(0);
        let goal: i128 = env.storage().instance().get(&Symbol::new(&env, "goal")).unwrap();
        let deadline: u64 = env.storage().instance().get(&Symbol::new(&env, "deadline")).unwrap();
        let creator: Address = env.storage().instance().get(&Symbol::new(&env, "creator")).unwrap();
        let token: Address = env.storage().instance().get(&Symbol::new(&env, "token")).unwrap();
        let ended: bool = env.storage().instance().get(&Symbol::new(&env, "ended")).unwrap_or(false);
        let metadata_uri: String = env.storage().instance().get(&Symbol::new(&env, "metadata")).unwrap();

        CampaignStatus {
            raised,
            goal,
            deadline,
            goal_met: raised >= goal,
            creator,
            token,
            ended,
            metadata_uri,
        }
    }
}

mod test;
