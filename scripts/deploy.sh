#!/usr/bin/env bash
set -e

# Load environment variables if they exist
if [ -f .env ]; then
    source .env
fi

RPC_URL=${PUBLIC_STELLAR_RPC_URL:-"https://soroban-testnet.stellar.org"}
NETWORK_PASSPHRASE=${PUBLIC_STELLAR_NETWORK_PASSPHRASE:-"Test Stellar Network ; September 2015"}

echo "-----------------------------------------------------"
echo "Deploying Real-Time Auction dApp to Soroban Testnet"
echo "RPC URL: $RPC_URL"
echo "-----------------------------------------------------"

# Check if stellar-cli is installed
if ! command -v stellar &> /dev/null; then
    echo "Stellar CLI could not be found. Please install it using:"
    echo "winget install --id Stellar.StellarCLI"
    exit 1
fi

# Ensure cargo build target is built
echo "Building smart contracts..."
stellar contract build

echo "Optimizing WASMs..."
stellar contract optimize --wasm target/wasm32-unknown-unknown/release/factory_contract.wasm
stellar contract optimize --wasm target/wasm32-unknown-unknown/release/auction_contract.wasm

# Setup identities
echo "Generating/checking deployment identities..."
if ! stellar keys address deployer &> /dev/null; then
    stellar keys generate deployer
fi
DEPLOYER_ADDR=$(stellar keys address deployer)
echo "Deployer Address: $DEPLOYER_ADDR"

# Fund deployer address via Friendbot
echo "Funding deployer address via Friendbot..."
curl -s "https://friendbot.stellar.org/?addr=$DEPLOYER_ADDR" > /dev/null
echo "Deployer address funded!"

# Fetch native token address
echo "Retrieving native token contract ID..."
NATIVE_TOKEN_ADDR=$(stellar contract id asset --network testnet --asset native)
echo "Native Token Address: $NATIVE_TOKEN_ADDR"

# Deploy Factory
echo "Deploying Factory Contract..."
FACTORY_ADDR=$(stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/factory_contract.optimized.wasm \
  --source deployer \
  --network testnet)
echo "Factory Address: $FACTORY_ADDR"

# Install (upload) Auction Wasm to get WASM Hash
echo "Installing Auction Wasm..."
AUCTION_WASM_HASH=$(stellar contract install \
  --wasm target/wasm32-unknown-unknown/release/auction_contract.optimized.wasm \
  --source deployer \
  --network testnet)
echo "Auction WASM Hash: $AUCTION_WASM_HASH"

# Initialize Factory with Auction WASM Hash
echo "Initializing Factory Contract..."
stellar contract invoke \
  --id "$FACTORY_ADDR" \
  --source deployer \
  --network testnet \
  -- init \
  --wasm_hash "$AUCTION_WASM_HASH"

echo "Updating .env file with deployed addresses..."
# Create or overwrite .env
cat <<EOF > .env
PUBLIC_STELLAR_RPC_URL="$RPC_URL"
PUBLIC_STELLAR_NETWORK_PASSPHRASE="$NETWORK_PASSPHRASE"
PUBLIC_FACTORY_CONTRACT_ADDRESS="$FACTORY_ADDR"
PUBLIC_TOKEN_CONTRACT_ADDRESS="$NATIVE_TOKEN_ADDR"
EOF

echo "-----------------------------------------------------"
echo "Deployment successful!"
echo "Factory: $FACTORY_ADDR"
echo "Token: $NATIVE_TOKEN_ADDR"
echo "-----------------------------------------------------"
