const express = require('express');
const path = require('path');
const app = express();
const port = 3000;

// Store reference to the primary.js exports
let primaryModule = null;

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// API Endpoints
app.get('/api/status', (req, res) => {
    if (!primaryModule) {
        return res.status(500).json({ error: 'Primary module not initialized' });
    }
    
    let shieldStatus = 'on';
    if (primaryModule.state.shattering) {
        shieldStatus = 'shattering';
    } else if (primaryModule.state.regenerating) {
        shieldStatus = 'regenerating';
    } else if (primaryModule.state.lightsOff && !primaryModule.state.regenerating) {
        shieldStatus = 'broken';
    } else if (primaryModule.state.bossDead) {
        shieldStatus = 'boss-dead';
    } else if (primaryModule.state.powerOff) {
        shieldStatus = 'off';
    } else if (!primaryModule.state.lightsOff && !primaryModule.state.shattering && 
               !primaryModule.state.regenerating && !primaryModule.state.bossDead && 
               !primaryModule.state.powerOff) {
        shieldStatus = 'on';
    }
    
    res.json({
        primaryButton: primaryModule.primaryButtonState,
        secondaryButton: primaryModule.secondaryButtonState,
        shieldStatus: shieldStatus
    });
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
        primaryModule.state.lightsOff = false;
        primaryModule.state.shattering = false;
        primaryModule.state.regenerating = false;
        primaryModule.state.bossDead = false;
        primaryModule.state.powerOff = false;

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
        // Reset all states
        primaryModule.state.lightsOff = false;
        primaryModule.state.shattering = false;
        primaryModule.state.regenerating = false;
        primaryModule.state.powerOff = false;
        primaryModule.state.bossDead = true;  // Set boss dead state
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
        // Reset all states
        primaryModule.state.lightsOff = false;
        primaryModule.state.shattering = false;
        primaryModule.state.regenerating = false;
        primaryModule.state.bossDead = false;
        primaryModule.state.powerOff = true;  // Set power off state
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
    app.listen(port, '0.0.0.0', () => {
        console.log(`Web interface running at http://0.0.0.0:${port}`);
    });
}

module.exports = { initialize }; 