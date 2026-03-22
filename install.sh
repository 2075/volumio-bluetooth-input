#!/bin/bash
echo "Installing Bluetooth Audio Input dependencies"

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"

# Detect Debian version
DEBIAN_VERSION="unknown"
if grep -q "buster" /etc/os-release 2>/dev/null; then
  DEBIAN_VERSION="buster"
elif grep -q "bookworm" /etc/os-release 2>/dev/null; then
  DEBIAN_VERSION="bookworm"
elif grep -q "bullseye" /etc/os-release 2>/dev/null; then
  DEBIAN_VERSION="bullseye"
fi
echo "Detected Debian: ${DEBIAN_VERSION}"

echo "Installing system packages..."
sudo apt-get update
sudo apt-get -y install bluez pi-bluetooth --no-install-recommends

if [ "$DEBIAN_VERSION" = "buster" ]; then
  echo "Buster detected - installing build deps and compiling bluez-alsa..."
  sudo apt-get -y install \
    dh-autoreconf libasound2-dev libortp-dev \
    libusb-dev libglib2.0-dev libudev-dev libical-dev \
    libreadline-dev libsbc1 libsbc-dev --no-install-recommends

  cd /tmp
  if [ ! -d "bluez-alsa" ]; then
    git clone https://github.com/Arkq/bluez-alsa.git
    cd bluez-alsa
    git checkout v4.0.0
  else
    cd bluez-alsa
    git checkout v4.0.0
  fi
  autoreconf --install
  mkdir -p build && cd build
  ../configure --disable-hcitop --with-alsaplugindir=/usr/lib/arm-linux-gnueabihf/alsa-lib
  make -j$(nproc)
  sudo make install
  cd "${PLUGIN_DIR}"
else
  echo "Installing bluez-alsa-utils from apt..."
  sudo apt-get -y install bluez-alsa-utils --no-install-recommends
fi

echo "Deploying systemd service units..."
sudo cp "${PLUGIN_DIR}/systemd/bluealsa.service" /lib/systemd/system/bluealsa.service
sudo cp "${PLUGIN_DIR}/systemd/bluealsa-aplay@.service" /lib/systemd/system/bluealsa-aplay@.service
sudo cp "${PLUGIN_DIR}/systemd/bt-agent.service" /lib/systemd/system/bt-agent.service

INSTALL_DIR="/data/plugins/audio_interface/bluetooth_input"

echo "Deploying scripts..."
sudo mkdir -p "${INSTALL_DIR}/scripts"
sudo cp "${PLUGIN_DIR}/scripts/a2dpAutoconnect.sh" "${INSTALL_DIR}/scripts/a2dpAutoconnect.sh"
sudo cp "${PLUGIN_DIR}/scripts/btAgent.sh" "${INSTALL_DIR}/scripts/btAgent.sh"
sudo chmod 755 "${INSTALL_DIR}/scripts/a2dpAutoconnect.sh"
sudo chmod 755 "${INSTALL_DIR}/scripts/btAgent.sh"

echo "Deploying UDEV rule..."
sudo tee /etc/udev/rules.d/99-bluetooth-input.rules > /dev/null <<EOF
KERNEL=="input[0-9]*", RUN+="${INSTALL_DIR}/scripts/a2dpAutoconnect.sh"
EOF

echo "Configuring Bluetooth subsystem..."
sudo mkdir -p /etc/bluetooth

# Build the [General] settings block for headless A2DP sink
BT_MAIN="/etc/bluetooth/main.conf"
if [ ! -f "$BT_MAIN" ] || ! grep -q '^\[General\]' "$BT_MAIN"; then
  echo -e "\n[General]" | sudo tee -a "$BT_MAIN" > /dev/null
fi
for setting in \
  "Class = 0x200428" \
  "DiscoverableTimeout = 0" \
  "PairableTimeout = 0" \
  "AutoEnable=true"; do
  key=$(echo "$setting" | cut -d= -f1 | sed 's/ //g')
  if ! grep -q "^${key}" "$BT_MAIN" 2>/dev/null; then
    sudo sed -i "/^\[General\]/a ${setting}" "$BT_MAIN"
  fi
done

echo "Reloading systemd and udev..."
sudo systemctl daemon-reload
sudo systemctl enable bluealsa.service
sudo systemctl enable bt-agent.service
sudo udevadm control --reload-rules
sudo udevadm trigger

echo "plugininstallend"
