#!/bin/bash
set -x # Enable debug mode to print commands

# Parse arguments
MODE="production"
for arg in "$@"
do
    if [ "$arg" == "--dev" ]; then
        MODE="development"
    fi
    if [ "$arg" == "--help" ]; then
        echo "Usage: ./start-frontend.sh [OPTIONS]"
        echo "Options:"
        echo "  --dev   Start in development mode"
        exit 0
    fi
done

echo "=========================================="
echo "STARTING FRONTEND"
echo "=========================================="
date

echo "Current directory: $(pwd)"
echo "Listing root directory..."
ls -la

echo "Changing to frontend directory..."
cd frontend || { echo "Failed to cd into frontend"; exit 1; }
echo "Current directory: $(pwd)"

echo "Checking node version:"
node -v
echo "Checking npm version:"
npm -v

echo "Checking package.json:"
cat package.json

echo "Installing dependencies (if needed)..."
# We define shared dependency as file:../shared, so we might need to make sure it's installed
npm install

echo "Checking for shared module..."
ls -la node_modules/@proxy-farm/shared || echo "Shared module not found in node_modules!"

echo "Environment Variables:"
env | grep -v "PASSWORD\|SECRET\|KEY" # Print env but hide potential secrets

echo "=========================================="
MODE="production"
for arg in "$@"
do
    if [ "$arg" == "--dev" ]; then
        MODE="development"
    fi
    if [ "$arg" == "--help" ]; then
        echo "Usage: ./start-frontend.sh [OPTIONS]"
        echo "Options:"
        echo "  --dev   Start in development mode"
        exit 0
    fi
done

echo "=========================================="
if [ "$MODE" == "development" ]; then
    echo "LAUNCHING DEVELOPMENT SERVER"
    echo "=========================================="
    npm run dev
else
    echo "LAUNCHING PRODUCTION SERVER"
    echo "=========================================="
    npm run start
fi
