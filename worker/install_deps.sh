#!/bin/bash
set -e

echo "Installing system dependencies..."
apt-get update
apt-get install -y git build-essential gcc make qmicli libqmi-utils

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
