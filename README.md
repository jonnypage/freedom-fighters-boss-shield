# Dual Button WLED Control System

This project implements a two-button control system using two Raspberry Pis to control a WLED light controller. When both buttons (Enter keys) are pressed simultaneously, the lights turn off for 10 seconds and then automatically turn back on.

## Setup Instructions

### Prerequisites
- Two Raspberry Pis (primary and secondary)
- Node.js installed on both Raspberry Pis
- USB keyboards connected to both Raspberry Pis
- WLED controller set up and accessible on the network

### Installation

1. Clone this repository on both Raspberry Pis
2. Install dependencies on both Pis:
   ```bash
   npm install
   ```

### Configuration

1. On the primary Pi (ff-primary):
   - Verify the WLED_IP in `primary.js` matches your WLED controller's IP address
   - Check the KEYBOARD_DEVICE path matches your USB keyboard (usually `/dev/input/event0`)
   - Run the primary server:
     ```bash
     npm run start-primary
     ```

2. On the secondary Pi (ff-secondary):
   - Verify the PRIMARY_PI_ADDRESS in `secondary.js` points to your primary Pi
   - Check the KEYBOARD_DEVICE path matches your USB keyboard
   - Run the secondary client:
     ```bash
     npm run start-secondary
     ```

### Network Setup
- Ensure both Raspberry Pis are on the same network
- Make sure the hostnames 'ff-primary' and 'ff-boss-wled' are properly configured in your network's DNS or in the Pis' /etc/hosts files

## Usage
1. Start the primary server on ff-primary
2. Start the secondary client on ff-secondary
3. Press the Enter keys on both keyboards simultaneously
4. The lights will turn off for 10 seconds and then automatically turn back on
5. Repeat as desired

## Troubleshooting
- If the keyboard input isn't working, verify the correct keyboard device path
- If the Pis can't connect, check network connectivity and hostname resolution
- If WLED control isn't working, verify the WLED controller's IP address and network connectivity 