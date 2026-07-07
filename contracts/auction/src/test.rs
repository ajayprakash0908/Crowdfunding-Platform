#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String, testutils::Ledger};

fn setup_test(env: &Env) -> (Address, Address, Address, Address, Address) {
    env.mock_all_auths();

    let seller = Address::generate(env);
    let token_admin = Address::generate(env);
    let bidder1 = Address::generate(env);
    let bidder2 = Address::generate(env);

    // Register standard token contract
    let sac = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_addr = sac.address();

    // Register auction contract
    let auction_addr = env.register_contract(None, AuctionContract);

    // Mint tokens to bidders
    let token_admin_client = token::StellarAssetClient::new(env, &token_addr);
    token_admin_client.mint(&bidder1, &10000i128);
    token_admin_client.mint(&bidder2, &20000i128);

    (seller, bidder1, bidder2, token_addr, auction_addr)
}

#[test]
fn test_successful_bid_escrow() {
    let env = Env::default();
    let (seller, bidder1, _, token_addr, auction_addr) = setup_test(&env);
    let auction_client = AuctionContractClient::new(&env, &auction_addr);
    let token_client = token::Client::new(&env, &token_addr);

    let item_name = String::from_str(&env, "Rare NFT");
    let metadata_uri = String::from_str(&env, "ipfs://nft");
    let reserve_price = 100i128;
    let duration_secs = 3600u64; // 1 hour
    let start_time = 1000u64;
    env.ledger().set_timestamp(start_time);
    let end_time = start_time + duration_secs;

    auction_client.initialize(&seller, &token_addr, &item_name, &metadata_uri, &reserve_price, &end_time);

    // Place a valid bid
    auction_client.bid(&bidder1, &150i128);

    // Verify auction state is updated
    let status = auction_client.get_status();
    assert_eq!(status.highest_bid, 150i128);
    assert_eq!(status.highest_bidder, Some(bidder1.clone()));

    // Verify tokens were escrowed to the auction contract
    assert_eq!(token_client.balance(&bidder1), 10000i128 - 150i128);
    assert_eq!(token_client.balance(&auction_client.address), 150i128);
}

#[test]
#[should_panic(expected = "bid amount below reserve price")]
fn test_bid_below_reserve() {
    let env = Env::default();
    let (seller, bidder1, _, token_addr, auction_addr) = setup_test(&env);
    let auction_client = AuctionContractClient::new(&env, &auction_addr);

    let item_name = String::from_str(&env, "Rare NFT");
    let metadata_uri = String::from_str(&env, "ipfs://nft");
    let reserve_price = 100i128;
    let end_time = 2000u64;
    env.ledger().set_timestamp(1000u64);

    auction_client.initialize(&seller, &token_addr, &item_name, &metadata_uri, &reserve_price, &end_time);

    // Bidding below reserve_price (100) should fail
    auction_client.bid(&bidder1, &99i128);
}

#[test]
#[should_panic(expected = "auction time expired")]
fn test_bid_after_deadline() {
    let env = Env::default();
    let (seller, bidder1, _, token_addr, auction_addr) = setup_test(&env);
    let auction_client = AuctionContractClient::new(&env, &auction_addr);

    let item_name = String::from_str(&env, "Rare NFT");
    let metadata_uri = String::from_str(&env, "ipfs://nft");
    let reserve_price = 100i128;
    let end_time = 2000u64;
    env.ledger().set_timestamp(1000u64);

    auction_client.initialize(&seller, &token_addr, &item_name, &metadata_uri, &reserve_price, &end_time);

    // Fast-forward time to past deadline
    env.ledger().set_timestamp(2001u64);

    // Bidding after end_time should fail
    auction_client.bid(&bidder1, &150i128);
}

#[test]
fn test_outbid_refund() {
    let env = Env::default();
    let (seller, bidder1, bidder2, token_addr, auction_addr) = setup_test(&env);
    let auction_client = AuctionContractClient::new(&env, &auction_addr);
    let token_client = token::Client::new(&env, &token_addr);

    let item_name = String::from_str(&env, "Rare NFT");
    let metadata_uri = String::from_str(&env, "ipfs://nft");
    let reserve_price = 100i128;
    let end_time = 2000u64;
    env.ledger().set_timestamp(1000u64);

    auction_client.initialize(&seller, &token_addr, &item_name, &metadata_uri, &reserve_price, &end_time);

    // Bidder 1 bids 150
    auction_client.bid(&bidder1, &150i128);
    assert_eq!(token_client.balance(&bidder1), 10000 - 150);
    assert_eq!(token_client.balance(&auction_client.address), 150);

    // Bidder 2 outbids Bidder 1 with 200
    auction_client.bid(&bidder2, &200i128);

    // Verify Bidder 1 is refunded, Bidder 2 balance is deducted, and escrow has new balance
    assert_eq!(token_client.balance(&bidder1), 10000);
    assert_eq!(token_client.balance(&bidder2), 20000 - 200);
    assert_eq!(token_client.balance(&auction_client.address), 200);

    let status = auction_client.get_status();
    assert_eq!(status.highest_bid, 200i128);
    assert_eq!(status.highest_bidder, Some(bidder2));
}

#[test]
fn test_anti_sniping() {
    let env = Env::default();
    let (seller, bidder1, bidder2, token_addr, auction_addr) = setup_test(&env);
    let auction_client = AuctionContractClient::new(&env, &auction_addr);

    let item_name = String::from_str(&env, "Rare NFT");
    let metadata_uri = String::from_str(&env, "ipfs://nft");
    let reserve_price = 100i128;
    let end_time = 2000u64;
    env.ledger().set_timestamp(1000u64);

    auction_client.initialize(&seller, &token_addr, &item_name, &metadata_uri, &reserve_price, &end_time);

    // 1. Bid placed way before last 2 minutes -> no extension.
    env.ledger().set_timestamp(1500u64); // 500s remaining (more than 120s)
    auction_client.bid(&bidder1, &150i128);
    assert_eq!(auction_client.get_status().end_time, 2000u64);

    // 2. Bid placed within final 2 minutes (e.g., 1900s, 100s remaining) -> extension applies.
    env.ledger().set_timestamp(1900u64);
    auction_client.bid(&bidder2, &200i128);

    // end_time should be extended to: 1900 + 120 = 2020u64
    assert_eq!(auction_client.get_status().end_time, 2020u64);
}

#[test]
fn test_end_auction_payout() {
    let env = Env::default();
    let (seller, bidder1, _, token_addr, auction_addr) = setup_test(&env);
    let auction_client = AuctionContractClient::new(&env, &auction_addr);
    let token_client = token::Client::new(&env, &token_addr);

    let item_name = String::from_str(&env, "Rare NFT");
    let metadata_uri = String::from_str(&env, "ipfs://nft");
    let reserve_price = 100i128;
    let end_time = 2000u64;
    env.ledger().set_timestamp(1000u64);

    auction_client.initialize(&seller, &token_addr, &item_name, &metadata_uri, &reserve_price, &end_time);

    // Place a valid bid
    auction_client.bid(&bidder1, &150i128);

    // Fast forward to after deadline
    env.ledger().set_timestamp(2001u64);

    // End auction
    let caller = Address::generate(&env);
    auction_client.end_auction(&caller);

    // Verify auction state is ended
    let status = auction_client.get_status();
    assert!(status.ended);

    // Verify seller received the highest bid payout, and escrow is empty
    assert_eq!(token_client.balance(&seller), 150i128);
    assert_eq!(token_client.balance(&auction_client.address), 0i128);
}
