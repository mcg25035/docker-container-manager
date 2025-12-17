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
const apiAddr = process.env.API_ADDR || 'localhost';

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

// GET /api/services/:name/config-data - Get service configuration data
app.get('/api/services/:name/config-data', async (req, res) => {
    try {
        const { name } = req.params;
        const config = await DockerModule.getServiceConfigData(name);
        res.json(config);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/services/:name/config/env - Write service env configuration
app.post('/api/services/:name/config/env', async (req, res) => {
    try {
        const { name } = req.params;
        const { envData } = req.body;
        const result = await DockerModule.writeServiceEnvConfig(name, envData);
        res.json(result);
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

// GET /api/services/:name/logs/time-range
app.get('/api/services/:name/logs/time-range', async (req, res) => {
    try {
        const { name } = req.params;
        const { file } = req.query;
        if (!file) {
             return res.status(400).json({ error: 'File query parameter is required' });
        }
        const result = await DockerModule.getLogFileTimeRange(name, file);
        res.json(result);
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


// Serve frontend after API routes
const frontendDist = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendDist));

// For any other request (that's not a static file or API route),
// serve the index.html file for client-side routing.
// The catch-all route for the SPA.
// It must be defined after all API routes and static file serving.
app.get(/^(?!\/api|\/ws).*/, (req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
});

function startServer() {
    const server = app.listen(port, apiAddr, () => {
        console.log(`API server listening at http://${apiAddr}:${port}`);
    });

    const wss = new WebSocket.Server({ noServer: true });

    server.on('upgrade', (request, socket, head) => {
        const { pathname, query } = url.parse(request.url, true);
        const match = pathname.match(/^\/ws\/logs\/(.+)$/);

        if (match) {
            wss.handleUpgrade(request, socket, head, async (ws) => {
                const serviceName = match[1];
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
        } else {
            socket.destroy();
        }
    });
}

module.exports = { startServer };