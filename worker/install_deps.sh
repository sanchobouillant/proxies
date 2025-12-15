#!/bin/bash
set -e

echo "Installing system dependencies..."
apt-get update
apt-get install -y git build-essential gcc make

echo "Checking for optional tools..."
if ! command -v qmicli &> /dev/null; then
    echo "WARNING: 'qmicli' not found. You may need to install 'libqmi-utils' manually for 4G modems to work."
fi

echo "Checking for 3proxy..."
if ! command -v 3proxy &> /dev/null; then
    echo "3proxy not found. Building from source..."
    cd /tmp
    rm -rf 3proxy
    git clone https://github.com/3proxy/3proxy.git
    cd 3proxy
    make -f Makefile.Linux
    make -f Makefile.Linux install
    cd /
    rm -rf /tmp/3proxy
    echo "3proxy installed successfully."
else
    echo "3proxy is already installed."
fi
