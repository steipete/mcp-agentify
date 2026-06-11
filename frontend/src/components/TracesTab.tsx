import { useEffect, useState } from 'preact/hooks';

interface TraceEntry {
    timestamp: number;
    direction: string;
    backendId?: string;
    method: string;
    paramsOrResult?: unknown;
    error?: unknown;
}

export function TracesTab() {
    const [traces, setTraces] = useState<TraceEntry[]>([]);

    useEffect(() => {
        const socket = new WebSocket(`ws://${window.location.host}`);
        socket.onmessage = (event) => {
            const message = JSON.parse(String(event.data));
            if (message.type === 'mcp_trace_entry') {
                setTraces((current) => [message.payload, ...current].slice(0, 200));
            }
        };
        return () => socket.close();
    }, []);

    return (
        <div class="tab-content-item">
            <h2>MCP Traces</h2>
            <div class="log-container">
                {traces.length === 0 && <p>No traces yet.</p>}
                {traces.map((trace, index) => (
                    <details key={`${trace.timestamp}-${index}`} class="trace-entry">
                        <summary>
                            {new Date(trace.timestamp).toLocaleTimeString()} {trace.direction}{' '}
                            {trace.backendId ? `${trace.backendId}:` : ''}
                            {trace.method}
                        </summary>
                        <pre>{JSON.stringify(trace.error || trace.paramsOrResult, null, 2)}</pre>
                    </details>
                ))}
            </div>
        </div>
    );
}
