import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';

interface BackendStatus {
    id: string;
    displayName?: string;
    isReady: boolean;
}

interface StatusData {
    status?: string;
    uptime?: number;
    backends?: BackendStatus[];
}

interface ConfigData extends Partial<GatewayOptions> {
    // Allow any string keys for flexibility, but known keys should be strongly typed if possible.
    [key: string]: unknown;
    FRONTEND_PORT?: number;
}

export function StatusTab() {
    const [statusData, setStatusData] = useState<StatusData | null>(null);
    const [configData, setConfigData] = useState<ConfigData | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // Fetch Status
        fetch('/api/status')
            .then(res => res.ok ? res.json() : Promise.reject(new Error(`Failed to fetch status: ${res.status} ${res.statusText}`)))
            .then(data => setStatusData(data))
            .catch(err => {
                console.error('Error fetching status:', err);
                setError(prev => prev ? `${prev}\nError fetching status: ${err.message}` : `Error fetching status: ${err.message}`);
            });

        // Fetch Current Effective Config
        fetch('/api/config')
            .then(res => res.ok ? res.json() : Promise.reject(new Error(`Failed to fetch config: ${res.status} ${res.statusText}`)))
            .then(data => setConfigData(data))
            .catch(err => {
                console.error('Error fetching current config:', err);
                setError(prev => prev ? `${prev}\nError fetching current config: ${err.message}` : `Error fetching current config: ${err.message}`);
            });
    }, []);

    if (error) {
        return <pre>Error loading data for this tab: {error}</pre>;
    }

    return (
        <div class="tab-content-item">
            <section id="status-section">
                <h2>Gateway Status</h2>
                {statusData ? (
                    <div>
                        <ul>
                            <li><strong>Status:</strong> {statusData.status || 'N/A'}</li>
                            <li><strong>Uptime:</strong> {statusData.uptime?.toFixed(2) || 'N/A'}s</li>
                        </ul>
                        <h3>Backends:</h3>
                        {statusData.backends && statusData.backends.length > 0 ? (
                            <ul>
                                {statusData.backends.map(backend => (
                                    <li key={backend.id}>
                                        <strong>{backend.displayName || backend.id}:</strong> 
                                        <span class={backend.isReady ? 'status-ready' : 'status-not-ready'}>
                                            {backend.isReady ? 'Ready' : 'Not Ready'}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p>No backends configured or status unavailable.</p>
                        )}
                    </div>
                ) : (
                    <p>Loading status...</p>
                )}
            </section>

            <section id="current-config-section">
                <h2>Current Effective Configuration</h2>
                {configData ? (
                    <pre>{JSON.stringify(configData, null, 2)}</pre>
                ) : (
                    <p>Loading current configuration...</p>
                )}
            </section>
        </div>
    );
} 