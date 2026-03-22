#!/bin/bash
# Persistent Bluetooth agent for headless "Just Works" pairing.
# Runs as a systemd service so the NoInputNoOutput agent is always
# registered, regardless of the Node.js plugin lifecycle.

# Feed commands then keep stdin open so bluetoothctl stays alive
{
  sleep 1
  echo "power on"
  sleep 0.5
  echo "agent NoInputNoOutput"
  sleep 0.5
  echo "default-agent"
  sleep 0.5
  echo "pairable on"
  sleep 0.5
  echo "discoverable on"

  # Keep the process alive forever; auto-accept any interactive prompts
  while true; do
    sleep 2
    echo "yes"
  done
} | bluetoothctl
