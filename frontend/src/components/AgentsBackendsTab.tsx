import { useEffect, useState } from 'preact/hooks';

interface BackendState {
    id: string;
    displayName: string;
    isReady: boolean;
    toolCount: number;
    error?: string;
}

export function AgentsBackendsTab() {
    const [backends, setBackends] = useState<BackendState[]>([]);
    const [agents, setAgents] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        Promise.all([
            fetch('/api/status').then((response) => response.json()),
            fetch('/api/config').then((response) => response.json()),
        ])
            .then(([status, config]) => {
                setBackends(status.backends || []);
                setAgents(config.agents || []);
            })
            .catch((caughtError) => setError(String(caughtError)));
    }, []);

    return (
        <div class="tab-content-item">
            <h2>Agents & Backends</h2>
            {error && <pre class="error-display">{error}</pre>}
            <section>
                <h3>UI Chat Agents</h3>
                {agents.length > 0 ? (
                    <ul>
                        {agents.map((agent) => (
                            <li key={agent}>{agent}</li>
                        ))}
                    </ul>
                ) : (
                    <p>No UI chat agents configured.</p>
                )}
            </section>
            <section>
                <h3>Backend MCP Servers</h3>
                {backends.length > 0 ? (
                    <ul>
                        {backends.map((backend) => (
                            <li key={backend.id}>
                                <strong>{backend.displayName}:</strong>{' '}
                                {backend.isReady ? `Ready, ${backend.toolCount} tools` : backend.error || 'Not ready'}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p>No backend state available.</p>
                )}
            </section>
        </div>
    );
}
