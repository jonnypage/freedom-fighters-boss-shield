const WebSocket = require('ws');
const InputEvent = require('input-event');
const fs = require('fs');
const { execSync } = require('child_process');

// Configuration
const PRIMARY_PI_ADDRESS = 'ws://192.168.8.142:8080';

let ws;
let reconnectTimeout;
let buttonState = { pressed: false, pressTime: null };
let inputs = [];
let keyboards = [];

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
                console.log(`Successfully initialized keyboard ${index + 1}: ${device.name} at ${device.path}`);

                keyboard.on('error', (error) => {
                    console.error(`Keyboard ${index + 1} (${device.name}) error:`, error);
                });

                keyboard.on('keypress', (event) => {
                    try {
                        console.log(`Keyboard ${index + 1} (${device.name}) key event:`, {
                            code: event.code,
                            value: event.value,
                            type: getKeyName(event.code)
                        });

                        // Handle Enter key (code 28)
                        if (event.code === 28) {
                            handleEnterKey(event, device.name);
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
        28: 'ENTER'
    };
    return keyMap[code] || `Unknown (${code})`;
}

// Helper function to handle Enter key press/release
function handleEnterKey(event, keyboardName) {
    // Check WebSocket connection state and attempt to reconnect if needed
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.log('WebSocket not connected. Attempting to reconnect...');
        connectToPrimary();
        return;
    }

    if (event.value === 1) { // Key pressed down
        buttonState.pressed = true;
        buttonState.pressTime = Date.now();
        console.log(`Secondary button PRESSED DOWN on ${keyboardName} at`, new Date().toISOString());

        try {
            ws.send(JSON.stringify({ buttonPressed: true }));
        } catch (wsError) {
            console.error('Error sending WebSocket message:', wsError);
            connectToPrimary();
        }

        // Set timeout to reset button state after 1 second
        setTimeout(() => {
            if (buttonState.pressed && Date.now() - buttonState.pressTime > 1000) {
                buttonState.pressed = false;
                buttonState.pressTime = null;
                console.log(`Reset secondary button state due to timeout on ${keyboardName}`);
                try {
                    ws.send(JSON.stringify({ buttonPressed: false }));
                } catch (wsError) {
                    console.error('Error sending WebSocket message:', wsError);
                    connectToPrimary();
                }
            }
        }, 1000);
    } else { // Key released
        buttonState.pressed = false;
        console.log(`Secondary button RELEASED on ${keyboardName} after`, 
            Date.now() - buttonState.pressTime, "ms");
        buttonState.pressTime = null;

        try {
            ws.send(JSON.stringify({ buttonPressed: false }));
        } catch (wsError) {
            console.error('Error sending WebSocket message:', wsError);
            connectToPrimary();
        }
    }
    
    // Log current state
    console.log("Current button state:", JSON.stringify(buttonState, null, 2));
}

// Function to connect to primary Pi
function connectToPrimary() {
    try {
        // Clear any existing connection and timeout
        if (ws) {
            try {
                ws.terminate();
            } catch (error) {
                console.error('Error terminating existing WebSocket:', error);
            }
        }
        clearTimeout(reconnectTimeout);

        console.log(`Attempting to connect to primary Pi at ${PRIMARY_PI_ADDRESS}`);
        ws = new WebSocket(PRIMARY_PI_ADDRESS);

        ws.on('open', () => {
            console.log('Connected to primary Pi at:', new Date().toISOString());
            clearTimeout(reconnectTimeout);
        });

        ws.on('close', (code, reason) => {
            console.log(`Disconnected from primary Pi at ${new Date().toISOString()} - Code: ${code}, Reason: ${reason}`);
            // Don't stack reconnect attempts
            clearTimeout(reconnectTimeout);
            reconnectTimeout = setTimeout(connectToPrimary, 5000);
        });

        ws.on('error', (error) => {
            console.error('WebSocket error:', error);
        });

        // Add ping/pong monitoring
        let isAlive = true;
        ws.on('pong', () => {
            isAlive = true;
            console.log('Received pong from primary Pi');
        });

        // Check connection health every 30 seconds
        const interval = setInterval(() => {
            if (!isAlive) {
                console.log('Connection dead - terminating');
                ws.terminate();
                clearInterval(interval);
                return;
            }
            isAlive = false;
            try {
                ws.ping();
            } catch (error) {
                console.error('Error sending ping:', error);
            }
        }, 30000);

        ws.on('close', () => {
            clearInterval(interval);
        });

    } catch (error) {
        console.error('Error in connectToPrimary:', error);
        // Ensure we still try to reconnect
        clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(connectToPrimary, 5000);
    }
}

// Initialize everything
console.log("Secondary Pi client starting up...");
console.log("Start time:", new Date().toISOString());
initializeKeyboards();
connectToPrimary();
console.log("Secondary Pi client started"); 