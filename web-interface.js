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

    const state = {
        primaryButton: {...primaryModule.primaryButtonState},
        secondaryButton: {...primaryModule.secondaryButtonState},
        shieldStatus: stateToStatus[primaryModule.state.shieldState],
        isRegenerating: primaryModule.state.shieldState === ShieldState.REGENERATING,
        currentState: primaryModule.state.shieldState
    };

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(state));
        }
    });
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
    
    // Cache the response to prevent race conditions
    const response = {
        primaryButton: {...primaryModule.primaryButtonState},
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
        // Simulate both buttons being pressed
        primaryModule.primaryButtonState.pressed = true;
        primaryModule.primaryButtonState.pressTime = Date.now();
        primaryModule.secondaryButtonState.pressed = true;
        primaryModule.secondaryButtonState.pressTime = Date.now();

        // Trigger the lights effect
        await primaryModule.triggerLights();
        res.json({ success: true });
    } catch (error) {
        console.error('Error triggering lights:', error);
        res.status(500).json({ error: 'Failed to trigger lights' });
    }
});

app.post('/api/reset', (req, res) => {
    if (!primaryModule) {
        return res.status(500).json({ error: 'Primary module not initialized' });
    }

    try {
        // Reset all states
        primaryModule.primaryButtonState.pressed = false;
        primaryModule.primaryButtonState.pressTime = null;
        primaryModule.secondaryButtonState.pressed = false;
        primaryModule.secondaryButtonState.pressTime = null;
        primaryModule.state.shieldState = ShieldState.ACTIVE;

        // Turn the lights back on with preset 1
        primaryModule.controlWLED(true, { preset: 1 });
        
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
        primaryModule.primaryButtonState.pressed = false;
        primaryModule.primaryButtonState.pressTime = null;
        primaryModule.secondaryButtonState.pressed = false;
        primaryModule.secondaryButtonState.pressTime = null;
        
        // Activate boss death preset
        await primaryModule.controlWLED(true, { preset: 2 });
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
        primaryModule.primaryButtonState.pressed = false;
        primaryModule.primaryButtonState.pressTime = null;
        primaryModule.secondaryButtonState.pressed = false;
        primaryModule.secondaryButtonState.pressTime = null;
        
        // Power down shield
        await primaryModule.controlWLED(false);
        res.json({ success: true });
    } catch (error) {
        console.error('Error powering down shield:', error);
        res.status(500).json({ error: 'Failed to power down shield' });
    }
});

// Initialize the web server with a reference to the primary module
function initialize(primaryModuleRef) {
    primaryModule = primaryModuleRef;
    
    // Set up WebSocket server for real-time updates
    wss = new WebSocket.Server({ port: 3001 });
    
    wss.on('connection', (ws) => {
        console.log('Web client connected');
        // Send initial state
        broadcastState();
    });

    // Watch for state changes
    const stateInterval = setInterval(broadcastState, 100);

    app.listen(port, '0.0.0.0', () => {
        console.log(`Web interface running at http://0.0.0.0:${port}`);
        console.log('WebSocket server running on port 3001');
    });
}

// Export the ShieldState enum along with initialize function and broadcastState
module.exports = { initialize, ShieldState, broadcastState }; 