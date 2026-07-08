#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String};

mod campaign_wasm {
    soroban_sdk::contractimport!(
        file = "../../target/wasm32-unknown-unknown/release/campaign_contract.wasm"
    );
}

#[test]
fn test_factory_deploy_campaign() {
    let env = Env::default();
    env.mock_all_auths();

    // Deploy factory
    let factory_addr = env.register_contract(None, FactoryContract);
    let factory_client = FactoryContractClient::new(&env, &factory_addr);

    // Install campaign wasm and initialize factory with its hash
    let wasm_hash = env.deployer().upload_contract_wasm(campaign_wasm::WASM);
    factory_client.init(&wasm_hash);

    let creator = Address::generate(&env);
    let token = Address::generate(&env);
    let goal = 5000i128;
    let duration = 3600u64;
    let metadata = String::from_str(&env, "ipfs://meta");

    // Create campaign
    let campaign_addr = factory_client.create_campaign(
        &creator,
        &token,
        &goal,
        &duration,
        &metadata,
    );

    // Verify it is in the list
    let campaigns = factory_client.list_campaigns();
    assert_eq!(campaigns.len(), 1);
    assert_eq!(campaigns.get(0).unwrap(), campaign_addr);

    // Interact with the deployed campaign to verify it is initialized correctly
    let campaign_client = campaign_wasm::Client::new(&env, &campaign_addr);
    let status = campaign_client.get_status();
    assert_eq!(status.creator, creator);
    assert_eq!(status.token, token);
    assert_eq!(status.goal, goal);
    assert_eq!(status.ended, false);
    assert_eq!(status.metadata_uri, metadata);
}
