document.addEventListener('DOMContentLoaded', () => {
    // Tab switching logic
    window.openTab = function(evt, tabName) {
        let i, tabcontent, tabbuttons;
        tabcontent = document.getElementsByClassName('tab-content');
        for (i = 0; i < tabcontent.length; i++) {
            tabcontent[i].style.display = 'none';
            tabcontent[i].classList.remove('active');
        }
        tabbuttons = document.getElementsByClassName('tab-button');
        for (i = 0; i < tabbuttons.length; i++) {
            tabbuttons[i].classList.remove('active');
        }
        const currentTab = document.getElementById(tabName);
        if (currentTab) {
            currentTab.style.display = 'block';
            currentTab.classList.add('active');
        }
        if (evt && evt.currentTarget) {
            evt.currentTarget.classList.add('active');
        }
    };

    // Make the first tab active by default if no other is explicitly set
    // This might need adjustment if HTML default active class is preferred
    const defaultTabButton = document.querySelector('.tab-button.active');
    if (defaultTabButton) {
        // Trigger click to ensure content is displayed and styles applied if openTab relies on it.
        // Or, if HTML structure is already correct, ensure display:block for active tab-content.
        // For simplicity, if HTML sets the first tab as active, ensure its content is visible.
        const onclickAttr = defaultTabButton.getAttribute('onclick');
        if (onclickAttr) {
            const match = onclickAttr.match(/openTab\(event, '([^\']+)'\)/);
            if (match && match[1]) {
                const activeTabContentId = match[1];
                const activeTabContent = document.getElementById(activeTabContentId);
                if (activeTabContent) activeTabContent.style.display = 'block';
            }
        }
    } else {
        // Fallback if no button is marked active: activate the first one.
        const firstTabButton = document.querySelector('.tab-button');
        if (firstTabButton && typeof firstTabButton.click === 'function') {
            firstTabButton.click();
        }
    }

    const statusContent = document.getElementById('status-content');
    // Note: ID was 'config-content', HTML changed to 'current-config-content'
    const currentConfigContent = document.getElementById('current-config-content'); 
    const logsContent = document.getElementById('logs-content');
    const tracesContent = document.getElementById('traces-content');

    // New elements for Configuration Details Tab
    const initialEnvConfigContent = document.getElementById('initial-env-config-content');
    const clientInitOptionsContent = document.getElementById('client-init-options-content');
    const finalEffectiveConfigContent = document.getElementById('final-effective-config-content');

    const logLevelFilter = document.getElementById('log-level-filter');
    const logAutoScroll = document.getElementById('log-auto-scroll');
    const traceAutoScroll = document.getElementById('trace-auto-scroll');

    const MAX_LOG_ENTRIES = 200; // Max entries to keep in the DOM for performance
    let currentLogLevel = 'INFO';
    const logLevels = { TRACE: 10, DEBUG: 20, INFO: 30, WARN: 40, ERROR: 50, FATAL: 60 };

    // Fetch initial status
    if (statusContent) {
        fetch('/api/status')
            .then(res => res.ok ? res.json() : Promise.reject({status: res.status, statusText: res.statusText}))
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
    }

    // Fetch current effective config (for the first tab)
    if (currentConfigContent) {
        fetch('/api/config')
            .then(res => res.ok ? res.json() : Promise.reject({status: res.status, statusText: res.statusText}))
            .then(data => {
                currentConfigContent.textContent = JSON.stringify(data, null, 2);
            })
            .catch(err => {
                currentConfigContent.textContent = 'Error loading current effective configuration.';
                console.error('Error fetching current config:', err);
            });
    }

    // Fetch detailed configuration states (for the new tab)
    if (initialEnvConfigContent && clientInitOptionsContent && finalEffectiveConfigContent) {
        fetch('/api/config-details')
            .then(res => res.ok ? res.json() : Promise.reject({status: res.status, statusText: res.statusText}))
            .then(data => {
                initialEnvConfigContent.textContent = JSON.stringify(data.initialEnvConfig, null, 2);
                clientInitOptionsContent.textContent = JSON.stringify(data.clientSentInitOptions, null, 2);
                finalEffectiveConfigContent.textContent = JSON.stringify(data.finalEffectiveConfig, null, 2);
            })
            .catch(err => {
                const errorMsg = 'Error loading configuration details.';
                initialEnvConfigContent.textContent = errorMsg;
                clientInitOptionsContent.textContent = errorMsg;
                finalEffectiveConfigContent.textContent = errorMsg;
                console.error('Error fetching config details:', err);
            });
    }

    function addEntryToContainer(container, entryElement, maxEntries, autoScrollCheckbox) {
        if (!container || !autoScrollCheckbox) return; // Guard against nulls
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
    if (logsContent && tracesContent && logAutoScroll && traceAutoScroll) { // Ensure elements exist
        const logsWs = new WebSocket(`ws://${window.location.host}`);

        logsWs.onopen = () => {
            console.log('Debug Log WebSocket connected');
            if (logsContent.innerHTML.includes('<em>')) { // Clear any previous status messages
                 logsContent.innerHTML = '';
            }
            logsContent.insertAdjacentHTML('beforeend', '<p><em>Connected to real-time logs/traces...</em></p>'); 
        };

        logsWs.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'log_entry') {
                    const log = data.payload;
                    if (currentLogLevel !== 'all' && logLevels[log.level] < logLevels[currentLogLevel]) {
                        return; 
                    }
                    const logEntryDiv = document.createElement('div');
                    logEntryDiv.classList.add('log-entry', `level-${log.level}`);
                    let detailsHtml = '';
                    if (log.details && Object.keys(log.details).length > 0) {
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
                    const trace = data.payload;
                    const traceEntryDiv = document.createElement('div');
                    traceEntryDiv.classList.add('trace-entry', `direction-${trace.direction}`);
                    let paramsHtml = '';
                    if (trace.paramsOrResult) {
                        paramsHtml = `<div class="params"><pre>${JSON.stringify(trace.paramsOrResult, null, 2)}</pre></div>`;
                    }
                    let errorHtml = '';
                    if (trace.error) {
                        errorHtml = `<div class="error-details"><pre><strong>Error:</strong> ${escapeHtml(trace.error.name || 'Unknown Error')}: ${escapeHtml(trace.error.message || 'No message')}\n${escapeHtml(trace.error.stack || '')}</pre></div>`;
                    }
                    traceEntryDiv.innerHTML = `
                        <span class="timestamp">${formatTimestamp(trace.timestamp)}</span>
                        <span class="direction">[${trace.direction}]</span>
                        <span class="method">${trace.backendId ? `${escapeHtml(trace.backendId)} -> ` : ''}${escapeHtml(trace.method)}</span>
                        ${trace.id ? `<span class="trace-id">(ID: ${escapeHtml(String(trace.id))})</span>` : ''}
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
            setTimeout(() => {
                 window.location.reload(); 
            }, 5000);
        };

        logsWs.onerror = (error) => {
            console.error('Log WebSocket error:', error);
            const p = document.createElement('p');
            p.innerHTML = '<em>Log WebSocket connection error.</em>';
            logsContent.appendChild(p);
        };
    }

    if (logLevelFilter) {
        logLevelFilter.addEventListener('change', (event) => {
            currentLogLevel = event.target.value;
        });
    }

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