# Freedom Fighters: Boss Shield

*This project was created 100% by a Claude AI agent*

This project implements a two-button control system using two Raspberry Pis to control a WLED light controller. When both buttons (Enter keys on Logitech K400 Plus keyboards) are pressed simultaneously, it triggers a shield-breaking effect with various visual stages.

## Features

### Shield States
The system implements a strict state machine with the following states:
- ACTIVE: Shield is up and functioning
- SHATTERING: Shield is in the process of breaking
- BROKEN: Shield is down
- REGENERATING: Shield is regenerating
- BOSS_DEAD: Boss death sequence active
- POWER_OFF: Shield is powered down

### Web Interface
A web-based control interface is available on port 3000 that provides:
- Real-time shield status display with visual effects
- Button state monitoring
- Manual control options (trigger break, reset, power down)
- Boss death sequence trigger
- Countdown timer during shield break
- Status message log
- No-cache headers for reliable updates on mobile devices

## Setup Instructions

### Prerequisites
- Two Raspberry Pis (primary and secondary)
- Node.js installed on both Raspberry Pis
- Logitech K400 Plus keyboards connected to both Raspberry Pis
- WLED controller set up and accessible on the network

### Installation

1. Clone this repository on both Raspberry Pis
2. Install dependencies on both Pis:
   ```bash
   npm install
   ```

### Configuration

1. On the primary Pi:
   - Verify the WLED_IP in `primary.js` matches your WLED controller's IP address (default: 192.168.8.212)
   - The system will automatically detect the Logitech K400 Plus keyboard
   - Configure systemd to auto-start the service on boot
   - Web interface will be available at http://[PRIMARY_PI_IP]:3000

2. On the secondary Pi:
   - Verify the PRIMARY_PI_ADDRESS in `secondary.js` points to your primary Pi (default: ws://192.168.8.142:8080)
   - The system will automatically detect the Logitech K400 Plus keyboard
   - Configure systemd to auto-start the service on boot

### Network Setup
- Ensure both Raspberry Pis are on the same network
- The primary Pi runs a WebSocket server on port 8080
- The primary Pi runs a web interface on port 3000
- The secondary Pi connects to the primary Pi as a WebSocket client

## Shield Effect Sequence
When both Enter keys are pressed within 500ms of each other:

1. Shield Breaking Effect:
   - Initial full brightness
   - 5 rapid flickers with random brightness and duration
   - Final fade out sequence
   - Audio cue: "shield-broken.mp3"

2. Shield Down Period:
   - Total duration: 15 seconds
   - Shield remains down for first 12 seconds (80% of total time)
   - Visual countdown displayed on web interface

3. Shield Regeneration:
   - Begins at 12 seconds (80% mark)
   - Series of 12 pulses with increasing intensity
   - Pulses speed up exponentially
   - Final bright flash
   - Audio cue: "shield-regenerating.mp3"
   - Returns to full power using preset 1
   - Audio cue: "shield-active.mp3"

## Audio Effects
The system includes audio cues for various states:
- shield-broken.mp3: Plays when shield breaks
- shield-regenerating.mp3: Plays when regeneration begins
- shield-active.mp3: Plays when shield returns to full power

## Error Handling
- Automatic reconnection if WebSocket connection is lost
- Automatic keyboard detection on startup
- Button state timeout after 1 second to prevent stuck states
- Shield automatically resets to full power if an error occurs
- Process-level error handling to prevent crashes
- State machine ensures valid state transitions
- Debounced UI updates to prevent visual glitches

## Auto-Start Configuration
Both Pis are configured to automatically start the application on boot using systemd/journalctl, ensuring the system recovers automatically from power issues or restarts.

## Troubleshooting
- If the keyboard isn't detected, ensure you're using a Logitech K400 Plus keyboard
- If the Pis can't connect, check network connectivity and verify the PRIMARY_PI_ADDRESS
- If WLED control isn't working, verify the WLED controller's IP address and network connectivity
- Check journalctl logs for any startup or runtime errors
- Verify both services are running with `systemctl status`
- If the web interface shows incorrect states, try clearing browser cache or using incognito mode
- Monitor the browser console for state transition debugging information 