const WebSocket = require('ws');
const InputEvent = require('input-event');
const fs = require('fs');
const { execSync } = require('child_process');

// Configuration
const PRIMARY_PI_ADDRESS = 'ws://192.168.8.142:8080';

let ws;
let reconnectTimeout;
let buttonState = { pressed: false, pressTime: null };
let input;
let keyboard;

// Add process-level error handlers
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    // Don't exit immediately, give time for logs to be written
    setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

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
        } else {
            console.error("No Logitech keyboard found in device list");
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

        keyboard.on('error', (error) => {
            console.error('Keyboard error:', error);
        });

        keyboard.on('keypress', (event) => {
            try {
                if (event.code === 28) {
                    // Check WebSocket connection state and attempt to reconnect if needed
                    if (!ws || ws.readyState !== WebSocket.OPEN) {
                        console.log('WebSocket not connected. Attempting to reconnect...');
                        connectToPrimary();
                        return;
                    }

                    if (event.value === 1) {
                        buttonState.pressed = true;
                        buttonState.pressTime = Date.now();
                        console.log("Button PRESSED DOWN at", new Date().toISOString());
                    } else {
                        buttonState.pressed = false;
                        console.log("Button RELEASED after", Date.now() - buttonState.pressTime, "ms");
                        buttonState.pressTime = null;
                    }

                    try {
                        if (ws && ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({ buttonPressed: buttonState.pressed }));
                        }
                    } catch (wsError) {
                        console.error('Error sending WebSocket message:', wsError);
                        // Try to reconnect on send failure
                        connectToPrimary();
                    }
                    
                    console.log("Current button state:", JSON.stringify(buttonState, null, 2));
                }
            } catch (error) {
                console.error('Error in keypress handler:', error);
            }
        });
    } catch (error) {
        console.error("Error initializing keyboard:", error);
        process.exit(1);
    }
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
initializeKeyboard();
connectToPrimary();
console.log("Secondary Pi client started"); 