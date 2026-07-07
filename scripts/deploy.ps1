# Stellar Soroban Deployment Script for Windows PowerShell
$ErrorActionPreference = "Stop"

echo "-----------------------------------------------------"
echo "Deploying Real-Time Auction dApp to Soroban Testnet"
echo "-----------------------------------------------------"

# Ensure WASM files are compiled
if (-not (Test-Path "target/wasm32v1-none/release/auction_contract.wasm")) {
    echo "WASM files not found. Compiling smart contracts..."
    # Restore cdylib type for WASM compilation
    (Get-Content contracts/auction/Cargo.toml) -replace 'crate-type = \["rlib"\]', 'crate-type = ["cdylib", "rlib"]' | Set-Content contracts/auction/Cargo.toml
    (Get-Content contracts/factory/Cargo.toml) -replace 'crate-type = \["rlib"\]', 'crate-type = ["cdylib", "rlib"]' | Set-Content contracts/factory/Cargo.toml
    
    cargo build --target wasm32v1-none --release
    
    # Restore rlib type for testing compatibility
    (Get-Content contracts/auction/Cargo.toml) -replace 'crate-type = \["cdylib", "rlib"\]', 'crate-type = ["rlib"]' | Set-Content contracts/auction/Cargo.toml
    (Get-Content contracts/factory/Cargo.toml) -replace 'crate-type = \["cdylib", "rlib"\]', 'crate-type = ["rlib"]' | Set-Content contracts/factory/Cargo.toml
}

# 1. Manage Deployer Key
echo "Checking 'deployer' key..."
$deployerAddr = ""
try {
    $deployerAddr = & ".\stellar.exe" keys address deployer
    echo "Using existing deployer: $deployerAddr"
} catch {
    echo "Generating new deployer key..."
    & ".\stellar.exe" keys generate deployer
    $deployerAddr = & ".\stellar.exe" keys address deployer
    echo "New deployer created: $deployerAddr"
}

# 2. Fund Account via Friendbot
echo "Funding deployer address via Friendbot..."
try {
    $fundRes = Invoke-RestMethod -Uri "https://friendbot.stellar.org/?addr=$deployerAddr"
    echo "Deployer address funded!"
} catch {
    echo "Friendbot funding skipped (likely already funded)."
}

# 3. Upload/Install Auction WASM
echo "Uploading Auction contract Wasm bytecode to Testnet..."
$auctionHash = & ".\stellar.exe" contract install --wasm target/wasm32v1-none/release/auction_contract.wasm --source deployer --network testnet
# Extract clean hex hash if output contains extra description
$auctionHash = $auctionHash.Trim()
echo "Auction WASM Hash: $auctionHash"

# 4. Deploy Factory Contract
echo "Deploying Factory contract to Testnet..."
$factoryAddr = & ".\stellar.exe" contract deploy --wasm target/wasm32v1-none/release/factory_contract.wasm --source deployer --network testnet
$factoryAddr = $factoryAddr.Trim()
echo "Factory Contract Address: $factoryAddr"

# 5. Initialize Factory Contract
echo "Initializing Factory contract with Auction WASM Hash..."
& ".\stellar.exe" contract invoke --id $factoryAddr --source deployer --network testnet -- init --wasm_hash $auctionHash
echo "Factory contract initialized successfully!"

# 6. Save Configuration to Environment Files
$envContent = @"
VITE_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
VITE_STELLAR_NETWORK_PASSPHRASE=Test Stellar Network ; September 2015
VITE_FACTORY_CONTRACT_ADDRESS=$factoryAddr
VITE_TOKEN_CONTRACT_ADDRESS=CDLZFC3SYJYDZT7K67VZ75HPJFCBQ2BBVGTICN2V45PESTCTFBX6JGSZ
"@

Set-Content -Path ".env" -Value $envContent
Set-Content -Path "frontend/.env" -Value $envContent

echo "-----------------------------------------------------"
echo "Deployment successful!"
echo "Factory Address: $factoryAddr"
echo "Saved to local and frontend environment variables."
echo "-----------------------------------------------------"
