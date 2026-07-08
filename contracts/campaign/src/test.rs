#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String
};

fn setup_test(env: &Env) -> (Address, Address, Address, Address, CampaignContractClient, token::Client, token::StellarAssetClient) {
    env.mock_all_auths();

    let creator = Address::generate(env);
    let donor1 = Address::generate(env);
    let donor2 = Address::generate(env);
    let token_admin = Address::generate(env);

    // Register standard token contract
    let sac = env.register_stellar_asset_contract_v2(token_admin);
    let token_addr = sac.address();
    let token_client = token::Client::new(env, &token_addr);
    let token_admin_client = token::StellarAssetClient::new(env, &token_addr);

    // Register campaign contract
    let campaign_addr = env.register_contract(None, CampaignContract);
    let campaign_client = CampaignContractClient::new(env, &campaign_addr);

    // Mint test balances
    token_admin_client.mint(&donor1, &1000i128);
    token_admin_client.mint(&donor2, &2000i128);

    (creator, donor1, donor2, token_addr, campaign_client, token_client, token_admin_client)
}

#[test]
fn test_successful_contribution() {
    let env = Env::default();
    let (creator, donor1, _, token_addr, client, token_client, _) = setup_test(&env);

    let goal = 1500i128;
    let deadline = 1000u64; // seconds
    let metadata = String::from_str(&env, "ipfs://campaign-meta");

    env.ledger().set_timestamp(100);

    // Initialize campaign
    client.initialize(&creator, &token_addr, &goal, &deadline, &metadata);

    // Contribute
    client.contribute(&donor1, &400i128);

    // Check progress
    let status = client.get_status();
    assert_eq!(status.raised, 400i128);
    assert_eq!(status.goal_met, false);
    assert_eq!(token_client.balance(&client.address), 400i128);
}

#[test]
#[should_panic(expected = "campaign deadline passed")]
fn test_contribution_after_deadline_fails() {
    let env = Env::default();
    let (creator, donor1, _, token_addr, client, _, _) = setup_test(&env);

    let goal = 1500i128;
    let deadline = 1000u64;
    let metadata = String::from_str(&env, "ipfs://campaign-meta");

    env.ledger().set_timestamp(100);
    client.initialize(&creator, &token_addr, &goal, &deadline, &metadata);

    // Move ledger time past deadline
    env.ledger().set_timestamp(deadline + 10);

    // Should fail
    client.contribute(&donor1, &200i128);
}

#[test]
#[should_panic(expected = "campaign goal not met")]
fn test_withdrawal_before_goal_met_fails() {
    let env = Env::default();
    let (creator, donor1, _, token_addr, client, _, _) = setup_test(&env);

    let goal = 1500i128;
    let deadline = 1000u64;
    let metadata = String::from_str(&env, "ipfs://campaign-meta");

    env.ledger().set_timestamp(100);
    client.initialize(&creator, &token_addr, &goal, &deadline, &metadata);

    client.contribute(&donor1, &800i128);

    env.ledger().set_timestamp(deadline + 10);

    // Goal is 1500, only raised 800. Creator withdrawal should fail
    client.withdraw(&creator);
}

#[test]
fn test_successful_withdrawal() {
    let env = Env::default();
    let (creator, donor1, donor2, token_addr, client, token_client, _) = setup_test(&env);

    let goal = 1500i128;
    let deadline = 1000u64;
    let metadata = String::from_str(&env, "ipfs://campaign-meta");

    env.ledger().set_timestamp(100);
    client.initialize(&creator, &token_addr, &goal, &deadline, &metadata);

    // Contribute to meet goal
    client.contribute(&donor1, &800i128);
    client.contribute(&donor2, &900i128); // total = 1700

    env.ledger().set_timestamp(deadline + 10);

    // Perform withdrawal
    client.withdraw(&creator);

    // Check states
    let status = client.get_status();
    assert_eq!(status.ended, true);
    assert_eq!(token_client.balance(&client.address), 0i128);
    assert_eq!(token_client.balance(&creator), 1700i128);
}

#[test]
fn test_successful_refund() {
    let env = Env::default();
    let (creator, donor1, donor2, token_addr, client, token_client, _) = setup_test(&env);

    let goal = 1500i128;
    let deadline = 1000u64;
    let metadata = String::from_str(&env, "ipfs://campaign-meta");

    env.ledger().set_timestamp(100);
    client.initialize(&creator, &token_addr, &goal, &deadline, &metadata);

    client.contribute(&donor1, &500i128);
    client.contribute(&donor2, &600i128); // total = 1100

    env.ledger().set_timestamp(deadline + 10);

    // Claim refund for donor1
    let initial_bal = token_client.balance(&donor1);
    client.refund(&donor1);

    // Check donor1 got refunded, contract balance decreased
    assert_eq!(token_client.balance(&donor1), initial_bal + 500i128);
    assert_eq!(token_client.balance(&client.address), 600i128);
}
