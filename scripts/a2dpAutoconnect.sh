#!/bin/bash
# UDEV handler: auto start/stop bluealsa-aplay on BT device connect/disconnect

BTMAC=${NAME//\"/}

log() {
  echo "[$(date)] $*" | systemd-cat -t bluetooth-input -p info
}

if echo "$BTMAC" | grep -qE "^([0-9A-F]{2}:){5}[0-9A-F]{2}$"; then
  if [ "$ACTION" = "add" ]; then
    log "BT device connected: $BTMAC"
    sudo systemctl start "bluealsa-aplay@${BTMAC}.service"
  elif [ "$ACTION" = "remove" ]; then
    log "BT device disconnected: $BTMAC"
    sudo systemctl stop "bluealsa-aplay@${BTMAC}.service"
  fi
fi
