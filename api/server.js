const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const url = require('url');
const DockerModule = require('../dockerModule');
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// --- Service Management Endpoints ---

// GET /api/services - List all services
app.get('/api/services', async (req, res) => {
    try {
        const services = await DockerModule.listServices();
        res.json(services);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/services/:name/status - Get service status
app.get('/api/services/:name/status', async (req, res) => {
    try {
        const { name } = req.params;
        const isUp = await DockerModule.isServiceUp(name);
        res.json({ status: isUp ? 'Up' : 'Down' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/services/:name/power - Perform a power action
app.post('/api/services/:name/power', async (req, res) => {
    try {
        const { name } = req.params;
        const { action } = req.body;
        const result = await DockerModule.powerAction(action.toUpperCase(), name);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/services/:name/config - Get service configuration
app.get('/api/services/:name/config', async (req, res) => {
    try {
        const { name } = req.params;
        const config = await DockerModule.getServiceConfig(name);
        res.json(config);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// --- Log Management Endpoints ---

// GET /api/services/:name/logs/files - List log files for a service
app.get('/api/services/:name/logs/files', async (req, res) => {
    try {
        const { name } = req.params;
        const logFiles = await DockerModule.getServiceLogs(name);
        res.json(logFiles);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/services/:name/logs/read - Read lines from a log file
app.get('/api/services/:name/logs/read', async (req, res) => {
    try {
        const { name } = req.params;
        const { file, start, num } = req.query;
        const lines = await DockerModule.getLogLines(name, file, parseInt(start, 10), parseInt(num, 10));
        res.json(lines);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/services/:name/logs/search - Search log files by time range
app.post('/api/services/:name/logs/search', async (req, res) => {
    try {
        const { name } = req.params;
        const { file, from, to, limit, offset, search } = req.body;
        const result = await DockerModule.searchLogLinesByTimeRange(name, file, from || null, to || null, limit, offset, search);
        console.log(file, from, to, result.lines.length);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


const server = app.listen(port, () => {
    console.log(`API server listening at http://localhost:${port}`);
});

const logWss = new WebSocket.Server({ noServer: true });
const statusWss = new WebSocket.Server({ noServer: true });

let serviceStatusState = {};

const broadcastStatusUpdates = async () => {
    try {
        const services = await DockerModule.listServices();
        for (const service of services) {
            const isUp = await DockerModule.isServiceUp(service);
            const newStatus = isUp ? 'Up' : 'Down';

            if (serviceStatusState[service] !== newStatus) {
                serviceStatusState[service] = newStatus;
                const payload = JSON.stringify({ serviceName: service, status: newStatus });
                console.log(`Broadcasting status change for ${service}: ${newStatus}`);
                statusWss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(payload);
                    }
                });
            }
        }
    } catch (error) {
        console.error('Failed to broadcast service status updates:', error);
    }
};

const initializeStatusesAndStartPolling = async () => {
    console.log('Initializing service statuses...');
    try {
        const services = await DockerModule.listServices();
        for (const service of services) {
            const isUp = await DockerModule.isServiceUp(service);
            serviceStatusState[service] = isUp ? 'Up' : 'Down';
        }
        console.log('Initial service statuses loaded:', serviceStatusState);
    } catch (error) {
        console.error('Failed to initialize service statuses:', error);
    }
    
    console.log('Starting persistent status update polling (3-second interval).');
    setInterval(broadcastStatusUpdates, 3000);
};

// Start the polling loop once when the server starts.
initializeStatusesAndStartPolling();

statusWss.on('connection', (ws) => {
    console.log('Client connected for status updates.');
    
    // Send the current state to the newly connected client immediately.
    console.log('Sending current status to new client:', serviceStatusState);
    Object.entries(serviceStatusState).forEach(([name, status]) => {
        ws.send(JSON.stringify({ serviceName: name, status }));
    });

    ws.on('close', () => {
        console.log('Client disconnected from status updates.');
    });

    ws.on('error', (error) => {
        console.error('Status WebSocket error:', error);
    });
});

server.on('upgrade', (request, socket, head) => {
    const { pathname, query } = url.parse(request.url, true);
    const logMatch = pathname.match(/^\/ws\/logs\/(.+)$/);

    if (logMatch) {
        logWss.handleUpgrade(request, socket, head, async(ws) => {
            const serviceName = logMatch[1];
            const file = query.file;
            const search = query.search || '';
            
            if (!file) {
                ws.close(1008, 'File query parameter is required');
                return;
            }

            const unwatch = await DockerModule.monitorServiceLogs(serviceName, file, (logLine) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(logLine);
                }
            }, search);

            ws.on('close', () => {
                console.log('Client disconnected, stopping log watch.');
                unwatch();
            });

            ws.on('error', (error) => {
                console.error('WebSocket error:', error);
                unwatch();
            });
        });
    } else if (pathname === '/ws/status') {
        statusWss.handleUpgrade(request, socket, head, (ws) => {
            statusWss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});