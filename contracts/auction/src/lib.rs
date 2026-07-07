#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, token, Address, Env, String, Symbol};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuctionStatus {
    pub seller: Address,
    pub token: Address,
    pub item_name: String,
    pub item_metadata_uri: String,
    pub reserve_price: i128,
    pub end_time: u64,
    pub highest_bid: i128,
    pub highest_bidder: Option<Address>,
    pub ended: bool,
}

#[contract]
pub struct AuctionContract;

#[contractimpl]
impl AuctionContract {
    pub fn initialize(
        env: Env,
        seller: Address,
        token: Address,
        item_name: String,
        item_metadata_uri: String,
        reserve_price: i128,
        end_time: u64,
    ) {
        if env.storage().instance().has(&Symbol::new(&env, "seller")) {
            panic!("already initialized");
        }

        env.storage().instance().set(&Symbol::new(&env, "seller"), &seller);
        env.storage().instance().set(&Symbol::new(&env, "token"), &token);
        env.storage().instance().set(&Symbol::new(&env, "item_name"), &item_name);
        env.storage().instance().set(&Symbol::new(&env, "item_meta"), &item_metadata_uri);
        env.storage().instance().set(&Symbol::new(&env, "reserve"), &reserve_price);
        env.storage().instance().set(&Symbol::new(&env, "end_time"), &end_time);
        env.storage().instance().set(&Symbol::new(&env, "highest_bid"), &0i128);
        env.storage().instance().set(&Symbol::new(&env, "ended"), &false);

        // Extend contract TTL: threshold 1000 ledgers, extend to 50000 ledgers
        env.storage().instance().extend_ttl(1000, 50000);
    }

    pub fn bid(env: Env, bidder: Address, amount: i128) {
        env.storage().instance().extend_ttl(1000, 50000);
        bidder.require_auth();

        let ended: bool = env.storage().instance().get(&Symbol::new(&env, "ended")).unwrap_or(false);
        if ended {
            panic!("auction already ended");
        }

        let end_time: u64 = env.storage().instance().get(&Symbol::new(&env, "end_time")).unwrap();
        let current_time = env.ledger().timestamp();
        if current_time >= end_time {
            panic!("auction time expired");
        }

        let reserve_price: i128 = env.storage().instance().get(&Symbol::new(&env, "reserve")).unwrap();
        if amount < reserve_price {
            panic!("bid amount below reserve price");
        }

        let highest_bid: i128 = env.storage().instance().get(&Symbol::new(&env, "highest_bid")).unwrap_or(0);
        if amount <= highest_bid {
            panic!("bid amount must exceed current highest bid");
        }

        let token_addr: Address = env.storage().instance().get(&Symbol::new(&env, "token")).unwrap();
        let token_client = token::Client::new(&env, &token_addr);

        // Escrow funds: Transfer tokens from bidder to the auction contract.
        // In Soroban, calling token contract with bidder address propagates authorization automatically.
        token_client.transfer(&bidder, &env.current_contract_address(), &amount);

        // Refund previous bidder if any exists
        let prev_bidder_opt: Option<Address> = env.storage().instance().get(&Symbol::new(&env, "highest_bidder"));
        if let Some(prev_bidder) = prev_bidder_opt {
            token_client.transfer(&env.current_contract_address(), &prev_bidder, &highest_bid);
        }

        // Update state
        env.storage().instance().set(&Symbol::new(&env, "highest_bid"), &amount);
        env.storage().instance().set(&Symbol::new(&env, "highest_bidder"), &Some(bidder.clone()));

        // Anti-sniping extension: extend by 2 min (120 secs) if bid is placed in final 2 min
        let mut new_end_time = end_time;
        if end_time - current_time <= 120 {
            new_end_time = current_time + 120;
            env.storage().instance().set(&Symbol::new(&env, "end_time"), &new_end_time);
        }

        // Emit new_bid event
        env.events().publish(
            (Symbol::new(&env, "new_bid"), bidder, amount),
            new_end_time,
        );
    }

    pub fn end_auction(env: Env, caller: Address) {
        env.storage().instance().extend_ttl(1000, 50000);
        // Any user can trigger end_auction after the deadline has expired
        let ended: bool = env.storage().instance().get(&Symbol::new(&env, "ended")).unwrap_or(false);
        if ended {
            panic!("auction already ended");
        }

        let end_time: u64 = env.storage().instance().get(&Symbol::new(&env, "end_time")).unwrap();
        let current_time = env.ledger().timestamp();
        if current_time < end_time {
            panic!("auction has not expired yet");
        }

        let seller: Address = env.storage().instance().get(&Symbol::new(&env, "seller")).unwrap();
        let token_addr: Address = env.storage().instance().get(&Symbol::new(&env, "token")).unwrap();
        let highest_bid: i128 = env.storage().instance().get(&Symbol::new(&env, "highest_bid")).unwrap_or(0);
        let highest_bidder_opt: Option<Address> = env.storage().instance().get(&Symbol::new(&env, "highest_bidder"));

        let token_client = token::Client::new(&env, &token_addr);

        if let Some(highest_bidder) = highest_bidder_opt {
            // Reserve is guaranteed to be met because bid() checks amount >= reserve_price.
            // Transfer funds from escrow to seller.
            token_client.transfer(&env.current_contract_address(), &seller, &highest_bid);

            env.storage().instance().set(&Symbol::new(&env, "ended"), &true);

            env.events().publish(
                (Symbol::new(&env, "auction_ended"), seller, highest_bidder.clone()),
                highest_bid,
            );
        } else {
            // No bids were placed.
            env.storage().instance().set(&Symbol::new(&env, "ended"), &true);

            env.events().publish(
                (Symbol::new(&env, "auction_ended"), seller, Option::<Address>::None),
                0i128,
            );
        }
    }

    pub fn get_status(env: Env) -> AuctionStatus {
        env.storage().instance().extend_ttl(1000, 50000);

        AuctionStatus {
            seller: env.storage().instance().get(&Symbol::new(&env, "seller")).unwrap(),
            token: env.storage().instance().get(&Symbol::new(&env, "token")).unwrap(),
            item_name: env.storage().instance().get(&Symbol::new(&env, "item_name")).unwrap(),
            item_metadata_uri: env.storage().instance().get(&Symbol::new(&env, "item_meta")).unwrap(),
            reserve_price: env.storage().instance().get(&Symbol::new(&env, "reserve")).unwrap(),
            end_time: env.storage().instance().get(&Symbol::new(&env, "end_time")).unwrap(),
            highest_bid: env.storage().instance().get(&Symbol::new(&env, "highest_bid")).unwrap_or(0),
            highest_bidder: env.storage().instance().get(&Symbol::new(&env, "highest_bidder")).unwrap_or(None),
            ended: env.storage().instance().get(&Symbol::new(&env, "ended")).unwrap_or(false),
        }
    }
}

mod test;
