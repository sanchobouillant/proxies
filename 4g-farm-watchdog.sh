#!/bin/bash
# 4g-farm-watchdog.sh — multi-modem bring-up + auto-heal pour SIM7600 (QMI)
# Associe chaque /dev/cdc-wdmX à un bridge br-4g-* + table de routage dédiée.
# - Bibou   -> br-4g-bibou   -> table wwan0
# - Biloute -> br-4g-biloute -> table wwan1
# - Gazon   -> br-4g-gazon   -> table wwan2
#
# REQUIRE: qmicli, qmi-network, udhcpc, iproute2, iptables

set -Eeuo pipefail

### PARAMÈTRES GLOBAUX ###
APN="${APN:-free}"
BRIDGE_PREFIX="br-4g-"
RT_BASE_ID=200          # wwan0=200, wwan1=201, wwan2=202…
PING_DST="${PING_DST:-8.8.8.8}"
LOG="/var/log/4g-farm.log"

### VARIABLES GLOBALES ###
declare -a BRIDGES=()
declare -a QMI_DEVS=()
N=0

### LOGGING ###
log()   { echo "[$(date '+%F %T')] $*" | tee -a "$LOG" >&2; }
perlog(){ local tag="$1"; shift; log "[$tag] $*"; }

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

### PRÉREQUIS ###
ensure_prereqs() {
  touch "$LOG" || true
  log "=== 4G FARM WATCHDOG START ==="

  # IP forward
  sysctl -w net.ipv4.ip_forward=1 >/dev/null || true
  log "IP forward activé"

  # qmi-network config commune
  # FIX: qmi-proxy=yes cause une erreur de syntaxe quand sourcé par le shell.
  # On le retire. Si besoin de proxy, qmi-network devrait le gérer autrement ou on espère que le device-open-proxy ailleurs suffit.
  cat >/etc/qmi-network.conf <<EOF
APN=${APN}
IP_TYPE=4
PROFILE=1
EOF
  log "Écrit /etc/qmi-network.conf (APN=${APN})"

  # ModemManager casse les pieds avec QMI
  if systemctl is-active --quiet ModemManager.service; then
    log "Arrêt de ModemManager"
    systemctl stop ModemManager || true
  fi
  if systemctl is-enabled --quiet ModemManager.service; then
    log "Désactivation de ModemManager"
    systemctl disable ModemManager || true
  fi
}

### DÉTECTION PAIRES (bridges <-> cdc-wdm) ###
detect() {
  command -v netplan >/dev/null && netplan apply || true

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

### QMI PROXY ###
qmi_proxy_up() {
  local dev="$1"
  if ! pgrep -f "qmi-proxy -d ${dev}" >/dev/null 2>&1; then
    log "[$dev] Démarrage de qmi-proxy"
    nohup qmi-proxy -d "$dev" >>/var/log/qmi-proxy.log 2>&1 &
    sleep 1
  fi
}

### ATTENTE DE REGISTRATION RADIO ###
wait_registered() {
  local dev="$1" tries="${2:-60}"
  for ((i=1; i<=tries; i++)); do
    local S
    S=$(qmicli -d "$dev" --device-open-proxy --nas-get-serving-system 2>/dev/null || true)
    if echo "$S" | grep -q "Registration state: 'registered'"; then
      # On accepte "registered" même si PS n'est pas "attached" (le start network forcera l'attachement)
      perlog "${dev##*/}" "Modem registered (PS state ignored)"
      return 0
    fi
    if (( i % 10 == 0 )); then
      perlog "${dev##*/}" "Attente registration… ($i/$tries)"
      # Log du status court (ex: 'searching', 'denied')
      local status
      status=$(echo "$S" | grep "Registration state" | xargs)
      perlog "${dev##*/}" "Status: $status"
    fi
    sleep 2
  done
  return 1
}

### RESET AT (CFUN=1,1) ###
soft_reset() {
  local tag="$1"
  for AT in /dev/ttyUSB2 /dev/ttyUSB0; do
    if [[ -e "$AT" ]]; then
      perlog "$tag" "Soft reset via $AT (AT+CFUN=1,1)"
      { printf 'AT\r\nATI\r\nAT+CFUN=1,1\r\n' >"$AT"; } || true
      sleep 15
      return 0
    fi
  done
  perlog "$tag" "Aucun port AT trouvé pour soft reset"
  return 1
}

### CYCLE USB ###
usb_cycle() {
  local tag="$1" dev="$2"
  local SYS
  SYS=$(udevadm info -q path -n "$dev" 2>/dev/null || true)
  if [[ -z "$SYS" ]]; then
    perlog "$tag" "usb_cycle: sysfs introuvable pour $dev"
    check_power "$tag"
    return 1
  fi

  local P="$SYS"
  while [[ "$P" != "/" && ! -e "/sys$P/driver" ]]; do
    P="$(dirname "$P")"
  done
  local DEVNAME
  DEVNAME=$(basename "$P")

  if [[ ! -e /sys/bus/usb/drivers/usb/unbind ]]; then
    perlog "$tag" "usb_cycle: /sys/bus/usb/drivers/usb/unbind absent"
    return 1
  fi

  perlog "$tag" "USB unbind $DEVNAME"
  echo "$DEVNAME" > /sys/bus/usb/drivers/usb/unbind || perlog "$tag" "usb unbind: erreur (inoffensif)"

  sleep 2
  perlog "$tag" "USB bind $DEVNAME"
  echo "$DEVNAME" > /sys/bus/usb/drivers/usb/bind || perlog "$tag" "usb bind: erreur (inoffensif)"
  sleep 6
}

### MAP /dev/cdc-wdmX -> interface wwu*/wwan* (sysfs) ###
find_iface_for_dev() {
  local dev="$1"
  local SYS
  SYS=$(udevadm info -q path -n "$dev" 2>/dev/null || true)
  [[ -z "$SYS" ]] && return 1

  # remonte jusqu'au noeud USB (…/usbX/2-1.2/2-1.2.1/2-1.2.1:1.5)
  local P
  P="$(dirname "$SYS")"
  P="$(dirname "$P")"

  local NETDIR="/sys${P}/net"
  if [[ ! -d "$NETDIR" ]]; then
    return 1
  fi

  # première interface réseau de ce device
  local IFACE
  IFACE=$(ls "$NETDIR" 2>/dev/null | head -n1 || true)
  [[ -n "$IFACE" ]] && echo "$IFACE"
}

### SOUS-RÉSEAU DU BRIDGE ###
subnet_of_bridge() {
  local br="$1"
  # ex: "10.10.4.0/24 dev br-4g-bibou proto kernel src 10.10.4.1"
  ip -4 route show dev "$br" | awk '/proto kernel/ {print $1; exit}'
}

### GARANTIR ROUTE & RULE POUR UN BRIDGE + TABLE ###
ensure_routing() {
  local tag="$1" br="$2" ifc="$3" table="$4"

  local SUBNET
  SUBNET=$(subnet_of_bridge "$br")
  if [[ -z "$SUBNET" ]]; then
    perlog "$tag" "ensure_routing: bridge $br sans route kernel, abort"
    return 1
  fi

  # Table dans rt_tables si pas déjà là
  local tID
  tID=$((RT_BASE_ID + ${table#wwan}))

  if ! grep -qE "^[[:space:]]*${tID}[[:space:]]+${table}\$" /etc/iproute2/rt_tables; then
    echo "${tID} ${table}" >> /etc/iproute2/rt_tables
    perlog "$tag" "Ajout de la table ${table} (${tID}) dans /etc/iproute2/rt_tables"
  fi

  # Route par défaut dans la table
  ip route replace default dev "$ifc" table "$table" || perlog "$tag" "ip route replace default dev $ifc table $table a échoué"

  # Règle from SUBNET -> table
  if ! ip rule | grep -q "from $SUBNET lookup $table"; then
    ip rule add from "$SUBNET" table "$table"
    perlog "$tag" "Ajout ip rule: from $SUBNET lookup $table"
  fi

  # LOG de debug de la table (Trop verbeux en boucle health-check)
  # perlog "$tag" "Routes pour table $table:"
  # ip route show table "$table" | sed "s/^/[${tag}][route-$table] /" || true
}

### PROGRAMMATION D’UNE PAIRE (modem + bridge) ###
program_pair() {
  local idx="$1" dev="$2" br="$3"
  local tag="${dev##*/}↔${br}"
  local table="wwan${idx}"

  perlog "$tag" "=== worker start (table=$table) ==="

  qmi_proxy_up "$dev"

  while true; do
    set +e

    perlog "$tag" "Nettoyage session QMI précédente"
    # qmi-network stop ne marche pas bien avec proxy, on tente un stop best-effort via qmicli (CID inconnu = fail souvent, pas grave)
    # qmicli -d "$dev" --device-open-proxy --wds-stop-network=... (impossible sans CID)
    # On laisse courir, le start suivant ou le reset gérera.
    # rm -f "/tmp/qmi-network-state-${dev##*/}"
    # pkill -f "qmicli -d $dev" || true

    # Online + LTE
    qmicli -d "$dev" --device-open-proxy --dms-set-operating-mode=online \
      >/dev/null 2>&1 || true
    qmicli -d "$dev" --device-open-proxy \
      --nas-set-system-selection-preference="mode-preference=lte" \
      >/dev/null 2>&1 || true

    if ! wait_registered "$dev" 60; then
      perlog "$tag" "registration timeout → soft reset"
      set -e
      soft_reset "$tag"
      sleep 8
      set +e
      if ! wait_registered "$dev" 60; then
        perlog "$tag" "Toujours pas registered → usb cycle"
        usb_cycle "$tag" "$dev" || true
        sleep 8
      fi
    fi

    # Laisser le temps au noyau de créer l'interface si pas deja la
    local ifc
    ifc=$(find_iface_for_dev "$dev" || true)

    perlog "$tag" "qmi start (direct wds)"
    
    # 0. CHECK DATA FORMAT (Raw-IP vs 802-3)
    # Au lieu de forcer raw-ip (ce qui fail si le modem est capricieux), on demande ce qu'il veut.
    local qmi_format
    if qmi_format=$(qmicli -d "$dev" --device-open-proxy --wda-get-data-format 2>/dev/null); then
       if echo "$qmi_format" | grep -q "raw-ip"; then
          perlog "$tag" "Modem est en mode Raw-IP. Sync Kernel..."
          if [[ -n "$ifc" ]]; then
             ip link set "$ifc" down >/dev/null 2>&1 || true
             echo 'Y' > "/sys/class/net/$ifc/qmi/raw_ip" 2>/dev/null || perlog "$tag" "[WARN] Echec écriture raw_ip=Y"
             ip link set "$ifc" up >/dev/null 2>&1 || true
          fi
       else
          perlog "$tag" "Modem est en mode 802-3 (Ethernet)."
          if [[ -n "$ifc" ]]; then
             # S'assurer que le kernel n'est PAS en raw-ip
             if [[ -f "/sys/class/net/$ifc/qmi/raw_ip" ]]; then
                ip link set "$ifc" down >/dev/null 2>&1 || true
                echo 'N' > "/sys/class/net/$ifc/qmi/raw_ip" 2>/dev/null || true
                ip link set "$ifc" up >/dev/null 2>&1 || true
             fi
          fi
       fi
    else
       perlog "$tag" "[WARN] Impossible de lire le format de données wda. On force raw-ip (Kernel + Modem)."
       # Fallback strategy: On parie sur Raw-IP (le plus commun sur SIM7600 récent)
       if [[ -n "$ifc" ]]; then
          ip link set "$ifc" down >/dev/null 2>&1 || true
          # FORCE KERNEL RAW-IP 'Y'
          echo 'Y' > "/sys/class/net/$ifc/qmi/raw_ip" 2>/dev/null || perlog "$tag" "[WARN] Echec écriture raw_ip=Y (Fallback)"
          ip link set "$ifc" up >/dev/null 2>&1 || true
       fi
       # Et on essaie de le dire au modem aussi (best effort)
       qmicli -d "$dev" --device-open-proxy --wda-set-data-format=raw-ip >/dev/null 2>&1 || true
    fi

    # 2. Start Network
    local wds_log
    if ! wds_log=$(qmicli -d "$dev" --device-open-proxy --wds-start-network="apn='${APN}',ip-type=4" --client-no-release-cid 2>&1); then
      perlog "$tag" "qmi start (wds) FAILED: $wds_log"
      
      # Diagnostic SIM/PIN
      local pin_status
      if pin_status=$(qmicli -d "$dev" --device-open-proxy --dms-uim-get-pin-status 2>&1); then
         perlog "$tag" "[DIAGNOSTIC SIM] $pin_status"
      fi
      
      sleep 3
      continue
    fi
    
    # Re-verify interface
    sleep 2
    if [[ -z "$ifc" ]]; then
        ifc=$(find_iface_for_dev "$dev" || true)
    fi

    perlog "$tag" "IFC détectée via sysfs: $ifc"
    if [[ -z "$ifc" ]]; then
      perlog "$tag" "Aucune interface wwu*/wwan* trouvée → retry"
      sleep 3
      continue
    fi

    ip link set "$ifc" up || perlog "$tag" "ip link set $ifc up a échoué (on continue)"
    sysctl -w "net.ipv4.conf.${ifc}.rp_filter=2" >/dev/null || true

    # DHCP initial
    perlog "$tag" "DHCP sur $ifc (udhcpc)"
    if ! udhcpc -i "$ifc" -q -n -t 8 -T 3; then
      perlog "$tag" "DHCP FAILED sur $ifc → retry"
      # Si DHCP fail, ça peut être le raw-ip qui est mal passé.
      # On va retry la boucle, donc ça refera un down/up
      sleep 3
      continue
    fi

    # S'assurer que routage & ip rule sont corrects
    ensure_routing "$tag" "$br" "$ifc" "$table"

    set -e
    local IP4
    IP4=$(ip -4 -o addr show dev "$ifc" | awk '{print $4}')
    perlog "$tag" "UP $IP4 | TABLE=$table"

    ### BOUCLE HEALTH-CHECK ###
    while true; do
      if ping -c1 -W3 -I "$ifc" "$PING_DST" >/dev/null 2>&1; then
        # Sanity-check : route & rule toujours là ?
        ensure_routing "$tag" "$br" "$ifc" "$table" || true
        sleep 15
        continue
      fi

      perlog "$tag" "health BAD → tentative de réparation"
      
      # 0) Vérifier si le device physique est toujours là
      if [[ ! -e "$dev" ]]; then
         perlog "$tag" "Device $dev a disparu ! Fin de la boucle -> Restart"
         check_power "$tag"
         break
      fi

      # 1) DHCP renew
      if udhcpc -i "$ifc" -q -n -t 3 -T 3; then
        perlog "$tag" "DHCP renew OK sur $ifc"
        ensure_routing "$tag" "$br" "$ifc" "$table" || true
        continue
      fi

      # 2) Restart QMI session "light"
      set +e
      perlog "$tag" "Tentative restart QMI (Start WDS direct)"
      # On ne stop pas vraiment (pas de CID), on relance start
      local restart_log
      if restart_log=$(qmicli -d "$dev" --device-open-proxy --wds-start-network="apn='${APN}',ip-type=4" --client-no-release-cid 2>&1); then
        sleep 5
        # Re-détection interface (au cas où elle change)
        local new_ifc
        new_ifc=$(find_iface_for_dev "$dev" || true)
        [[ -n "$new_ifc" ]] && ifc="$new_ifc"
        perlog "$tag" "Après restart QMI, IFC=$ifc"
        if udhcpc -i "$ifc" -q -n -t 3 -T 3 >/dev/null 2>&1; then
          perlog "$tag" "DHCP après restart QMI OK"
          set -e
          ensure_routing "$tag" "$br" "$ifc" "$table" || true
          continue
        fi
      else
        perlog "$tag" "Restart QMI Failed: $restart_log"
        # Diagnostic SIM/PIN
        qmicli -d "$dev" --device-open-proxy --dms-uim-get-pin-status 2>&1 | grep -i "status:" | while read -r line; do
           perlog "$tag" "[DIAGNOSTIC SIM] $line"
        done || true
      fi
      set -e

      # 3) Soft reset + usb cycle
      perlog "$tag" "Soft reset + USB cycle"
      soft_reset "$tag" || true
      sleep 10
      if ! ping -c1 -W3 -I "$ifc" "$PING_DST" >/dev/null 2>&1; then
        usb_cycle "$tag" "$dev" || true
        sleep 10
      fi

      perlog "$tag" "Réparation complète effectuée, on relance un bring-up complet"
      break   # sort de la health-loop → retour en haut de la boucle principale
    done
  done
}

### MAIN ###
main() {
  ensure_prereqs
  detect

  while (( N == 0 )); do
    log "No pairs yet (bridges=${#BRIDGES[@]} qmi=${#QMI_DEVS[@]}) — retry in 5s…"
    sleep 5
    detect
  done

  log "Pairs détectées :"
  for ((i=0; i<N; i++)); do
    echo " - ${QMI_DEVS[i]} ↔ ${BRIDGES[i]}"
  done | tee -a "$LOG"

  for ((i=0; i<N; i++)); do
    program_pair "$i" "${QMI_DEVS[i]}" "${BRIDGES[i]}" &
    sleep 1
  done

  wait
}

main
