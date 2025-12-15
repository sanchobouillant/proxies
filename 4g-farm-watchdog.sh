#!/bin/bash
# 4g-farm-watchdog.sh — Hyper-Resilient 4G Modem Manager
# Associe chaque /dev/cdc-wdmX à un bridge br-4g-* + table de routage dédiée.
# - Bibou   -> br-4g-bibou   -> table wwan0
# - Biloute -> br-4g-biloute -> table wwan1
# - Gazon   -> br-4g-gazon   -> table wwan2
#
# REQUIRE: qmicli, qmi-network, udhcpc, iproute2, iptables, timeout

set -Eeuo pipefail

### PARAMÈTRES GLOBAUX ###
APN="${APN:-free}"
BRIDGE_PREFIX="br-4g-"
RT_BASE_ID=200          # wwan0=200, wwan1=201, ...
PING_TARGETS=("8.8.8.8" "1.1.1.1")
LOG="/var/log/4g-farm.log"
CMD_TIMEOUT="20s"

### VARIABLES GLOBALES ###
declare -a BRIDGES=()
declare -a QMI_DEVS=()
N=0

### LOGGING ###
log()   { echo "[$(date '+%F %T')] $*" | tee -a "$LOG" >&2; }
perlog(){ local tag="$1"; shift; log "[$tag] $*"; }

### ERROR HANDLING ###
cleanup() {
  log "Arrêt du script - Nettoyage..."
  # Kill all child processes (background program_pair)
  pkill -P $$ || true
}
trap cleanup EXIT INT TERM

### PRÉREQUIS ###
ensure_prereqs() {
  touch "$LOG" || true
  log "=== 4G FARM WATCHDOG START (Resilient Mode) ==="

  # IP forward
  sysctl -w net.ipv4.ip_forward=1 >/dev/null || true
  
  # Ensure tools exist
  for cmd in qmicli udhcpc ip timeout; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      log "ERREUR CRITIQUE: Commande '$cmd' introuvable."
      exit 1
    fi
  done
  
  # qmi-network removed.

  # Disable ModemManager (Avoid conflicts)
  if systemctl is-active --quiet ModemManager.service; then
    log "Arrêt de ModemManager"
    systemctl stop ModemManager || true
  fi
}

### DÉTECTION PAIRES ###
detect() {
  # Refresh netplan if relevant
  command -v netplan >/dev/null && netplan apply 2>/dev/null || true

  mapfile -t BRIDGES < <(
    ip -o link show type bridge \
      | awk -F': ' '/br-4g-/{print $2}' \
      | sort
  )

  mapfile -t QMI_DEVS < <(ls /dev/cdc-wdm* 2>/dev/null | sort)

  if ((${#BRIDGES[@]} < ${#QMI_DEVS[@]})); then
    N=${#BRIDGES[@]}
  else
    N=${#QMI_DEVS[@]}
  fi
}

### WRAPPERS AVEC TIMEOUT & LOGS ###
safe_qmicli() {
  local output
  # On capture stdout+stderr
  set +e
  output=$(timeout "$CMD_TIMEOUT" qmicli "$@" 2>&1)
  local ret=$?
  set -e
  
  if [[ $ret -ne 0 ]]; then
    log "[ERROR] qmicli $* (Code $ret)"
    log "[ERROR] Output: $output"
    return $ret
  fi
  echo "$output"
}

safe_udhcpc() {
  local output
  set +e
  output=$(timeout "$CMD_TIMEOUT" udhcpc "$@" 2>&1)
  local ret=$?
  set -e

  if [[ $ret -ne 0 ]]; then
    log "[ERROR] udhcpc $* (Code $ret)"
    log "[ERROR] Output: $output"
    return $ret
  fi
  echo "$output"
}

### QMI PROXY ###
qmi_proxy_up() {
  local dev="$1"
  if ! pgrep -f "qmi-proxy -d ${dev}" >/dev/null 2>&1; then
    perlog "global" "Démarrage qmi-proxy pour $dev"
    nohup qmi-proxy -d "$dev" >>/var/log/qmi-proxy.log 2>&1 &
    sleep 2
  fi
}

### DIAGNOSTIC ELECTRIQUE ###
check_power() {
  local tag="${1:-Global}"
  
  # 1. Raspberry Pi Under-voltage check
  if command -v vcgencmd >/dev/null 2>&1; then
    local throttled
    throttled=$(vcgencmd get_throttled 2>/dev/null)
    if [[ "$throttled" != "throttled=0x0" ]]; then
       perlog "$tag" "[ALERT ELECTRIQUE] vcgencmd report: $throttled. Sous-tension détectée !"
    fi
  fi

  # 2. Kernel Messages (Last 10 lines containing Voltage or USB disconnect)
  # On cherche des indices récents
  local kern_errs
  kern_errs=$(dmesg | tail -n 50 | grep -iE "voltage|current|over-current|disconnect" || true)
  if [[ -n "$kern_errs" ]]; then
     perlog "$tag" "[DIAGNOSTIC KERNEL] Indices électriques récents :"
     echo "$kern_errs" | while read -r line; do
        perlog "$tag" "  > $line"
     done
  fi
}

### CHECK DEVICE EXISTENCE ###
wait_for_device() {
  local dev="$1"
  local tag="$2"
  
  if [[ ! -e "$dev" ]]; then
     check_power "$tag"
  fi
  
  while [[ ! -e "$dev" ]]; do
    perlog "$tag" "Device $dev introuvable/débranché... attente."
    sleep 5
  done
}

### ATTENTE DE REGISTRATION ###
wait_registered() {
  local dev="$1" tries="${2:-30}"
  for ((i=1; i<=tries; i++)); do
    local S
    S=$(safe_qmicli -d "$dev" --device-open-proxy --nas-get-serving-system 2>/dev/null || true)
    
    if echo "$S" | grep -q "Registration state: 'registered'"; then
      if echo "$S" | grep -q "PS: 'attached'"; then
        return 0
      fi
    fi
    sleep 2
  done
  return 1
}

### RESET AT (Soft Reset) ###
soft_reset() {
  local tag="$1"
  # Try all potential AT ports specifically mapping to this modem would be better,
  # but scanning common ports is the fallback.
  for AT in /dev/ttyUSB2 /dev/ttyUSB0; do
    if [[ -e "$AT" ]]; then
      perlog "$tag" "Soft reset via $AT (AT+CFUN=1,1)"
      # Use timeout for echo to avoid blocking on stuck TTY
      timeout 2s bash -c "printf 'AT\r\nATI\r\nAT+CFUN=1,1\r\n' > $AT" || true
      sleep 15
      return 0
    fi
  done
  perlog "$tag" "Aucun port AT valide trouvé."
  return 1
}

### CYCLE USB (Hard Reset) ###
usb_cycle() {
  local tag="$1" dev="$2"
  local SYS
  SYS=$(udevadm info -q path -n "$dev" 2>/dev/null || true)
  [[ -z "$SYS" ]] && return 1

  local P="$SYS"
  while [[ "$P" != "/" && ! -e "/sys$P/driver" ]]; do
    P="$(dirname "$P")"
  done
  local DEVNAME
  DEVNAME=$(basename "$P")

  [[ ! -e /sys/bus/usb/drivers/usb/unbind ]] && return 1

  perlog "$tag" "HARD RESET: USB Cycle $DEVNAME"
  echo "$DEVNAME" > /sys/bus/usb/drivers/usb/unbind || true
  sleep 3
  echo "$DEVNAME" > /sys/bus/usb/drivers/usb/bind || true
  sleep 10
}

### FIND INTERFACE ###
find_iface_for_dev() {
  local dev="$1"
  local SYS
  SYS=$(udevadm info -q path -n "$dev" 2>/dev/null || true)
  [[ -z "$SYS" ]] && return 1

  local P
  P="$(dirname "$SYS")"
  P="$(dirname "$P")"
  local NETDIR="/sys${P}/net"
  
  if [[ -d "$NETDIR" ]]; then
     ls "$NETDIR" 2>/dev/null | head -n1 || true
  fi
}

### ROUTING ###
subnet_of_bridge() {
  local br="$1"
  ip -4 route show dev "$br" | awk '/proto kernel/ {print $1; exit}'
}

ensure_routing() {
  local tag="$1" br="$2" ifc="$3" table="$4"
  
  # Ensure Bridge Link Up
  ip link set "$br" up || true

  local SUBNET
  SUBNET=$(subnet_of_bridge "$br")
  if [[ -z "$SUBNET" ]]; then
    perlog "$tag" "WARN: Pas de subnet sur bridge $br. Vérifier netplan/config."
    return 1
  fi

  local tID=$((RT_BASE_ID + ${table#wwan}))
  if ! grep -qE "^[[:space:]]*${tID}[[:space:]]+${table}\$" /etc/iproute2/rt_tables; then
    echo "${tID} ${table}" >> /etc/iproute2/rt_tables
  fi

  # Add default route (idempotent)
  ip route replace default dev "$ifc" table "$table" || true
  
  # Add rule (idempotent)
  if ! ip rule | grep -q "from $SUBNET lookup $table"; then
    ip rule add from "$SUBNET" table "$table"
    perlog "$tag" "Rule ajoutée: $SUBNET -> $table"
  fi
}

check_connectivity() {
  local ifc="$1"
  local tag="$2"
  
  for target in "${PING_TARGETS[@]}"; do
    if timeout 5s ping -c1 -W2 -I "$ifc" "$target" >/dev/null 2>&1; then
      return 0
    fi
  done
  return 1
}

### LOGIC PER PAIR ###
program_pair() {
  local idx="$1" dev="$2" br="$3"
  local tag="${dev##*/}↔${br}"
  local table="wwan${idx}"

  # Infinite loop for process resilience
  while true; do
    perlog "$tag" "=== INIT SEQUENCE ==="
    
    # Check device physical presence
    wait_for_device "$dev" "$tag"
    qmi_proxy_up "$dev"

    perlog "$tag" "Nettoyage session QMI précédente"
    # Stop any previous wds session best effort
    safe_qmicli -d "$dev" --device-open-proxy --wds-stop-network=2222222 >/dev/null 2>&1 || true # Invalid handle force cleanup? Not really possible without CID.
    # Just rely on reset if needed.
    
    # Online + LTE
    perlog "$tag" "Setup QMI mode..."
    safe_qmicli -d "$dev" --device-open-proxy --dms-set-operating-mode=online >/dev/null 2>&1 || true
    safe_qmicli -d "$dev" --device-open-proxy --nas-set-system-selection-preference="mode-preference=lte" >/dev/null 2>&1 || true

    if ! wait_registered "$dev"; then
       perlog "$tag" "Timeout registration -> Soft Reset"
       soft_reset "$tag" || usb_cycle "$tag" "$dev"
       continue 
    fi

    # 2. Start Network (Direct QMI)
    perlog "$tag" "Start Network (qmicli)..."
    
    # Ensure raw-ip (Log output for debug)
    local raw_out
    if ! raw_out=$(safe_qmicli -d "$dev" --device-open-proxy --wda-set-data-format=raw-ip 2>&1); then
        # Ignore "Device or resource busy" which happens if interface is already up/configured
        if [[ "$raw_out" != *"busy"* ]]; then
             perlog "$tag" "[WARN] Failed to set raw-ip: $raw_out"
        fi
    fi

    # Start WDS Network
    local qmi_out
    # We use --client-no-release-cid to keep connection alive after command exits
    if ! qmi_out=$(safe_qmicli -d "$dev" --device-open-proxy --wds-start-network="apn='${APN}',ip-type=4" --client-no-release-cid 2>&1); then
       perlog "$tag" "Start Failed -> Retry in 5s"
       perlog "$tag" "Error Details: $qmi_out"
       sleep 5
       continue
    fi
    perlog "$tag" "Network Started (WDS)"
    
    sleep 2
    local ifc
    ifc=$(find_iface_for_dev "$dev")
    if [[ -z "$ifc" ]]; then
       perlog "$tag" "Interface réseau introuvable (pas de wwan0/wwu*) -> Retry"
       sleep 5
       continue
    fi

    perlog "$tag" "Interface: $ifc"
    ip link set "$ifc" up
    sysctl -w "net.ipv4.conf.${ifc}.rp_filter=2" >/dev/null || true

    # 3. DHCP (Aggressive + Fallback)
    perlog "$tag" "DHCP Request (First attempt: udhcpc)..."
    # safe_udhcpc logs error to stderr now
    if ! safe_udhcpc -i "$ifc" -q -n -t 5 -T 2 >/dev/null; then
       perlog "$tag" "udhcpc failed. Trying dhclient fallback..."
       
       # Fallback dhclient
       if command -v dhclient >/dev/null; then
           timeout 15s dhclient -v "$ifc" || perlog "$tag" "dhclient failed too."
       else
           perlog "$tag" "dhclient not installed."
       fi
       
       # Check if we got IP despite errors (dhclient return codes can be tricky)
       if ! ip -4 addr show dev "$ifc" | grep -q "inet "; then
           perlog "$tag" "DHCP Failed (All methods) -> Retry Loop"
           sleep 2
           continue
       fi
    fi

    # 4. Routing
    ensure_routing "$tag" "$br" "$ifc" "$table"
    
    local IP
    IP=$(ip -4 -o addr show dev "$ifc" | awk '{print $4}')
    perlog "$tag" "ONLINE ($IP) - Monitoring..."

    # Monitoring Loop
    local fails=0
    while true; do
       # Verify device still exists
       if [[ ! -e "$dev" ]]; then
          perlog "$tag" "Device perdu! Redémarrage..."
          check_power "$tag"
          break
       fi
       
       if check_connectivity "$ifc" "$tag"; then
          fails=0
          ensure_routing "$tag" "$br" "$ifc" "$table" # Enforce config
          sleep 10
       else
          ((fails++))
          perlog "$tag" "Packet Loss ($fails/3)"
          
          if (( fails >= 3 )); then
             perlog "$tag" "Connexion perdue -> Recovery"
             # On check si c'est électrique aussi
             check_power "$tag"
             break
          fi
          
          # Try Quick DHCP Renew first
          safe_udhcpc -i "$ifc" -q -n -t 2 -T 1 >/dev/null 2>&1 || true
       fi
    done
    
    # If we break here, we restart the main loop (Recovery)
    perlog "$tag" "Restarting Connection Sequence..."
    sleep 2
  done
}

### MAIN START ###
main() {
  ensure_prereqs
  detect

  while (( N == 0 )); do
    log "En attente de modems/bridges..."
    sleep 5
    detect
  done

  log "Watchdog démarré pour $N paires."
  
  for ((i=0; i<N; i++)); do
    program_pair "$i" "${QMI_DEVS[i]}" "${BRIDGES[i]}" &
  done

  # Keep main process alive
  wait
}

main
