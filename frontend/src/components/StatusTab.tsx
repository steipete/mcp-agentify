import { useEffect, useState } from 'preact/hooks';

interface BackendStatus {
    id: string;
    displayName: string;
    isReady: boolean;
    toolCount: number;
}

interface StatusData {
    status: string;
    uptime: number;
    openaiConfigured: boolean;
    openaiModel: string;
    backends: BackendStatus[];
}

export function StatusTab() {
    const [statusData, setStatusData] = useState<StatusData | null>(null);
    const [configData, setConfigData] = useState<unknown>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        Promise.all([
            fetch('/api/status').then((response) => response.json()),
            fetch('/api/config').then((response) => response.json()),
        ])
            .then(([status, config]) => {
                setStatusData(status);
                setConfigData(config);
            })
            .catch((caughtError) => setError(String(caughtError)));
    }, []);

    if (error) return <pre>Error loading status: {error}</pre>;
    if (!statusData) return <p>Loading status...</p>;

    return (
        <div class="tab-content-item">
            <section>
                <h2>Gateway Status</h2>
                <ul>
                    <li>
                        <strong>Status:</strong> {statusData.status}
                    </li>
                    <li>
                        <strong>Uptime:</strong> {statusData.uptime.toFixed(2)}s
                    </li>
                    <li>
                        <strong>OpenAI:</strong>{' '}
                        {statusData.openaiConfigured ? `Configured (${statusData.openaiModel})` : 'Not configured'}
                    </li>
                </ul>
                <h3>Backends</h3>
                <ul>
                    {statusData.backends.map((backend) => (
                        <li key={backend.id}>
                            <strong>{backend.displayName}:</strong>{' '}
                            {backend.isReady ? `Ready, ${backend.toolCount} tools` : 'Not ready'}
                        </li>
                    ))}
                </ul>
            </section>
            <section>
                <h2>Effective Configuration</h2>
                <pre>{JSON.stringify(configData, null, 2)}</pre>
            </section>
        </div>
    );
}
