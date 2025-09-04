#!/bin/bash

# Colors for better visibility
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}     FHE EXECUTOR SERVICE (24/7)       ${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# Configuration
COPROC_ID="2gN4VPVZ8YPnbrEhVuFgLGAwRWFniM9wf7tVj4esEr8S"
LENDING_ID="EswWQ53674fHawe6hmtqbWxNsfZMym6hamaUSuHANWmq"
RPC_URL="http://127.0.0.1:8899"
EXECUTOR_KEYPAIR="/home/ham/.config/solana/id.json"

echo -e "${YELLOW}📋 Configuration:${NC}"
echo -e "  RPC URL:        ${BLUE}$RPC_URL${NC}"
echo -e "  Executor Key:   ${BLUE}$EXECUTOR_KEYPAIR${NC}"
echo -e "  Coprocessor ID: ${BLUE}$COPROC_ID${NC}"
echo -e "  Lending ID:     ${BLUE}$LENDING_ID${NC}"
echo ""

# Kill any existing executor processes
echo -e "${YELLOW}🔧 Cleaning up existing processes...${NC}"
pkill -f "target/release/executor" 2>/dev/null
sleep 1

# Change to executor directory
cd executor/service

echo -e "${GREEN}🚀 Starting Executor Service...${NC}"
echo -e "${YELLOW}   Press Ctrl+C to stop${NC}"
echo ""
echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}            EXECUTOR LOGS               ${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# Run executor in foreground with full logging
RUST_LOG=info \
RPC_URL=$RPC_URL \
EXECUTOR_KEYPAIR=$EXECUTOR_KEYPAIR \
COPROC_ID=$COPROC_ID \
LENDING_ID=$LENDING_ID \
LD_LIBRARY_PATH=../lib \
cargo run --release 2>&1 | while IFS= read -r line; do
    # Color code different log levels
    if [[ $line == *"ERROR"* ]]; then
        echo -e "${RED}$line${NC}"
    elif [[ $line == *"WARN"* ]]; then
        echo -e "${YELLOW}$line${NC}"
    elif [[ $line == *"Processing job"* ]]; then
        echo -e "${GREEN}✨ $line${NC}"
    elif [[ $line == *"FHE computation"* ]]; then
        echo -e "${MAGENTA}🔐 $line${NC}"
    elif [[ $line == *"Published metrics"* ]]; then
        echo -e "${CYAN}📊 $line${NC}"
    elif [[ $line == *"FHE library initialized"* ]]; then
        echo -e "${GREEN}✅ $line${NC}"
    else
        echo "$line"
    fi
done

# This will only execute when Ctrl+C is pressed
echo ""
echo -e "${RED}========================================${NC}"
echo -e "${RED}     EXECUTOR SERVICE STOPPED           ${NC}"
echo -e "${RED}========================================${NC}"