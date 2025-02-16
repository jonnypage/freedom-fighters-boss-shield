const express = require('express');
const path = require('path');
const app = express();
const port = 3000;
const WebSocket = require('ws');

// Define shield states as an enum
const ShieldState = {
    ACTIVE: 'ACTIVE',
    SHATTERING: 'SHATTERING',
    BROKEN: 'BROKEN',
    REGENERATING: 'REGENERATING',
    BOSS_DEAD: 'BOSS_DEAD',
    POWER_OFF: 'POWER_OFF'
};

// Store reference to the primary.js exports
let primaryModule = null;
let wss = null;

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Function to broadcast state to all connected web clients
function broadcastState() {
    if (!wss) return;

    const stateToStatus = {
        [ShieldState.ACTIVE]: 'on',
        [ShieldState.SHATTERING]: 'shattering',
        [ShieldState.BROKEN]: 'broken',
        [ShieldState.REGENERATING]: 'regenerating',
        [ShieldState.BOSS_DEAD]: 'boss-dead',
        [ShieldState.POWER_OFF]: 'off'
    };

    // Calculate combined primary button state
    const anyPrimaryPressed = primaryModule.primaryButtonStates.some(state => state.pressed);
    const firstPressedTime = primaryModule.primaryButtonStates.find(state => state.pressed)?.pressTime || null;

    // Create detailed state object
    const state = {
        primaryButton: { 
            pressed: anyPrimaryPressed, 
            pressTime: firstPressedTime,
            // Add detailed states for debugging
            details: primaryModule.primaryButtonStates.map(state => ({
                name: state.name,
                pressed: state.pressed,
                pressTime: state.pressTime
            }))
        },
        secondaryButton: {...primaryModule.secondaryButtonState},
        shieldStatus: stateToStatus[primaryModule.state.shieldState],
        isRegenerating: primaryModule.state.shieldState === ShieldState.REGENERATING,
        currentState: primaryModule.state.shieldState
    };

    // Broadcast to all connected clients
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(JSON.stringify(state));
            } catch (error) {
                console.error('Error sending state to client:', error);
            }
        }
    });

    // Debug log the broadcast
    console.log('Broadcasting state:', JSON.stringify(state, null, 2));
}

// API Endpoints
app.get('/api/status', (req, res) => {
    if (!primaryModule) {
        return res.status(500).json({ error: 'Primary module not initialized' });
    }
    
    // Map the shield state to a status for the frontend
    const stateToStatus = {
        [ShieldState.ACTIVE]: 'on',
        [ShieldState.SHATTERING]: 'shattering',
        [ShieldState.BROKEN]: 'broken',
        [ShieldState.REGENERATING]: 'regenerating',
        [ShieldState.BOSS_DEAD]: 'boss-dead',
        [ShieldState.POWER_OFF]: 'off'
    };
    
    // Calculate combined primary button state
    const anyPrimaryPressed = primaryModule.primaryButtonStates.some(state => state.pressed);
    const firstPressedTime = primaryModule.primaryButtonStates.find(state => state.pressed)?.pressTime || null;
    
    // Cache the response to prevent race conditions
    const response = {
        primaryButton: { pressed: anyPrimaryPressed, pressTime: firstPressedTime },
        secondaryButton: {...primaryModule.secondaryButtonState},
        shieldStatus: stateToStatus[primaryModule.state.shieldState],
        isRegenerating: primaryModule.state.shieldState === ShieldState.REGENERATING,
        currentState: primaryModule.state.shieldState
    };
    
    res.json(response);
});

app.post('/api/trigger', async (req, res) => {
    if (!primaryModule) {
        return res.status(500).json({ error: 'Primary module not initialized' });
    }

    try {
        // Set shield state to shattering first
        primaryModule.state.shieldState = ShieldState.SHATTERING;
        broadcastState();

        // Trigger the lights effect
        await primaryModule.triggerLights();
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error triggering lights:', error);
        res.status(500).json({ error: 'Failed to trigger lights' });
    }
});

app.post('/api/reset', async (req, res) => {
    if (!primaryModule) {
        return res.status(500).json({ error: 'Primary module not initialized' });
    }

    try {
        // Call the reset handler which now properly manages timers and state
        await primaryModule.handleReset();
        
        // Send success response
        res.json({ success: true });
    } catch (error) {
        console.error('Error resetting system:', error);
        res.status(500).json({ error: 'Failed to reset system' });
    }
});

app.post('/api/boss-death', async (req, res) => {
    if (!primaryModule) {
        return res.status(500).json({ error: 'Primary module not initialized' });
    }

    try {
        // Set state to boss dead
        primaryModule.state.shieldState = ShieldState.BOSS_DEAD;
        primaryModule.primaryButtonStates.forEach(state => {
            state.pressed = false;
            state.pressTime = null;
        });
        primaryModule.secondaryButtonState.pressed = false;
        primaryModule.secondaryButtonState.pressTime = null;
        
        // Broadcast state change
        broadcastState();
        
        // Activate boss death preset
        await primaryModule.controlWLED(true, { preset: 2 });
        
        // Broadcast final state
        broadcastState();
        res.json({ success: true });
    } catch (error) {
        console.error('Error in boss death sequence:', error);
        res.status(500).json({ error: 'Failed to execute boss death sequence' });
    }
});

app.post('/api/power-down', async (req, res) => {
    if (!primaryModule) {
        return res.status(500).json({ error: 'Primary module not initialized' });
    }

    try {
        // Set state to power off
        primaryModule.state.shieldState = ShieldState.POWER_OFF;
        primaryModule.primaryButtonStates.forEach(state => {
            state.pressed = false;
            state.pressTime = null;
        });
        primaryModule.secondaryButtonState.pressed = false;
        primaryModule.secondaryButtonState.pressTime = null;
        
        // Broadcast state change
        broadcastState();
        
        // Power down shield
        await primaryModule.controlWLED(false);
        
        // Broadcast final state
        broadcastState();
        res.json({ success: true });
    } catch (error) {
        console.error('Error powering down shield:', error);
        res.status(500).json({ error: 'Failed to power down shield' });
    }
});

// Initialize the web server with a reference to the primary module
function initialize(primaryModuleRef) {
    primaryModule = primaryModuleRef;
    
    // First start the HTTP server
    app.listen(port, '0.0.0.0', () => {
        console.log(`Web interface running at http://0.0.0.0:${port}`);
        
        // Then set up WebSocket server after HTTP server is running
        wss = new WebSocket.Server({ port: 3001 });
        
        wss.on('connection', (ws) => {
            console.log('Web client connected');
            // Ensure primaryModule is initialized before broadcasting
            if (primaryModule) {
                // Force an immediate state broadcast to the new client
                try {
                    const stateToStatus = {
                        [ShieldState.ACTIVE]: 'on',
                        [ShieldState.SHATTERING]: 'shattering',
                        [ShieldState.BROKEN]: 'broken',
                        [ShieldState.REGENERATING]: 'regenerating',
                        [ShieldState.BOSS_DEAD]: 'boss-dead',
                        [ShieldState.POWER_OFF]: 'off'
                    };

                    const anyPrimaryPressed = primaryModule.primaryButtonStates.some(state => state.pressed);
                    const firstPressedTime = primaryModule.primaryButtonStates.find(state => state.pressed)?.pressTime || null;

                    const state = {
                        primaryButton: { 
                            pressed: anyPrimaryPressed, 
                            pressTime: firstPressedTime,
                            details: primaryModule.primaryButtonStates.map(state => ({
                                name: state.name,
                                pressed: state.pressed,
                                pressTime: state.pressTime
                            }))
                        },
                        secondaryButton: {...primaryModule.secondaryButtonState},
                        shieldStatus: stateToStatus[primaryModule.state.shieldState],
                        isRegenerating: primaryModule.state.shieldState === ShieldState.REGENERATING,
                        currentState: primaryModule.state.shieldState
                    };

                    ws.send(JSON.stringify(state));
                    console.log('Sent initial state to new client:', state);
                } catch (error) {
                    console.error('Error sending initial state to client:', error);
                }
            } else {
                console.error('Primary module not initialized when client connected');
            }
        });

        console.log('WebSocket server running on port 3001');
        // Broadcast initial state to any existing clients
        broadcastState();
    });
}

// Export the ShieldState enum along with initialize function and broadcastState
module.exports = { initialize, ShieldState, broadcastState }; 