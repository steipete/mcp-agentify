document.addEventListener('DOMContentLoaded', () => {
    const statusContent = document.getElementById('status-content');
    const configContent = document.getElementById('config-content');
    const logsContent = document.getElementById('logs-content');
    const tracesContent = document.getElementById('traces-content');

    const logLevelFilter = document.getElementById('log-level-filter');
    const logAutoScroll = document.getElementById('log-auto-scroll');
    const traceAutoScroll = document.getElementById('trace-auto-scroll');

    const MAX_LOG_ENTRIES = 200; // Max entries to keep in the DOM for performance
    let currentLogLevel = 'INFO';
    const logLevels = { TRACE: 10, DEBUG: 20, INFO: 30, WARN: 40, ERROR: 50, FATAL: 60 };

    // Fetch initial status
    fetch('/api/status')
        .then(res => res.json())
        .then(data => {
            let html = `<ul>
                <li><strong>Status:</strong> ${data.status}</li>
                <li><strong>Uptime:</strong> ${data.uptime?.toFixed(2)}s</li>
                </ul><h3>Backends:</h3><ul>`;
            if (data.backends && data.backends.length > 0) {
                for (const backend of data.backends) {
                    html += `<li><strong>${backend.displayName || backend.id}:</strong> ${backend.isReady ? 'Ready' : 'Not Ready'}</li>`;
                }
            } else {
                html += '<li>No backends configured or available.</li>';
            }
            html += '</ul>';
            statusContent.innerHTML = html;
        })
        .catch(err => {
            statusContent.innerHTML = '<p>Error loading status.</p>';
            console.error('Error fetching status:', err);
        });

    // Fetch initial config
    fetch('/api/config')
        .then(res => res.json())
        .then(data => {
            configContent.textContent = JSON.stringify(data, null, 2);
        })
        .catch(err => {
            configContent.textContent = 'Error loading configuration.';
            console.error('Error fetching config:', err);
        });

    function addEntryToContainer(container, entryElement, maxEntries, autoScrollCheckbox) {
        const isScrolledToBottom = container.scrollHeight - container.clientHeight <= container.scrollTop + 1;
        container.appendChild(entryElement);
        while (container.children.length > maxEntries) {
            container.removeChild(container.firstChild);
        }
        if (autoScrollCheckbox.checked && isScrolledToBottom) {
            container.scrollTop = container.scrollHeight;
        }
    }
    
    function formatTimestamp(epochMs) {
        return new Date(epochMs).toLocaleTimeString('en-US', { hour12: false });
    }

    // Logs WebSocket
    const logsWs = new WebSocket(`ws://${window.location.host}`);

    logsWs.onopen = () => {
        console.log('Debug Log WebSocket connected');
        logsContent.innerHTML = '<p><em>Connected to real-time logs...</em></p>'; 
    };

    logsWs.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'log_entry') {
                const log = data.payload;
                if (currentLogLevel !== 'all' && logLevels[log.level] < logLevels[currentLogLevel]) {
                    return; // Skip if below current log level filter
                }

                const logEntryDiv = document.createElement('div');
                logEntryDiv.classList.add('log-entry', `level-${log.level}`);
                
                let detailsHtml = '';
                if (log.details && Object.keys(log.details).length > 0) {
                    // Simple formatting for details
                    detailsHtml = `<div class="details"><pre>${JSON.stringify(log.details, null, 2)}</pre></div>`;
                }

                logEntryDiv.innerHTML = `
                    <span class="timestamp">${formatTimestamp(log.timestamp)}</span>
                    <span class="level">[${log.level}]</span>
                    <span class="message">${escapeHtml(log.message)}</span>
                    ${detailsHtml}
                `;
                addEntryToContainer(logsContent, logEntryDiv, MAX_LOG_ENTRIES, logAutoScroll);
            } else if (data.type === 'mcp_trace_entry') {
                 // Also handle trace entries if they come over the same WebSocket connection
                const trace = data.payload;
                const traceEntryDiv = document.createElement('div');
                traceEntryDiv.classList.add('trace-entry', `direction-${trace.direction}`);
                
                let paramsHtml = '';
                if (trace.paramsOrResult) {
                    paramsHtml = `<div class="params"><pre>${JSON.stringify(trace.paramsOrResult, null, 2)}</pre></div>`;
                }
                let errorHtml = '';
                if (trace.error) {
                    errorHtml = `<div class="error-details"><pre><strong>Error:</strong> ${escapeHtml(trace.error.name)}: ${escapeHtml(trace.error.message)}\n${escapeHtml(trace.error.stack || '')}</pre></div>`;
                }

                traceEntryDiv.innerHTML = `
                    <span class="timestamp">${formatTimestamp(trace.timestamp)}</span>
                    <span class="direction">[${trace.direction}]</span>
                    <span class="method">${trace.backendId ? `${trace.backendId} -> ` : ''}${escapeHtml(trace.method)}</span>
                    ${trace.id ? `<span class="trace-id">(ID: ${escapeHtml(trace.id)})</span>` : ''}
                    ${paramsHtml}
                    ${errorHtml}
                `;
                addEntryToContainer(tracesContent, traceEntryDiv, MAX_LOG_ENTRIES, traceAutoScroll);
            }

        } catch (e) {
            console.error('Error processing WebSocket message:', e, event.data);
            const errorDiv = document.createElement('div');
            errorDiv.textContent = `Error processing message: ${event.data}`;
            logsContent.appendChild(errorDiv);
        }
    };

    logsWs.onclose = () => {
        console.log('Debug Log WebSocket disconnected');
        const p = document.createElement('p');
        p.innerHTML = '<em>Log WebSocket disconnected. Attempting to reconnect...</em>';
        logsContent.appendChild(p);
        // Simple reconnect logic
        setTimeout(() => {
            // This will trigger a new WebSocket connection attempt by reloading the script logic or re-initializing.
            // For a more robust solution, create a new WebSocket instance and re-attach handlers.
             window.location.reload(); // Simplest way for PoC
        }, 5000);
    };

    logsWs.onerror = (error) => {
        console.error('Log WebSocket error:', error);
        const p = document.createElement('p');
        p.innerHTML = '<em>Log WebSocket connection error.</em>';
        logsContent.appendChild(p);
    };

    logLevelFilter.addEventListener('change', (event) => {
        currentLogLevel = event.target.value;
        // Clear logs and re-filter or wait for new logs based on this level
        // For simplicity, new logs will be filtered. Old ones remain.
        // A more advanced version could re-filter existing DOM elements.
    });

    function escapeHtml(unsafe) {
        if (unsafe === null || typeof unsafe === 'undefined') return '';
        return unsafe
            .toString()
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // Initial fetch of historical logs/traces (optional, if API supports it well with pagination)
    // fetch('/api/logs?pageSize=50').then(r => r.json()).then(data => data.logs.reverse().forEach(log => addLogEntryToDOM(log)));
    // fetch('/api/traces?pageSize=50').then(r => r.json()).then(data => data.traces.reverse().forEach(trace => addTraceEntryToDOM(trace)));
    // The current WebSocket implementation adds new entries. Historical loading can be added if needed.
}); 