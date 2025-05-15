import { h, ComponentChild, Fragment } from 'preact';
import { useState, useEffect } from 'preact/hooks';

// Import actual types for better type safety if they are simple enough
// For this component, it receives GatewayOptions and GatewayClientInitOptions directly from the API
// so we might not need to import the full Zod schemas here, just the TS types if available
import type { GatewayOptions } from '../../src/interfaces'; // GatewayOptions is from interfaces (re-exported from schemas)
import type { GatewayClientInitOptions } from '../../src/schemas'; // GatewayClientInitOptions is directly from schemas

interface ConfigDetailsData {
    initialEnvConfig?: Partial<GatewayOptions>;
    clientSentInitOptions?: GatewayClientInitOptions;
    finalEffectiveConfig?: GatewayOptions;
}

// Helper to render a config object or a placeholder message
const renderConfigBlock = (title: string, data: Record<string, any> | Partial<GatewayOptions> | GatewayClientInitOptions | GatewayOptions | null | undefined) => (
    <div>
        <h3>{title}</h3>
        {data ? (
            <pre>{JSON.stringify(data, null, 2)}</pre>
        ) : (
            <pre>{JSON.stringify({ note: 'Data not available or not yet set.' }, null, 2)}</pre>
        )}
    </div>
);

export function ConfigDetailsTab() {
    const [configDetails, setConfigDetails] = useState<ConfigDetailsData | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetch('/api/config-details')
            .then(res => res.ok ? res.json() : Promise.reject(new Error(`Failed to fetch config details: ${res.status} ${res.statusText}`)))
            .then((data: ConfigDetailsData) => setConfigDetails(data))
            .catch(err => {
                console.error('Error fetching config details:', err);
                setError(`Error fetching config details: ${err.message}`);
            });
    }, []);

    if (error) {
        return <pre>Error: {error}</pre>;
    }

    if (!configDetails) {
        return <p>Loading configuration details...</p>;
    }

    return (
        <div class="tab-content-item">
            <section>
                <h2>Configuration States</h2>
                {renderConfigBlock("Initial Environment/Default Config (Pre-MCP Handshake):", configDetails.initialEnvConfig)}
                {renderConfigBlock("Client-Sent `initializationOptions` (Raw from client):", configDetails.clientSentInitOptions)}
                {renderConfigBlock("Final Effective Config (Post-MCP Handshake):", configDetails.finalEffectiveConfig)}
            </section>
        </div>
    );
} 