import { useEffect, useState } from 'preact/hooks';

interface ConfigDetailsData {
    loadedConfig?: unknown;
    finalEffectiveConfig?: unknown;
}

export function ConfigDetailsTab() {
    const [configDetails, setConfigDetails] = useState<ConfigDetailsData | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetch('/api/config-details')
            .then((response) => {
                if (!response.ok) throw new Error(`Failed to fetch config details: ${response.status}`);
                return response.json();
            })
            .then(setConfigDetails)
            .catch((caughtError) => setError(String(caughtError)));
    }, []);

    if (error) return <pre>Error: {error}</pre>;
    if (!configDetails) return <p>Loading configuration details...</p>;

    return (
        <div class="tab-content-item">
            <h2>Configuration</h2>
            <section>
                <h3>Loaded Config</h3>
                <pre>{JSON.stringify(configDetails.loadedConfig, null, 2)}</pre>
            </section>
            <section>
                <h3>Final Effective Config</h3>
                <pre>{JSON.stringify(configDetails.finalEffectiveConfig, null, 2)}</pre>
            </section>
        </div>
    );
}
