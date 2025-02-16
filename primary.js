const WebSocket = require('ws');
const InputEvent = require('input-event');
const fetch = require('node-fetch');
const fs = require('fs');
const { execSync } = require('child_process');
const player = require('play-sound')(opts = {})
const { ShieldState } = require('./web-interface');

// Configuration
const SECONDARY_PI_PORT = 8080;
const WLED_IP = '192.168.8.212'; // Replace with actual IP if needed
const AUDIO_PATH = './audio/';

let primaryButtonStates = []; // Array to track each keyboard's button state
let secondaryButtonState = { pressed: false, pressTime: null };
let state = { 
    shieldState: ShieldState.ACTIVE
};
let inputs = [];
let keyboards = [];
let wss;
let regenerationTimer = null;

// Add process-level error handlers
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    // Don't exit immediately, give time for logs to be written
    setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

function findKeyboardDevices() {
    try {
        // Read /proc/bus/input/devices to find all compatible keyboards
        const devices = execSync("cat /proc/bus/input/devices").toString();
        const lines = devices.split("\n");
        let foundKeyboard = false;
        let eventIds = [];
        let currentKeyboardName = "";

        for (let i = 0; i < lines.length; i++) {
            // Look for either Logitech K400 or INSTANT USB Keyboard
            if (lines[i].includes("Logitech K400") || lines[i].includes("K400 Plus") || lines[i].includes("INSTANT USB Keyboard")) {
                foundKeyboard = true;
                currentKeyboardName = lines[i].match(/Name="([^"]+)"/)[1];
                console.log("Found keyboard:", currentKeyboardName);
            }
            // Only add event ID for main keyboard interfaces (skip Consumer Control and System Control)
            if (foundKeyboard && lines[i].includes("Handlers=") && 
                !currentKeyboardName.includes("Consumer Control") && 
                !currentKeyboardName.includes("System Control")) {
                const match = lines[i].match(/event(\d+)/);
                if (match) {
                    eventIds.push({ id: match[1], name: currentKeyboardName });
                    console.log(`Added event ID ${match[1]} for ${currentKeyboardName}`);
                }
            }
            if (lines[i] === "") {
                foundKeyboard = false;
                currentKeyboardName = "";
            }
        }

        if (eventIds.length > 0) {
            const devicePaths = eventIds.map(({ id, name }) => ({
                path: `/dev/input/event${id}`,
                name: name
            }));
            console.log("Found keyboard devices:", devicePaths);
            return devicePaths;
        } else {
            console.error("No compatible keyboards found in device list");
        }
    } catch (error) {
        console.error("Error finding keyboards:", error);
    }
    return [];
}

function initializeKeyboards() {
    const keyboardDevices = findKeyboardDevices();
    if (keyboardDevices.length === 0) {
        console.error("Could not find any compatible keyboards!");
        process.exit(1);
    }

    try {
        // Initialize each keyboard
        keyboardDevices.forEach((device, index) => {
            try {
                const input = new InputEvent(device.path);
                const keyboard = new InputEvent.Keyboard(input);
                inputs.push(input);
                keyboards.push(keyboard);
                primaryButtonStates[index] = { 
                    pressed: false, 
                    pressTime: null,
                    name: device.name 
                };
                console.log(`Successfully initialized keyboard ${index + 1}: ${device.name} at ${device.path}`);

                keyboard.on('error', (error) => {
                    console.error(`Keyboard ${index + 1} (${device.name}) error:`, error);
                });

                keyboard.on('keypress', async (event) => {
                    try {
                        console.log(`Keyboard ${index + 1} (${device.name}) key event:`, {
                            code: event.code,
                            value: event.value,
                            type: getKeyName(event.code)
                        });

                        // Handle Enter key (code 28)
                        if (event.code === 28) {
                            handleEnterKey(event, index);
                        }
                        // Handle 'd' key (code 32) for boss death
                        else if (event.code === 32 && event.value === 1) {
                            console.log(`Boss death sequence triggered by 'd' key on ${device.name}`);
                            await handleBossDeath();
                        }
                        // Handle 'r' key (code 19) for reset
                        else if (event.code === 19 && event.value === 1) {
                            console.log(`System reset triggered by 'r' key on ${device.name}`);
                            await handleReset();
                        }
                        // Handle 'o' key (code 24) for power off
                        else if (event.code === 24 && event.value === 1) {
                            console.log(`Shield power down triggered by 'o' key on ${device.name}`);
                            await handlePowerOff();
                        }
                    } catch (error) {
                        console.error(`Error handling keypress on ${device.name}:`, error);
                    }
                });
            } catch (error) {
                console.error(`Error initializing keyboard at ${device.path}:`, error);
            }
        });

        if (keyboards.length === 0) {
            console.error("Failed to initialize any keyboards!");
            process.exit(1);
        }

    } catch (error) {
        console.error("Error in keyboard initialization:", error);
        process.exit(1);
    }
}

// Helper function to get key names
function getKeyName(code) {
    const keyMap = {
        28: 'ENTER',
        32: 'D',
        19: 'R',
        24: 'O'
    };
    return keyMap[code] || `Unknown (${code})`;
}

// Helper function to handle Enter key press/release
function handleEnterKey(event, keyboardIndex) {
    const keyboardName = primaryButtonStates[keyboardIndex].name;
    
    if (event.value === 1) { // Key pressed down
        primaryButtonStates[keyboardIndex].pressed = true;
        primaryButtonStates[keyboardIndex].pressTime = Date.now();
        console.log(`Primary button PRESSED DOWN on ${keyboardName} at`, new Date().toISOString());
        webInterface.broadcastState(); // Broadcast when button is pressed
        
        // Set timeout to reset button state after 1 second
        setTimeout(() => {
            if (primaryButtonStates[keyboardIndex].pressed && 
                Date.now() - primaryButtonStates[keyboardIndex].pressTime > 1000) {
                primaryButtonStates[keyboardIndex].pressed = false;
                primaryButtonStates[keyboardIndex].pressTime = null;
                console.log(`Reset primary button state due to timeout on ${keyboardName}`);
                webInterface.broadcastState(); // Broadcast when button times out
            }
        }, 1000);
        
        // Check if secondary button is pressed
        if (secondaryButtonState.pressed && state.shieldState === ShieldState.ACTIVE) {
            const timeDiff = Math.abs(primaryButtonStates[keyboardIndex].pressTime - secondaryButtonState.pressTime);
            console.log(`Both buttons are pressed! ${keyboardName} with Secondary, Time difference:`, timeDiff, "ms");
            if (timeDiff < 500) {
                console.log(`Time difference within threshold, shutting down the shield! (Triggered by ${keyboardName})`);
                triggerLights();
            } else {
                console.log("Time difference too large, not shutting down the shield");
                resetAllButtonStates();
                webInterface.broadcastState(); // Broadcast when states are reset
            }
        }
    } else { // Key released
        primaryButtonStates[keyboardIndex].pressed = false;
        console.log(`Primary button RELEASED on ${keyboardName} after`, 
            Date.now() - primaryButtonStates[keyboardIndex].pressTime, "ms");
        primaryButtonStates[keyboardIndex].pressTime = null;
        webInterface.broadcastState(); // Broadcast when button is released
        
        // Check if secondary button should be reset
        if (secondaryButtonState.pressed && 
            Date.now() - secondaryButtonState.pressTime > 1000) {
            secondaryButtonState.pressed = false;
            secondaryButtonState.pressTime = null;
            console.log(`Reset secondary button state due to timeout after primary release on ${keyboardName}`);
            webInterface.broadcastState(); // Broadcast when secondary button is reset
        }
    }
    
    // Log current state with keyboard names
    console.log("Current state:", JSON.stringify({
        primaryButtons: primaryButtonStates.map(state => ({
            name: state.name,
            pressed: state.pressed,
            pressTime: state.pressTime
        })),
        secondary: secondaryButtonState
    }, null, 2));
}

// Helper function to handle boss death sequence
async function handleBossDeath() {
    resetAllButtonStates();
    state.shieldState = ShieldState.BOSS_DEAD;
    webInterface.broadcastState(); // Broadcast state change
    await controlWLED(true, { preset: 2 });
    webInterface.broadcastState(); // Broadcast final state after WLED control
    console.log("Boss death sequence completed - preset 2 activated");
}

// Helper function to handle system reset
async function handleReset() {
    // Clear any pending regeneration timer
    if (regenerationTimer) {
        clearTimeout(regenerationTimer);
        regenerationTimer = null;
    }

    // Reset all states
    resetAllButtonStates();
    state.shieldState = ShieldState.ACTIVE;
    webInterface.broadcastState(); // Broadcast state change

    // Turn the lights back on with preset 1
    await controlWLED(true, { preset: 1 });
    console.log("System reset completed - restored to initial state");
}

// Helper function to handle power off
async function handlePowerOff() {
    resetAllButtonStates();
    state.shieldState = ShieldState.POWER_OFF;
    webInterface.broadcastState(); // Broadcast state change
    await controlWLED(false);
    webInterface.broadcastState(); // Broadcast final state after WLED control
    console.log("Shield powered down successfully");
}

// Helper function to reset all button states
function resetAllButtonStates() {
    primaryButtonStates.forEach(state => {
        state.pressed = false;
        state.pressTime = null;
    });
    secondaryButtonState.pressed = false;
    secondaryButtonState.pressTime = null;
}

// Function to create and initialize WebSocket server
function initializeWebSocketServer() {
    try {
        if (wss) {
            try {
                wss.close();
            } catch (error) {
                console.error('Error closing existing WebSocket server:', error);
            }
        }

        wss = new WebSocket.Server({ port: SECONDARY_PI_PORT });

        wss.on('listening', () => {
            console.log(`WebSocket server is listening on port ${SECONDARY_PI_PORT}`);
        });

        wss.on('error', (error) => {
            console.error('WebSocket server error:', error);
            // Only attempt to restart if it's a fatal error
            if (error.code === 'EADDRINUSE') {
                console.log('Port in use, waiting before retry...');
                setTimeout(initializeWebSocketServer, 5000);
            }
        });

        wss.on('close', () => {
            console.log('WebSocket server closed, attempting to restart...');
            setTimeout(initializeWebSocketServer, 5000);
        });

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
                        webInterface.broadcastState(); // Broadcast when secondary button is pressed

                        // Set timeout to reset button state after 1 second
                        setTimeout(() => {
                            if (secondaryButtonState.pressed && Date.now() - secondaryButtonState.pressTime > 1000) {
                                secondaryButtonState.pressed = false;
                                secondaryButtonState.pressTime = null;
                                console.log("Reset secondary button state due to timeout");
                                webInterface.broadcastState(); // Broadcast state change on timeout
                            }
                        }, 1000);

                        // Check if any primary button is pressed
                        const anyPrimaryPressed = primaryButtonStates.some(state => state.pressed);
                        const firstPressedTime = primaryButtonStates.find(state => state.pressed)?.pressTime || null;

                        if (anyPrimaryPressed && state.shieldState === ShieldState.ACTIVE) {
                            const timeDiff = Math.abs(firstPressedTime - secondaryButtonState.pressTime);
                            console.log("Both buttons are pressed! Time difference:", timeDiff, "ms");
                            if (timeDiff < 500) {
                                console.log("Time difference within threshold, triggering lights!");
                                triggerLights();
                            } else {
                                console.log("Time difference too large, not triggering lights");
                                // Reset states if time difference is too large
                                resetAllButtonStates();
                                webInterface.broadcastState(); // Broadcast when states are reset
                            }
                        }
                    } else {
                        secondaryButtonState.pressed = false;
                        secondaryButtonState.pressTime = null;
                        console.log("Secondary button RELEASED after", Date.now() - secondaryButtonState.pressTime, "ms");
                        webInterface.broadcastState(); // Broadcast when secondary button is released
                        
                        // Check if any primary buttons have been pressed too long
                        const anyStuckButtons = primaryButtonStates.some(state => 
                            state.pressed && Date.now() - state.pressTime > 1000);
                        if (anyStuckButtons) {
                            console.log("Resetting stuck primary buttons");
                            resetAllButtonStates();
                            webInterface.broadcastState();
                        }
                    }
                    // Log current state with all keyboard states
                    console.log("Current state:", JSON.stringify({
                        primaryButtons: primaryButtonStates.map(state => ({
                            name: state.name,
                            pressed: state.pressed,
                            pressTime: state.pressTime
                        })),
                        secondary: secondaryButtonState
                    }, null, 2));
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
    } catch (error) {
        console.error('Error initializing WebSocket server:', error);
        setTimeout(initializeWebSocketServer, 5000);
    }
}

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

// Function to play audio file
function playAudio(filename) {
    const audioFile = AUDIO_PATH + filename;
    if (fs.existsSync(audioFile)) {
        // Use mpg123 for MP3 playback
        player.play(audioFile, {
            player: 'mpg123',
            mpg123: ['-q']  // Quiet mode, no status output
        }, (err) => {
            if (err) {
                console.error(`Error playing audio ${filename}:`, err);
            }
        });
    } else {
        console.error(`Audio file not found: ${audioFile}`);
    }
}

async function triggerLights() {
    const SHIELD_DOWN_TIME = 15000; 
    const REGEN_START_TIME = SHIELD_DOWN_TIME * 0.8; // Start regeneration at 80%
    
    // Clear any existing regeneration timer
    if (regenerationTimer) {
        clearTimeout(regenerationTimer);
        regenerationTimer = null;
    }
    
    state.shieldState = ShieldState.SHATTERING;
    webInterface.broadcastState(); // Broadcast shattering state
    console.log("Buttons were pressed simultaneously - shattering shield");
    
    try {
        // Shield shattering effect
        const SHATTER_FLICKERS = 5;
        const FLICKER_DURATION_MIN = 25;
        const FLICKER_DURATION_MAX = 75;
        
        // Start with full brightness
        await controlWLED(true, {
            brightness: 255,
            color: { r: 255, g: 0, b: 0 },
            effect: 0
        });
        await new Promise(resolve => setTimeout(resolve, 100));

        // Random flicker pattern
        for (let i = 0; i < SHATTER_FLICKERS && state.shieldState === ShieldState.SHATTERING; i++) {
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
        const FADE_DURATION = 100;
        
        for (let i = FADE_STEPS; i >= 0 && state.shieldState === ShieldState.SHATTERING; i--) {
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
        state.shieldState = ShieldState.BROKEN;
        webInterface.broadcastState(); // Broadcast broken state
        
        // Play shield broken sound after shattering completes
        playAudio('shield-broken.mp3');
        
        console.log("Shield shattered, starting shield down timer");

        // Set up regeneration timer
        regenerationTimer = setTimeout(async () => {
            // Only proceed if we're still in BROKEN state
            if (state.shieldState === ShieldState.BROKEN) {
                // Start regeneration
                state.shieldState = ShieldState.REGENERATING;
                webInterface.broadcastState(); // Broadcast regenerating state
                
                // Play regeneration sound
                playAudio('shield-regenerating.mp3');
                
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
                for (let i = 0; i < NUM_PULSES && state.shieldState === ShieldState.REGENERATING; i++) {
                    // Turn on with increasing brightness
                    const intensity = (i + 1) / NUM_PULSES;
                    await pulseShield(intensity);
                    await new Promise(resolve => setTimeout(resolve, 100)); // Hold bright state briefly

                    // Turn completely off between pulses
                    await controlWLED(false);
                    await new Promise(resolve => setTimeout(resolve, intervals[i] * scaleFactor));
                }

                // Final red flash at full brightness
                if (state.shieldState === ShieldState.REGENERATING) {
                    await controlWLED(true, {
                        brightness: 255,
                        color: { r: 255, g: 0, b: 0 },
                        effect: 0
                    });
                    await new Promise(resolve => setTimeout(resolve, 500));
                }

                // Restore shield to full power (preset 1)
                if (state.shieldState === ShieldState.REGENERATING) {
                    // Reset state to active
                    state.shieldState = ShieldState.ACTIVE;
                    webInterface.broadcastState(); // Broadcast active state

                    // Small delay for UI update
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                    // Then restore shield
                    await controlWLED(true, { preset: 1 });
                    
                    // Play shield active sound
                    playAudio('shield-active.mp3');
                    
                    // Reset button states
                    resetAllButtonStates();
                    console.log("Shield regeneration complete, boss is invulnerable again");
                }
            }
            regenerationTimer = null;
        }, REGEN_START_TIME);

    } catch (error) {
        console.error("Error in triggerLights:", error);
        // Clear regeneration timer in case of error
        if (regenerationTimer) {
            clearTimeout(regenerationTimer);
            regenerationTimer = null;
        }
        // Ensure shield comes back up even if there's an error
        await controlWLED(true, { preset: 1 });
        // Reset state in error case too
        state.shieldState = ShieldState.ACTIVE;
        webInterface.broadcastState(); // Broadcast state reset in error case
        // Reset button states on error too
        resetAllButtonStates();
    }
}

// Initialize everything
console.log("Primary Pi server starting up...");
initializeKeyboards();
initializeWebSocketServer();

// Initialize web interface
const webInterface = require('./web-interface');
webInterface.initialize({
    primaryButtonStates,
    secondaryButtonState,
    state,
    triggerLights,
    controlWLED,
    handleReset,
    handleBossDeath,
    handlePowerOff
});

// Broadcast initial state
webInterface.broadcastState();

console.log(`Primary Pi server starting up at ${new Date().toISOString()}`);
console.log('Primary Pi server running on port', SECONDARY_PI_PORT);

// Export functionality for web interface
module.exports = {
    primaryButtonStates,
    secondaryButtonState,
    state,
    triggerLights,
    controlWLED,
    handleReset,
    handleBossDeath,
    handlePowerOff
}; 