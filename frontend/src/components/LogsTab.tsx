import { h, Fragment } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import type { LogEntry } from '../../../src/interfaces'; // Adjusted path

const MAX_LOG_ENTRIES_DISPLAY = 200;
const LOG_LEVELS: Record<string, number> = { TRACE: 10, DEBUG: 20, INFO: 30, WARN: 40, ERROR: 50, FATAL: 60 };

function formatTimestamp(epochMs: number): string {
    return new Date(epochMs).toLocaleTimeString('en-US', { hour12: false });
}

function escapeHtml(unsafe: any): string {
    if (unsafe === null || typeof unsafe === 'undefined') return '';
    return unsafe
        .toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

export function LogsTab() {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [filterLevel, setFilterLevel] = useState<string>('INFO');
    const [autoScroll, setAutoScroll] = useState<boolean>(true);
    const [isConnected, setIsConnected] = useState<boolean>(false);
    const logsContainerRef = useRef<HTMLDivElement | null>(null);
    const wsRef = useRef<WebSocket | null>(null);

    const connectWebSocket = useCallback(() => {
        if (wsRef.current && wsRef.current.readyState < WebSocket.CLOSING) {
            wsRef.current.close();
        }

        const newWs = new WebSocket(`ws://${window.location.host}`);
        wsRef.current = newWs;

        newWs.onopen = () => {
            console.log('Logs WebSocket connected');
            setIsConnected(true);
            setLogs(prev => [{ 
                timestamp: Date.now(), 
                level: 'INFO', 
                message: 'Connected to real-time logs...', 
                details: {} 
            } as LogEntry, ...prev.slice(0, MAX_LOG_ENTRIES_DISPLAY -1)]);
        };

        newWs.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data as string);
                if (data.type === 'log_entry') {
                    const log: LogEntry = data.payload;
                    
                    setLogs(prevLogs => {
                        // Apply filter immediately before adding to state
                        if (filterLevel !== 'all' && LOG_LEVELS[log.level] < LOG_LEVELS[filterLevel]) {
                            return prevLogs; 
                        }
                        const newLogs = [log, ...prevLogs];
                        return newLogs.slice(0, MAX_LOG_ENTRIES_DISPLAY);
                    });
                }
            } catch (e) {
                console.error('Error processing log message:', e, event.data);
                setLogs(prev => [{ 
                    timestamp: Date.now(), 
                    level: 'ERROR', 
                    message: `Error processing ws message: ${event.data}`,
                    details: { error: (e as Error).message } 
                } as LogEntry, ...prev.slice(0, MAX_LOG_ENTRIES_DISPLAY -1)]);
            }
        };

        newWs.onclose = () => {
            console.log('Logs WebSocket disconnected');
            setIsConnected(false);
            setLogs(prev => [{ 
                timestamp: Date.now(), 
                level: 'WARN', 
                message: 'Log WebSocket disconnected. Attempting to reconnect in 5s...',
                details: {} 
            } as LogEntry, ...prev.slice(0, MAX_LOG_ENTRIES_DISPLAY -1)]);
            setTimeout(connectWebSocket, 5000); // Reconnect after 5 seconds
        };

        newWs.onerror = (error) => {
            console.error('Logs WebSocket error:', error);
            setIsConnected(false);
            setLogs(prev => [{ 
                timestamp: Date.now(), 
                level: 'ERROR', 
                message: 'Log WebSocket connection error.',
                details: { errorEvent: JSON.stringify(error, Object.getOwnPropertyNames(error)) }
            } as LogEntry, ...prev.slice(0, MAX_LOG_ENTRIES_DISPLAY -1)]);
            // Reconnect logic is handled by onclose
        };
    }, [filterLevel]); // Reconnect if filterLevel changes? Maybe not, filter is client-side.
                     // Keep filterLevel out for now, as filtering happens on received message.

    useEffect(() => {
        connectWebSocket();
        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
        };
    }, [connectWebSocket]); // Dependency on connectWebSocket (which itself depends on filterLevel, implicitly)

    useEffect(() => {
        if (autoScroll && logsContainerRef.current) {
            // Scroll to bottom when logs update and autoScroll is enabled
            // This logic needs to be smarter; scroll only if user was already at bottom.
            // For simplicity now, always scroll if autoScroll is true.
            logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
        }
    }, [logs, autoScroll]); // Dependency: logs array & autoScroll state

    return (
        <div class="tab-content-item" id="logs-section-content">
            <h2>Real-time Logs</h2>
            <div class="filter-bar" id="logs-filter">
                <label for="log-level-filter">Min Level:</label>
                <select id="log-level-filter" value={filterLevel} onChange={(e) => setFilterLevel((e.target as HTMLSelectElement).value)}>
                    <option value="all">All</option>
                    <option value="TRACE">Trace</option>
                    <option value="DEBUG">Debug</option>
                    <option value="INFO">Info</option>
                    <option value="WARN">Warn</option>
                    <option value="ERROR">Error</option>
                    <option value="FATAL">Fatal</option>
                </select>
                <label for="log-auto-scroll">Auto-scroll:</label>
                <input 
                    type="checkbox" 
                    id="log-auto-scroll" 
                    checked={autoScroll} 
                    onChange={(e) => setAutoScroll((e.target as HTMLInputElement).checked)} 
                />
                <span> Status: {isConnected ? 'Connected' : 'Disconnected'}</span>
            </div>
            <div id="logs-content" class="log-container" ref={logsContainerRef}>
                {logs.map((log, index) => (
                    <div key={index} class={`log-entry level-${log.level}`}>
                        <span class="timestamp">{formatTimestamp(log.timestamp)}</span>
                        <span class="level">[{log.level}]</span>
                        <span class="message">{escapeHtml(log.message)}</span>
                        {log.details && Object.keys(log.details).length > 0 && (
                            <details class="log-details">
                                <summary>Details</summary>
                                <pre>{JSON.stringify(log.details, null, 2)}</pre>
                            </details>
                        )}
                    </div>
                )).reverse()}
            </div>
        </div>
    );
} 