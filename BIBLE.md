# MASTER SPECIFICATION: 4G PROXY FARM SYSTEM

**Project Name:** 4G-Farm-Master
**Target Developer:** Antigravity (AI)
**Language:** TypeScript (Node.js for Worker, Next.js for Manager)
**System Target:** Raspberry Pi OS (Debian Bullseye/Bookworm) for Workers, Linux VPS for Manager.
**Architecture:** Centralized Manager (Load Balancer/UI) + Distributed Workers.

---

## 0. PRÉREQUIS D'INFRASTRUCTURE & RÉSEAU (CRITIQUE)

**Hypothèse de connectivité :**
Pour simplifier le code et assurer la stabilité, nous partons du principe que le **Manager** et les **Workers** sont connectés via un réseau privé virtuel (VPN) type **Tailscale** ou **WireGuard**.
* Le Manager peut pinger l'IP VPN du Worker.
* Le Worker peut pinger l'IP VPN du Manager.
* *Note pour Antigravity : Ne code pas de tunnel TCP complexe. Utilise les IP locales du VPN pour le routage de trafic.*

---

## 1. STRUCTURE DU PROJET (MONOREPO)

```text
/
├── /apps
│   ├── /manager      # Next.js Application (UI + API + TCP Load Balancer)
│   └── /worker       # Node.js Service (Runs on Raspberry Pi)
├── /packages
│   └── /shared       # Types TypeScript partagés (Interfaces WebSocket, Enums)
└── package.json
2. APPLICATION 1 : LE WORKER (/apps/worker)
Rôle : Gérer le hardware USB, la connexion 4G, le routage Linux et les processus 3proxy. OS : Linux (Raspberry Pi). DOIT s'exécuter en root (sudo).

2.1. Détection Hardware & Mapping (The Physical Layer)
Le worker doit scanner les ports USB pour trouver les modems compatibles QMI (Quectel EC25, Huawei, etc.).

Logique de découverte :

Scanner le dossier /sys/bus/usb/devices/.

Pour chaque device, vérifier s'il possède une interface réseau (wwanX ou usbX) et un port charactère QMI (/dev/cdc-wdmX).

Algorithme de Mapping : Il est impératif d'associer le cdc-wdm (contrôle) à l'interface réseau wwan (data) correspondante.

Commande de recherche : Utiliser udevadm info ou parser les liens symboliques dans /sys/class/net/.

Résultat attendu : Un objet ModemDevice :

TypeScript

interface ModemDevice {
  id: string;          // ex: "modem_1" (basé sur le port USB physique ou IMEI)
  interface: string;   // ex: "wwan0"
  qmiPath: string;     // ex: "/dev/cdc-wdm0"
  sysPath: string;     // ex: "/sys/bus/usb/devices/1-1.2"
}
2.2. Gestionnaire de Connexion (Network & QMI Logic)
L'IA doit utiliser qmicli (libqmi-utils) et ip (iproute2). Ne pas utiliser NetworkManager, on gère tout "à la main" pour éviter les conflits.

Séquence de Démarrage d'un Modem (A coder séquentiellement) :

Check SIM Status : qmicli -d /dev/cdc-wdm0 --uim-get-sim-state

Attendu : "SIM READY". Si "PIN NEEDED", envoyer le PIN.

Configuration Data Format (Raw-IP) : C'est obligatoire pour les modems modernes 4G/5G.

Bash

ip link set wwan0 down
echo 'Y' > /sys/class/net/wwan0/qmi/raw_ip
ip link set wwan0 up
Connexion au réseau mobile (APN) :

Bash

qmicli -d /dev/cdc-wdm0 --wds-start-network="apn='internet',ip-type=4" --client-no-release-cid
Important : Garder le CID ou Packet Data Handle retourné pour pouvoir déconnecter proprement.

Récupération IP & DHCP Client : Ne pas utiliser dhclient standard car il écrase la Gateway par défaut du Raspberry Pi. Utiliser udhcpc en mode "script only".

Bash

udhcpc -i wwan0 -q -f -n --no-default-config --script /path/to/custom_script.sh
Alternative (Mieux) : Parser la sortie de qmicli -d /dev/cdc-wdm0 --wds-get-current-settings.

Variables récupérées : IP_ADDRESS, GATEWAY, SUBNET.

2.3. Routage Avancé (Source Based Routing) - CRITIQUE
Chaque modem doit avoir sa propre table de routage pour que le trafic entrant par le Proxy ressorte par le bon modem.

Algorithme de configuration IP (Pour chaque modem i) : Supposons : Modem 0 (wwan0), IP: 10.0.0.5, Gateway: 10.0.0.1. On assigne une Route Table ID arbitraire (ex: 100 + index du modem).

Bash

# 1. Assigner l'IP à l'interface
ip addr add 10.0.0.5/24 dev wwan0

# 2. Nettoyer les anciennes règles pour cette table
ip route flush table 100

# 3. Ajouter la route par défaut DANS la table 100
ip route add default via 10.0.0.1 dev wwan0 table 100

# 4. Ajouter la règle de routing (Policy Routing)
# "Tout paquet venant de 10.0.0.5 doit utiliser la table 100"
ip rule add from 10.0.0.5 table 100 priority 100
Note : Le code doit vérifier si la règle existe déjà pour ne pas la dupliquer à l'infini.

2.4. Le Service Proxy (3proxy)
Le Worker génère un fichier de config et lance un process 3proxy dédié par modem.

Template de configuration (3proxy_modemID.cfg) :

Plaintext

daemon
nserver 8.8.8.8
nserver 1.1.1.1
nscache 65536
timeouts 1 5 30 60 180 1800 15 60
# Authentification
auth strong
users "USERNAME:CL:PASSWORD"
allow USERNAME

# Le point clé : Bindings
# -i : IP d'écoute (Celle du VPN ou 0.0.0.0)
# -e : IP de sortie (Celle du modem 4G - CRUCIAL)
proxy -p[PORT_HTTP] -i0.0.0.0 -e[MODEM_IP_ADDRESS]
socks -p[PORT_SOCKS] -i0.0.0.0 -e[MODEM_IP_ADDRESS]

flush
Le worker doit stocker les PIDs des processus 3proxy pour pouvoir les tuer (kill) proprement.

2.5. Watchdog & Monitoring
Boucle infinie (Interval: 30s) :

Ping Test : Faire un curl/ping via l'interface spécifique. curl --interface wwan0 https://connectivitycheck.gstatic.com/generate_204 -m 5

Gestion d'erreur :

1 échec : Retry.

3 échecs consécutifs : Reboot Modem Sequence.

Stop 3proxy.

qmicli ... --wds-stop-network.

Wait 5s.

Start Network Sequence.

Start 3proxy.

3. APPLICATION 2 : LE MANAGER (/apps/manager)
Stack : Next.js (App Router), Prisma (SQLite), Socket.io (Server), Custom Node Server.

3.1. Custom Server (server.ts)
On ne peut pas utiliser le serveur Next.js par défaut car nous devons ouvrir des ports TCP dynamiquement. Le fichier d'entrée doit initialiser :

L'app Next.js (sur port 3000) pour le Dashboard.

Un serveur Socket.io (intégré au serveur HTTP).

Le Proxy Server Manager (une classe qui gère les serveurs net.createServer).

3.2. Load Balancer & TCP Forwarding (Le Cœur)
C'est le point d'entrée pour les utilisateurs.

Base de données (Schema Prisma) :

Code snippet

model Worker {
  id        String   @id
  name      String
  ip        String   // IP VPN du Worker
  status    String   // ONLINE, OFFLINE
  modems    Modem[]
}

model Modem {
  id          String  @id @default(uuid())
  workerId    String
  worker      Worker  @relation(fields: [workerId], references: [id])
  interfaceId String  // ex: wwan0
  
  // Configuration Proxy (Entrée)
  entryPortHttp  Int  @unique // Le port ouvert sur le Manager (ex: 10001)
  entryPortSocks Int  @unique // Le port ouvert sur le Manager (ex: 10002)
  
  // Configuration Worker (Sortie vers Worker)
  targetIp    String  // Copie de Worker IP
  targetPortHttp  Int // Port local sur le RPi (ex: 20001)
  targetPortSocks Int // Port local sur le RPi (ex: 20002)

  proxyUser   String
  proxyPass   String
}
Logique du TCP Forwarder : Au démarrage (et lors de l'ajout d'un proxy), le Manager doit lancer des écouteurs TCP.

TypeScript

// Pseudocode pour Antigravity
import net from 'net';

function startProxyListener(entryPort, targetIp, targetPort) {
  const server = net.createServer((clientSocket) => {
    // Connexion vers le Worker (via VPN)
    const upstream = net.createConnection({ host: targetIp, port: targetPort });

    // Piping bidirectionnel
    clientSocket.pipe(upstream);
    upstream.pipe(clientSocket);

    // Gestion d'erreurs (fermeture propre)
    clientSocket.on('error', () => upstream.destroy());
    upstream.on('error', () => clientSocket.destroy());
  });
  
  server.listen(entryPort, () => console.log(`Proxy listening on ${entryPort}`));
}
3.3. API & Communication WebSocket
Protocole de communication (Events) :

Handshake (Worker -> Manager) :

Event: register_worker

Payload: { id: "mac-address", ip: "vpn-ip" }

Action Manager: Enregistre le worker en DB.

State Sync (Worker -> Manager) :

Event: worker_status

Payload: [{ interface: "wwan0", ip: "10.x.x.x", signal: -80, status: "UP" }, ...]

Action Manager: Met à jour l'UI en temps réel.

Actions (Manager -> Worker) :

Event: reboot_modem -> Payload: { interface: "wwan0" }

Event: rotate_ip -> Payload: { interface: "wwan0" } (Toggle Airplane mode).

Event: update_auth -> Payload: { user: "...", pass: "..." } (Worker doit régénérer conf 3proxy et reload).

3.4. Interface Utilisateur (UI)
Page Dashboard : Grille de cartes. Chaque carte = 1 Modem.

Affichage : Nom du Worker, ID Modem, Signal Bar (visuel), IP Publique, Uptime.

Boutons : [REBOOT], [ROTATE IP].

Inputs : Username / Password (avec bouton Save).

Page Workers : Liste technique des RPis (CPU, RAM, Température).

4. DÉTAILS TECHNIQUES SPÉCIFIQUES (RECHERCHE PRÉ-MÂCHÉE)
4.1. Rotation d'IP (Airplane Mode)
Pour changer d'IP sans rebooter tout le RPi, il faut resetter la stack radio du modem. Commande QMI à utiliser :

Passer en mode "Low Power" (Offline) : qmicli -d /dev/cdc-wdm0 --dms-set-operating-mode=low-power

Attendre 2 secondes.

Passer en mode "Online" : qmicli -d /dev/cdc-wdm0 --dms-set-operating-mode=online

Attendre que la connexion remonte (le Watchdog s'en chargera).

4.2. Gestion des Ports
Ports Worker : Plage 20000-29999. Chaque modem prend 2 ports (HTTP/SOCKS). Ex: Modem 1 = 20000/20001.

Ports Manager (Entrée) : Plage 30000-39999.

L'IA doit implémenter une logique d'allocation de ports incrémentale en DB.

4.3. Installation des dépendances Worker
Le Worker aura besoin d'un script setup.sh pour installer les binaires : apt-get install libqmi-utils udhcpc iproute2 3proxy (si 3proxy pas dans les repos, prévoir script de compilation).

5. DÉROULEMENT DU CODAGE (PLAN POUR L'IA)
Phase 1 : Worker Core. Créer le wrapper TypeScript autour de qmicli et ip. Réussir à connecter un modem et pinger Google via l'interface wwan0.

Phase 2 : Worker Proxy. Intégrer 3proxy et la génération de config dynamique.

Phase 3 : Manager Server. Mettre en place le serveur Custom Node + TCP Proxy logic.

Phase 4 : Link. Connecter Worker et Manager via WebSocket et synchroniser les états.

Phase 5 : UI. Créer le Dashboard Next.js.