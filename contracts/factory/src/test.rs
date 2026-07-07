#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String};

mod auction_wasm {
    soroban_sdk::contractimport!(
        file = "../../target/wasm32v1-none/release/auction_contract.wasm"
    );
}

#[test]
fn test_factory_deploy_auction() {
    let env = Env::default();
    env.mock_all_auths();

    // Deploy factory
    let factory_addr = env.register_contract(None, FactoryContract);
    let factory_client = FactoryContractClient::new(&env, &factory_addr);

    // Install auction wasm and initialize factory with its hash
    let wasm_hash = env.deployer().upload_contract_wasm(auction_wasm::WASM);
    factory_client.init(&wasm_hash);

    let seller = Address::generate(&env);
    let token = Address::generate(&env);
    let item_name = String::from_str(&env, "Item A");
    let metadata_uri = String::from_str(&env, "ipfs://metadata");
    let reserve_price = 1000i128;
    let duration = 3600u64;

    // Create auction
    let auction_addr = factory_client.create_auction(
        &seller,
        &token,
        &item_name,
        &metadata_uri,
        &reserve_price,
        &duration,
    );

    // Verify it is in the list
    let auctions = factory_client.list_auctions();
    assert_eq!(auctions.len(), 1);
    assert_eq!(auctions.get(0).unwrap(), auction_addr);

    // Interact with the deployed auction to verify it is initialized correctly
    let auction_client = auction_wasm::Client::new(&env, &auction_addr);
    let status = auction_client.get_status();
    assert_eq!(status.seller, seller);
    assert_eq!(status.token, token);
    assert_eq!(status.item_name, item_name);
    assert_eq!(status.reserve_price, reserve_price);
    assert_eq!(status.ended, false);
}
