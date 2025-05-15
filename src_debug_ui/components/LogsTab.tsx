import { h } from 'preact';

export function LogsTab() {
    // Placeholder for logs content
    // Will later include log level filter and log container
    // Similar to existing logs-section from vanilla JS
    return (
        <div class="tab-content-item" id="logs-section-content">
            <h2>Real-time Logs</h2>
            <div class="filter-bar" id="logs-filter">
                <label for="log-level-filter">Min Level:</label>
                <select id="log-level-filter">
                    <option value="all">All</option>
                    <option value="TRACE">Trace</option>
                    <option value="DEBUG">Debug</option>
                    <option value="INFO" selected>Info</option>
                    <option value="WARN">Warn</option>
                    <option value="ERROR">Error</option>
                    <option value="FATAL">Fatal</option>
                </select>
                <label for="log-auto-scroll">Auto-scroll:</label>
                <input type="checkbox" id="log-auto-scroll" checked />
            </div>
            <div id="logs-content" class="log-container">
                {/* Logs will be rendered here by WebSocket logic */}
                <p><i>Connecting to logs...</i></p>
            </div>
        </div>
    );
} 