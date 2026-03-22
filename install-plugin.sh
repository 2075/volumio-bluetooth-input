#!/bin/bash
# Volumio Bluetooth Audio Input - Manual Plugin Installer
# Usage: git clone <repo> /tmp/volumio-bluetooth-input && cd /tmp/volumio-bluetooth-input && bash install-plugin.sh

set -e

PLUGIN_NAME="bluetooth_input"
PLUGIN_CATEGORY="audio_interface"
PLUGIN_DIR="/data/plugins/${PLUGIN_CATEGORY}/${PLUGIN_NAME}"

echo "=== Volumio Bluetooth Audio Input - Plugin Installer ==="

if [ "$(id -u)" -eq 0 ]; then
  echo "Warning: running as root. Plugin files will be owned by volumio user."
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Running install.sh to set up system dependencies..."
sudo bash "${SCRIPT_DIR}/install.sh"

echo "Creating plugin directory at ${PLUGIN_DIR}..."
sudo mkdir -p "${PLUGIN_DIR}"

echo "Copying plugin files..."
sudo cp -r "${SCRIPT_DIR}/index.js" "${PLUGIN_DIR}/"
sudo cp -r "${SCRIPT_DIR}/package.json" "${PLUGIN_DIR}/"
sudo cp -r "${SCRIPT_DIR}/config.json" "${PLUGIN_DIR}/"
sudo cp -r "${SCRIPT_DIR}/UIConfig.json" "${PLUGIN_DIR}/"
sudo cp -r "${SCRIPT_DIR}/i18n" "${PLUGIN_DIR}/"
sudo cp -r "${SCRIPT_DIR}/lib" "${PLUGIN_DIR}/"
sudo cp -r "${SCRIPT_DIR}/scripts" "${PLUGIN_DIR}/"

echo "Installing node dependencies..."
cd "${PLUGIN_DIR}"
sudo npm install --production

echo "Setting ownership..."
sudo chown -R volumio:volumio "${PLUGIN_DIR}"

CONF_DIR="/data/configuration/${PLUGIN_CATEGORY}/${PLUGIN_NAME}"
sudo mkdir -p "${CONF_DIR}"
sudo cp "${SCRIPT_DIR}/config.json" "${CONF_DIR}/"
sudo chown -R volumio:volumio "${CONF_DIR}"

echo "Restarting Volumio..."
volumio vrestart

echo ""
echo "=== Installation complete ==="
echo "Enable the plugin from: Volumio UI > Plugins > Installed Plugins"
