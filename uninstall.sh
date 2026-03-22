#!/bin/bash
echo "Uninstalling Bluetooth Audio Input"

echo "Stopping services..."
sudo systemctl stop bt-agent.service 2>/dev/null
sudo systemctl disable bt-agent.service 2>/dev/null
sudo systemctl stop bluealsa.service 2>/dev/null
sudo systemctl disable bluealsa.service 2>/dev/null

# Stop any running bluealsa-aplay instances
for svc in $(systemctl list-units --type=service --no-legend 'bluealsa-aplay@*' 2>/dev/null | awk '{print $1}'); do
  sudo systemctl stop "$svc" 2>/dev/null
done

echo "Removing systemd units..."
sudo rm -f /lib/systemd/system/bluealsa.service
sudo rm -f /lib/systemd/system/bluealsa-aplay@.service
sudo rm -f /lib/systemd/system/bt-agent.service
sudo rm -rf /etc/systemd/system/bluealsa-aplay@*.service.d

echo "Removing UDEV rule..."
sudo rm -f /etc/udev/rules.d/99-bluetooth-input.rules

echo "Reverting Bluetooth configuration..."
if [ -f /etc/bluetooth/main.conf ]; then
  sudo sed -i '/^Class = 0x200428$/d' /etc/bluetooth/main.conf
fi

echo "Reloading systemd and udev..."
sudo systemctl daemon-reload
sudo udevadm control --reload-rules

echo "Uninstall complete"
