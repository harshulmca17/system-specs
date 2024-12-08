const express = require('express');
const os = require('os');
const disk = require('diskusage');
const { exec } = require('child_process');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const port = 3001;

app.use(express.json());

// Utility Functions
function formatBytes(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    
    return `${size.toFixed(2)} ${units[unitIndex]}`;
}

function formatUptime(seconds) {
    const days = Math.floor(seconds / (3600 * 24));
    const hours = Math.floor((seconds % (3600 * 24)) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

function getPrivateIP() {
    const interfaces = os.networkInterfaces();
    let privateIP = 'Not found';
    
    Object.keys(interfaces).forEach((ifname) => {
        interfaces[ifname].forEach((iface) => {
            if (iface.family === 'IPv4' && !iface.internal) {
                privateIP = iface.address;
            }
        });
    });
    
    return privateIP;
}

async function getDiskInfo() {
    try {
        const root = '/';
        const info = await disk.check(root);
        return {
            total: formatBytes(info.total),
            free: formatBytes(info.free),
            used: formatBytes(info.total - info.free),
            usedPercentage: (((info.total - info.free) / info.total) * 100).toFixed(2) + '%',
            freePercentage: ((info.free / info.total) * 100).toFixed(2) + '%',
            totalRaw: info.total,
            freeRaw: info.free,
            usedRaw: info.total - info.free
        };
    } catch (err) {
        console.error('Disk info error:', err);
        return {
            total: 'N/A',
            free: 'N/A',
            used: 'N/A',
            usedPercentage: '0%',
            freePercentage: '0%',
            totalRaw: 0,
            freeRaw: 0,
            usedRaw: 0
        };
    }
}
function getCPUInfo() {
    const cpus = os.cpus();
    return cpus.map((cpu, index) => {
        // Calculate total time spent in all states
        const total = Object.values(cpu.times).reduce((acc, time) => acc + time, 0);
        
        // Calculate percentages for each state
        const user = (cpu.times.user / total * 100).toFixed(1);
        const system = (cpu.times.sys / total * 100).toFixed(1);
        const idle = (cpu.times.idle / total * 100).toFixed(1);
        
        return {
            core: index + 1,
            model: cpu.model,
            speed: `${cpu.speed} MHz`,
            times: {
                user: user + '%',
                system: system + '%',
                idle: idle + '%',
                rawTotal: total,
                rawUser: cpu.times.user,
                rawSystem: cpu.times.sys,
                rawIdle: cpu.times.idle
            }
        };
    });
}

function getMemoryInfo() {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    const usedPercentage = ((used / total) * 100).toFixed(2) + '%';
    const freePercentage = ((free / total) * 100).toFixed(2) + '%';

    return {
        total: formatBytes(total),
        free: formatBytes(free),
        used: formatBytes(used),
        usedPercentage,
        freePercentage,
        totalRaw: total,
        freeRaw: free,
        usedRaw: used
    };
}

async function getSystemInfo() {
    const cpuInfo = getCPUInfo();
    const memInfo = getMemoryInfo();
    const diskInfo = await getDiskInfo();

    return {
        os: {
            platform: os.platform(),
            type: os.type(),
            release: os.release(),
            arch: os.arch(),
            hostname: os.hostname()
        },
        cpu: cpuInfo,
        memory: memInfo,
        disk: diskInfo,
        network: {
            privateIP: getPrivateIP(),
            hostname: os.hostname(),
            interfaces: os.networkInterfaces()
        },
        uptime: formatUptime(os.uptime())
    };
}

// WebSocket Connection Handling
wss.on('connection', async (ws) => {
    console.log('Client connected');
    
    try {
        const specs = await getSystemInfo();
        ws.send(JSON.stringify(specs));
    } catch (error) {
        console.error('Error sending initial data:', error);
    }

    const interval = setInterval(async () => {
        try {
            if (ws.readyState === WebSocket.OPEN) {
                const specs = await getSystemInfo();
                ws.send(JSON.stringify(specs));
            }
        } catch (error) {
            console.error('Error sending update:', error);
        }
    }, 1000);

    ws.on('close', () => {
        clearInterval(interval);
        console.log('Client disconnected');
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        clearInterval(interval);
    });
});

// System Control Endpoints
app.post('/system/restart', (req, res) => {
    exec('sudo shutdown -r now', (error) => {
        if (error) {
            console.error('Restart error:', error);
            res.status(500).json({ error: 'Failed to restart system' });
        } else {
            res.json({ message: 'System is restarting' });
        }
    });
});

app.post('/system/shutdown', (req, res) => {
    exec('sudo shutdown -h now', (error) => {
        if (error) {
            console.error('Shutdown error:', error);
            res.status(500).json({ error: 'Failed to shutdown system' });
        } else {
            res.json({ message: 'System is shutting down' });
        }
    });
});

// Main HTML Route
app.get('/', async (req, res) => {
    const initialSpecs = await getSystemInfo();
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>System Monitor</title>
    <style>
        /* Add all the styles here */
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
        }

        .cpu-carousel {
            position: relative;
            overflow: hidden;
            padding: 0 40px;
            margin: 20px 0;
        }

        .cpu-container {
            display: flex;
            transition: transform 0.3s ease;
            gap: 20px;
        }

        .cpu-core-card {
            flex: 0 0 calc(33.333% - 20px);
            min-width: 300px;
            background: #fff;
            border-radius: 8px;
            padding: 15px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        .carousel-button {
            position: absolute;
            top: 50%;
            transform: translateY(-50%);
            background: #2196F3;
            color: white;
            border: none;
            width: 35px;
            height: 35px;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            z-index: 10;
        }

        .carousel-button.prev { left: 0; }
        .carousel-button.next { right: 0; }

        .carousel-indicator {
            display: flex;
            justify-content: center;
            gap: 8px;
            margin-top: 15px;
        }

        .indicator-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #ddd;
            cursor: pointer;
        }

        .indicator-dot.active {
            background: #2196F3;
        }

        .usage-bar {
            width: 100%;
            height: 20px;
            background: #f0f0f0;
            border-radius: 10px;
            overflow: hidden;
            margin: 10px 0;
        }

        .usage-fill {
            height: 100%;
            transition: width 0.3s ease;
            background: linear-gradient(90deg, #4CAF50, #45a049);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 0.8em;
        }

        .segment-bar {
            display: flex;
            height: 100%;
            width: 100%;
        }

        .segment {
            height: 100%;
            transition: width 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 0.8em;
        }

        .segment-user { background: #2196F3; }
        .segment-system { background: #FF9800; }
        .segment-idle { background: #E0E0E0; color: #666; }

        .card {
            background: white;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        .button-container {
            display: flex;
            gap: 10px;
            margin-top: 20px;
        }

        .button {
            padding: 10px 20px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            color: white;
            font-weight: bold;
        }

        .restart { background: #2196F3; }
        .poweroff { background: #f44336; }

        /* Add any additional styles needed */
    </style>
</head>
<body>
     <div class="container">
        <h1>System Monitor</h1>
        <div class="auto-update">Auto-updating every second</div>

        <div class="card">
            <h2>CPU Usage</h2>
            <div class="cpu-carousel">
                <button class="carousel-button prev" onclick="moveCarousel(-1)">←</button>
                <button class="carousel-button next" onclick="moveCarousel(1)">→</button>
                <div class="cpu-container" id="cpuContainer">
                    ${initialSpecs.cpu.map(core => `
                        <div class="cpu-core-card" id="cpu-core-${core.core}">
    <div class="spec-item">
        <div class="usage-label">
            <span>Core ${core.core} (${core.speed})</span>
            <span class="metric-value">Usage: ${(100 - parseFloat(core.times.idle)).toFixed(2)}%</span>
        </div>
        <div class="usage-bar">
            <div class="segment-bar">
                <div class="segment segment-user" style="width: ${core.times.user}"></div>
                <div class="segment segment-system" style="width: ${core.times.system}"></div>
                <div class="segment segment-idle" style="width: ${core.times.idle}"></div>
            </div>
        </div>
        <div class="legend">
            <div class="legend-item">
                <div class="legend-color" style="background: #2196F3"></div>
                <span>User: <span class="user-percent">${core.times.user}</span></span>
            </div>
            <div class="legend-item">
                <div class="legend-color" style="background: #FF9800"></div>
                <span>System: <span class="system-percent">${core.times.system}</span></span>
            </div>
            <div class="legend-item">
                <div class="legend-color" style="background: #E0E0E0"></div>
                <span>Idle: <span class="idle-percent">${core.times.idle}</span></span>
            </div>
        </div>
    </div>
</div>
                    `).join('')}
                </div>
            </div>
            <div class="carousel-indicator" id="carouselIndicator">
                ${Array(Math.ceil(initialSpecs.cpu.length / 3)).fill(0).map((_, i) => `
                    <div class="indicator-dot ${i === 0 ? 'active' : ''}" onclick="goToPage(${i})"></div>
                `).join('')}
            </div>
        </div>

        <div class="card">
            <h2>Memory Usage</h2>
            <div class="spec-item">
                <span class="spec-label">Total:</span> ${initialSpecs.memory.total}
            </div>
            <div class="spec-item">
                <span class="spec-label">Used:</span> <span id="memory-used">${initialSpecs.memory.used}</span>
                <div class="usage-bar">
                    <div class="usage-fill" style="width: ${initialSpecs.memory.usedPercentage}">${initialSpecs.memory.used}</div>
                </div>
            </div>
            <div class="spec-item">
                <span class="spec-label">Free:</span> <span id="memory-free">${initialSpecs.memory.free}</span>
            </div>
        </div>

        <div class="card">
            <h2>Disk Usage</h2>
            <div class="spec-item">
                <span class="spec-label">Total:</span> ${initialSpecs.disk.total}
            </div>
            <div class="spec-item">
                <span class="spec-label">Used:</span> <span id="disk-used">${initialSpecs.disk.used}</span>
                <div class="usage-bar">
                    <div class="usage-fill" style="width: ${initialSpecs.disk.usedPercentage}">${initialSpecs.disk.used}</div>
                </div>
            </div>
            <div class="spec-item">
                <span class="spec-label">Free:</span> <span id="disk-free">${initialSpecs.disk.free}</span>
            </div>
        </div>

        <div class="card">
            <h2>Network</h2>
            <div class="spec-item">
                <span class="spec-label">Private IP:</span> ${initialSpecs.network.privateIP}
            </div>
            <div class="spec-item">
                <span class="spec-label">Hostname:</span> ${initialSpecs.network.hostname}
            </div>
        </div>

        <div class="card">
            <h2>System Information</h2>
            <div class="spec-item">
                <span class="spec-label">OS:</span> ${initialSpecs.os.type} ${initialSpecs.os.release}
            </div>
            <div class="spec-item">
                <span class="spec-label">Architecture:</span> ${initialSpecs.os.arch}
            </div>
            <div class="spec-item">
                <span class="spec-label">Uptime:</span> <span id="uptime">${initialSpecs.uptime}</span>
            </div>
            <div class="button-container">
                <button class="button restart" onclick="confirmAction('restart')">Restart System</button>
                <button class="button poweroff" onclick="confirmAction('shutdown')">Power Off</button>
            </div>
        </div>
    </div>

    <script>
        let currentPage = 0;
        const itemsPerPage = 3;

        function updateCarouselPosition() {
            const container = document.getElementById('cpuContainer');
            const coreWidth = container.children[0].offsetWidth + 20;
            container.style.transform = \`translateX(-\${currentPage * itemsPerPage * coreWidth}px)\`;
            
            const indicators = document.querySelectorAll('.indicator-dot');
            indicators.forEach((dot, index) => {
                dot.classList.toggle('active', index === currentPage);
            });
        }

        function moveCarousel(direction) {
            const totalCores = document.querySelectorAll('.cpu-core-card').length;
            const maxPages = Math.ceil(totalCores / itemsPerPage) - 1;
            currentPage = Math.max(0, Math.min(maxPages, currentPage + direction));
            updateCarouselPosition();
        }

        function goToPage(page) {
            currentPage = page;
            updateCarouselPosition();
        }

        function confirmAction(action) {
            const message = action === 'restart' ? 
                'Are you sure you want to restart the system?' : 
                'Are you sure you want to shut down the system?';
            
            if (confirm(message)) {
                fetch('/system/' + action, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                })
                .then(response => response.json())
                .then(data => alert(data.message))
                .catch(error => alert('Error: ' + error));
            }
        }

        function connectWebSocket() {
            const ws = new WebSocket('ws://' + window.location.host);
            
            ws.onmessage = function(event) {
                const specs = JSON.parse(event.data);
                updateUI(specs);
            };
            
            ws.onclose = function() {
                setTimeout(connectWebSocket, 1000);
            };
        }

        function updateUI(specs) {
            // Update Memory
            document.getElementById('memory-used').textContent = specs.memory.used;
            document.getElementById('memory-free').textContent = specs.memory.free;
            document.querySelector('.memory-fill').style.width = specs.memory.usedPercentage;
            document.querySelector('.memory-fill').textContent = specs.memory.used;

            // Update Disk
            document.getElementById('disk-used').textContent = specs.disk.used;
            document.getElementById('disk-free').textContent = specs.disk.free;
            document.querySelector('.disk-fill').style.width = specs.disk.usedPercentage;
            document.querySelector('.disk-fill').textContent = specs.disk.used;

            // Update CPU cores
            specs.cpu.forEach((core, index) => {
                const coreElement = document.getElementById(\`cpu-core-\${core.core}\`);
                if (coreElement) {
                    const totalUsage = (100 - parseFloat(core.times.idle)).toFixed(1);
                    coreElement.querySelector('.metric-value').textContent = \`Total Usage: \${totalUsage}%\`;
                    coreElement.querySelector('.segment-user').style.width = core.times.user;
                    coreElement.querySelector('.segment-system').style.width = core.times.system;
                    coreElement.querySelector('.segment-idle').style.width = core.times.idle;
                    coreElement.querySelector('.user-percent').textContent = core.times.user;
                    coreElement.querySelector('.system-percent').textContent = core.times.system;
                    coreElement.querySelector('.idle-percent').textContent = core.times.idle;
                }
            });

            // Update Uptime
            document.getElementById('uptime').textContent = specs.uptime;
        }

        window.onload = function() {
            connectWebSocket();
            updateCarouselPosition();
        };
    </script>
</body>
</html>
    `);
});

// Error Handling
app.use((err, req, res, next) => {
    console.error('Application error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start Server
server.listen(port, () => {
    console.log(`System monitor running at http://localhost:${port}`);
});

// Graceful Shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});