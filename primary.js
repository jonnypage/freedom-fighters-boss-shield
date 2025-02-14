const WebSocket = require('ws');
const InputEvent = require('input-event');
const fetch = require('node-fetch');
const fs = require('fs');
const { execSync } = require('child_process');

// Configuration
const SECONDARY_PI_PORT = 8080;
const WLED_IP = '192.168.8.212'; // Replace with actual IP if needed

let primaryButtonState = { pressed: false, pressTime: null };
let secondaryButtonState = { pressed: false, pressTime: null };
let lightsOff = false;
let input;
let keyboard;

function findKeyboardDevice() {
    try {
        // Read /proc/bus/input/devices to find the Logitech K400 Plus
        const devices = execSync("cat /proc/bus/input/devices").toString();
        const lines = devices.split("\n");
        let foundKeyboard = false;
        let eventId = null;

        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes("Logitech K400") || lines[i].includes("K400 Plus")) {
                foundKeyboard = true;
            }
            if (foundKeyboard && lines[i].includes("Handlers=")) {
                const match = lines[i].match(/event(\d+)/);
                if (match) {
                    eventId = match[1];
                    break;
                }
            }
            if (lines[i] === "") {
                foundKeyboard = false;
            }
        }

        if (eventId !== null) {
            const devicePath = `/dev/input/event${eventId}`;
            console.log(`Found Logitech keyboard at ${devicePath}`);
            return devicePath;
        }
    } catch (error) {
        console.error("Error finding keyboard:", error);
    }
    return null;
}

function initializeKeyboard() {
    const keyboardDevice = findKeyboardDevice();
    if (!keyboardDevice) {
        console.error("Could not find Logitech keyboard!");
        process.exit(1);
    }

    try {
        input = new InputEvent(keyboardDevice);
        keyboard = new InputEvent.Keyboard(input);
        console.log("Successfully initialized keyboard input");

        keyboard.on('keypress', async (event) => {
            if (event.code === 28) {
                if (event.value === 1) {
                    primaryButtonState.pressed = true;
                    primaryButtonState.pressTime = Date.now();
                    console.log("Primary button PRESSED DOWN at", new Date().toISOString());
                    
                    if (secondaryButtonState.pressed && !lightsOff) {
                        const timeDiff = Math.abs(primaryButtonState.pressTime - secondaryButtonState.pressTime);
                        console.log("Both buttons are pressed! Time difference:", timeDiff, "ms");
                        if (timeDiff < 500) {
                            console.log("Time difference within threshold, shutting down the shield!");
                            triggerLights();
                        } else {
                            console.log("Time difference too large, not shutting down the shield");
                            // Reset states if time difference is too large
                            primaryButtonState.pressed = false;
                            primaryButtonState.pressTime = null;
                            secondaryButtonState.pressed = false;
                            secondaryButtonState.pressTime = null;
                        }
                    }
                } else {
                    primaryButtonState.pressed = false;
                    console.log("Primary button RELEASED after", Date.now() - primaryButtonState.pressTime, "ms");
                    primaryButtonState.pressTime = null;
                    // Also reset secondary button if it's been pressed for too long
                    if (secondaryButtonState.pressed && Date.now() - secondaryButtonState.pressTime > 1000) {
                        secondaryButtonState.pressed = false;
                        secondaryButtonState.pressTime = null;
                        console.log("Reset secondary button state due to timeout");
                    }
                }
                console.log("Current state:", JSON.stringify({ primary: primaryButtonState, secondary: secondaryButtonState }, null, 2));
            }
        });
    } catch (error) {
        console.error("Error initializing keyboard:", error);
        process.exit(1);
    }
}

// Create WebSocket server for secondary Pi connection
const wss = new WebSocket.Server({ port: SECONDARY_PI_PORT });

wss.on('listening', () => {
    console.log(`WebSocket server is listening on port ${SECONDARY_PI_PORT}`);
});

wss.on('error', (error) => {
    console.error('WebSocket server error:', error);
});

async function controlWLED(state, options = {}) {
    console.log(`Attempting to set WLED state to: ${state ? "ON" : "OFF"} with options:`, options);
    try {
        let url = `http://${WLED_IP}/json/state`;
        let body = {
            on: state,
            bri: options.brightness || 255,
            transition: options.transition || 0,
            seg: [{
                id: 0,
                start: 0,
                stop: -1,  // Use entire strip
                grp: 1,    // Single group
                spc: 0,    // No spacing
                col: [[255, 0, 0]], // Default to red
                fx: 0,  // Default to solid
                sx: 128, // Default speed
                mi: false // No mirroring
            }]
        };

        // If we're turning it on, we might want to set specific parameters
        if (state && options) {
            if (options.preset !== undefined) {
                body = { on: true, ps: options.preset };
            } else if (options.color) {
                body.seg[0].col = [[options.color.r, options.color.g, options.color.b]];
                if (options.effect !== undefined) body.seg[0].fx = options.effect;
                if (options.speed !== undefined) body.seg[0].sx = options.speed;
            }
        }

        await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body)
        });
        console.log(`Successfully set WLED state to: ${state ? "ON" : "OFF"}`);
    } catch (error) {
        console.error("Error controlling WLED:", error);
    }
}

async function pulseShield(intensity) {
    // Pulse effect gets stronger as intensity increases (0-1)
    const brightness = Math.floor(50 + (intensity * 150)); // 50-200 range
    
    await controlWLED(true, {
        brightness: brightness,
        color: { r: 255, g: 0, b: 0 },
        effect: 0  // Keep solid color, no breathing effect
    });
}

async function triggerLights() {
    const SHIELD_DOWN_TIME = 15000; 
    const REGEN_START_TIME = SHIELD_DOWN_TIME * 0.8; // Start regeneration at 80%
    
    lightsOff = true;
    console.log("Buttons were pressed simultaneously - shattering shield");
    try {
        // Shield shattering effect
        const SHATTER_FLICKERS = 5; // Reduced number of flickers
        const FLICKER_DURATION_MIN = 25; // Faster flicker minimum
        const FLICKER_DURATION_MAX = 75; // Faster flicker maximum
        
        // Start with full brightness
        await controlWLED(true, {
            brightness: 255,
            color: { r: 255, g: 0, b: 0 },
            effect: 0
        });
        await new Promise(resolve => setTimeout(resolve, 100)); // Shorter initial hold

        // Random flicker pattern
        for (let i = 0; i < SHATTER_FLICKERS && lightsOff; i++) {
            // Random duration for this flicker
            const flickerDuration = Math.floor(
                Math.random() * (FLICKER_DURATION_MAX - FLICKER_DURATION_MIN) + FLICKER_DURATION_MIN
            );
            
            // Random brightness for this flicker
            const brightness = Math.floor(Math.random() * 200) + 55; // Between 55 and 255
            
            // Flicker on
            await controlWLED(true, {
                brightness: brightness,
                color: { r: 255, g: 0, b: 0 },
                effect: 0
            });
            
            // Hold for random duration
            await new Promise(resolve => setTimeout(resolve, flickerDuration));
            
            // Flicker off
            await controlWLED(false);
            
            // Random off duration
            const offDuration = Math.floor(Math.random() * 50) + 25; // Faster off duration
            await new Promise(resolve => setTimeout(resolve, offDuration));
        }

        // Final fade out sequence
        const FADE_STEPS = 5;
        const FADE_DURATION = 100; // Duration of each fade step
        
        for (let i = FADE_STEPS; i >= 0 && lightsOff; i--) {
            const brightness = Math.floor((i / FADE_STEPS) * 255);
            await controlWLED(true, {
                brightness: brightness,
                color: { r: 255, g: 0, b: 0 },
                effect: 0
            });
            await new Promise(resolve => setTimeout(resolve, FADE_DURATION));
        }
        
        // Final shield break
        await controlWLED(false);
        console.log("Shield shattered, starting shield down timer");

        // Wait until regeneration should start
        await new Promise(resolve => setTimeout(resolve, REGEN_START_TIME));

        // Start regeneration pulses with exponential timing
        const PULSE_DURATION = SHIELD_DOWN_TIME - REGEN_START_TIME;
        const NUM_PULSES = 12; // Increased for smoother color transition
        
        // Calculate exponential intervals
        const intervals = [];
        const decayFactor = 2.5; // Controls how quickly the pulses speed up
        let totalTime = 0;
        
        for (let i = 0; i < NUM_PULSES; i++) {
            // Exponentially decreasing intervals
            const interval = PULSE_DURATION * Math.exp(-i * decayFactor / NUM_PULSES) / NUM_PULSES;
            intervals.push(interval);
            totalTime += interval;
        }

        // Normalize intervals to fit within PULSE_DURATION
        const scaleFactor = PULSE_DURATION / totalTime;
        for (let i = 0; i < NUM_PULSES && lightsOff; i++) {
            // Turn on with increasing brightness
            const intensity = (i + 1) / NUM_PULSES;
            await pulseShield(intensity);
            await new Promise(resolve => setTimeout(resolve, 100)); // Hold bright state briefly

            // Turn completely off between pulses
            await controlWLED(false);
            await new Promise(resolve => setTimeout(resolve, intervals[i] * scaleFactor));
        }

        // Final red flash at full brightness
        if (lightsOff) {
            await controlWLED(true, {
                brightness: 255,
                color: { r: 255, g: 0, b: 0 },
                effect: 0
            });
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Restore shield to full power (preset 1)
        if (lightsOff) {
            await controlWLED(true, { preset: 1 });
            lightsOff = false;
            console.log("Shield regeneration complete, boss is invulnerable again");
        }
    } catch (error) {
        console.error("Error in triggerLights:", error);
        // Ensure shield comes back up even if there's an error
        await controlWLED(true, { preset: 1 });
        lightsOff = false;
    }
}

// Handle WebSocket connection from secondary Pi
wss.on('connection', (ws, req) => {
    console.log('Secondary Pi connected from:', req.socket.remoteAddress);
    
    ws.on('error', (error) => {
        console.error('WebSocket connection error:', error);
    });

    ws.on('message', (message) => {
        console.log('Received message from secondary Pi:', message.toString());
        try {
            const data = JSON.parse(message);
            if (data.buttonPressed) {
                secondaryButtonState.pressed = true;
                secondaryButtonState.pressTime = Date.now();
                console.log("Secondary button PRESSED DOWN at", new Date().toISOString());

                if (primaryButtonState.pressed && !lightsOff) {
                    const timeDiff = Math.abs(primaryButtonState.pressTime - secondaryButtonState.pressTime);
                    console.log("Both buttons are pressed! Time difference:", timeDiff, "ms");
                    if (timeDiff < 500) {
                        console.log("Time difference within threshold, triggering lights!");
                        triggerLights();
                    } else {
                        console.log("Time difference too large, not triggering lights");
                        // Reset states if time difference is too large
                        primaryButtonState.pressed = false;
                        primaryButtonState.pressTime = null;
                        secondaryButtonState.pressed = false;
                        secondaryButtonState.pressTime = null;
                    }
                }
            } else {
                secondaryButtonState.pressed = false;
                console.log("Secondary button RELEASED after", Date.now() - secondaryButtonState.pressTime, "ms");
                secondaryButtonState.pressTime = null;
                // Also reset primary button if it's been pressed for too long
                if (primaryButtonState.pressed && Date.now() - primaryButtonState.pressTime > 1000) {
                    primaryButtonState.pressed = false;
                    primaryButtonState.pressTime = null;
                    console.log("Reset primary button state due to timeout");
                }
            }
            console.log("Current state:", JSON.stringify({ primary: primaryButtonState, secondary: secondaryButtonState }, null, 2));
        } catch (error) {
            console.error('Error processing message from secondary Pi:', error);
        }
    });

    ws.on('close', (code, reason) => {
        console.log(`Secondary Pi disconnected - Code: ${code}, Reason: ${reason}`);
        secondaryButtonState.pressed = false;
        secondaryButtonState.pressTime = null;
        console.log("Reset secondary button state");
    });

    // Send initial connection confirmation
    try {
        ws.send(JSON.stringify({ status: 'connected' }));
    } catch (error) {
        console.error('Error sending connection confirmation:', error);
    }
});

// Initialize everything
console.log("Primary Pi server starting up...");
initializeKeyboard();
console.log(`Primary Pi server starting up at ${new Date().toISOString()}`);
console.log('Primary Pi server running on port', SECONDARY_PI_PORT); 