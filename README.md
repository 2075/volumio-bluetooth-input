# Volumio Bluetooth Audio Input

Turn your Volumio device into a Bluetooth audio receiver. Stream music from any Bluetooth-enabled phone, tablet, or computer via A2DP to your Volumio-configured audio output.

## Requirements

- Raspberry Pi with Bluetooth (built-in or USB dongle)
- Volumio 3
- SSH access to the Volumio device

## Installation

SSH into your Volumio device and run:

```bash
git clone https://github.com/2075/volumio-bluetooth-input.git /tmp/volumio-bluetooth-input
cd /tmp/volumio-bluetooth-input
bash install-plugin.sh
```

After installation, enable the plugin from the Volumio web UI under **Plugins > Installed Plugins > Bluetooth Audio Input**.

## Usage

1. Enable the plugin in the Volumio web UI
2. Open the plugin settings (cog icon) to configure the device name and discoverable mode
3. On your phone or tablet, open Bluetooth settings and pair with the Volumio device
4. Play audio -- it will stream to the Volumio output

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| Device Name | Volumio | Bluetooth name advertised to other devices |
| Discoverable | On | Allow other devices to see and connect |
| Auto-Accept Pairing | On | Automatically accept incoming pair requests |

## How It Works

The plugin uses the BlueZ Bluetooth stack and bluez-alsa to receive A2DP audio streams. When a Bluetooth device connects and starts streaming, `bluealsa-aplay` routes the audio to the Volumio-configured ALSA output device. The plugin tracks Volumio's output device setting and automatically reconfigures when it changes.

## Uninstallation

Disable and remove the plugin from the Volumio web UI, or run:

```bash
volumio plugin remove audio_interface bluetooth_input
```

## Troubleshooting

Check service status:

```bash
systemctl status bluealsa.service
systemctl status bluetooth.service
journalctl -u bluealsa.service -f
```

Check if the Bluetooth adapter is detected:

```bash
bluetoothctl show
```

## License

GPL-3.0
