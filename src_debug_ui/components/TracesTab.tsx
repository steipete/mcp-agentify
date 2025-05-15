import { h } from 'preact';

export function TracesTab() {
    // Placeholder for traces content
    // Will later include trace filter (auto-scroll) and trace container
    return (
        <div class="tab-content-item" id="traces-section-content">
            <h2>MCP Traces</h2>
            <div class="filter-bar" id="trace-filter">
                <label for="trace-auto-scroll">Auto-scroll:</label>
                <input type="checkbox" id="trace-auto-scroll" checked />
            </div>
            <div id="traces-content" class="log-container">
                {/* Traces will be rendered here by WebSocket logic */}
                <p><i>Connecting to traces...</i></p>
            </div>
        </div>
    );
} 