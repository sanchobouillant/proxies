#!/bin/bash
set -x # Enable debug mode to print commands

# Parse arguments first to set mode
MODE="production"
for arg in "$@"
do
    if [ "$arg" == "--dev" ]; then
        MODE="development"
    fi
    if [ "$arg" == "--help" ]; then
        echo "Usage: ./start-worker.sh [OPTIONS]"
        echo "Options:"
        echo "  --dev   Start in development mode (forces USE_MOCKS=true)"
        echo "  --port  Set specific worker port"
        exit 0
    fi
done

echo "=========================================="
echo "STARTING WORKER"
echo "=========================================="
date

echo "Current directory: $(pwd)"
echo "Listing root directory..."
ls -la

echo "Building shared module..."
(cd shared && npm install && npm run build) || { echo "Failed to build shared"; exit 1; }

echo "Changing to worker directory..."
cd worker || { echo "Failed to cd into worker"; exit 1; }
echo "Current directory: $(pwd)"

echo "Checking node version:"
node -v
echo "Checking npm version:"
npm -v

echo "Installing dependencies..."
npm install
echo "Building worker..."
npm run build

echo "Checking for shared module..."
ls -la node_modules/@proxy-farm/shared || echo "Shared module not found in node_modules!"


# Parse named arguments
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --port) WORKER_PORT="$2"; shift ;;
        *) ;;
    esac
    shift
done

if [ -n "$WORKER_PORT" ]; then
    echo "WORKER_PORT set to $WORKER_PORT"
    export WORKER_PORT
fi

if [ "$MODE" == "development" ]; then
    export USE_MOCKS=true
fi


# Function to check for required system binaries
check_dependency() {
    if ! command -v $1 &> /dev/null; then
        echo "ERROR: '$1' is not installed."
        echo "Please install it to proceed. On Debian/Ubuntu:"
        echo "  apt-get update && apt-get install -y $2"
        return 1
    else
        echo "SUCCESS: Found '$1'"
        return 0
    fi
}

echo "=========================================="
echo "CHECKING SYSTEM DEPENDENCIES"
echo "=========================================="
MISSING_DEPS=0
check_dependency "qmicli" "libqmi-utils" || MISSING_DEPS=1
if ! command -v 3proxy &> /dev/null || ! command -v dhclient &> /dev/null; then
    echo "Dependencies (3proxy/dhclient) not found. Running install_deps.sh..."
    chmod +x ./install_deps.sh
    ./install_deps.sh
fi

if [ $MISSING_DEPS -eq 1 ]; then
    echo ""
    echo "CRITICAL: Missing system dependencies. Cannot start in REAL mode."
    # We only error out if we are NOT in mock mode
    if [ "${USE_MOCKS:-false}" = "false" ]; then
         echo "Exiting..."
         exit 1
    else
         echo "WARNING: Continuing anyway because USE_MOCKS is true..."
    fi
fi

echo "Environment Variables:"
env | grep -v "PASSWORD\|SECRET\|KEY"

echo "Check if Serial Ports are accessible:"
ls /dev/tty* | head -n 5 || echo "No tty devices found or permission denied"

echo "=========================================="
if [ "$MODE" == "development" ]; then
    echo "=========================================="
    echo "LAUNCHING WORKER (DEV MODE)"
    echo "=========================================="
    echo "USE_MOCKS enforced to: true"
    npm run dev
else
    echo "=========================================="
    echo "LAUNCHING WORKER (PRODUCTION)"
    echo "=========================================="
    # In prod, we default to false mocks (real hardware), but respect env var if set
    export USE_MOCKS=${USE_MOCKS:-false}
    echo "USE_MOCKS is set to: $USE_MOCKS"
    npm run start
fi
