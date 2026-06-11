import { useCallback, useEffect, useState } from 'preact/hooks';

interface ChatMessage {
    sender: 'user' | 'agent';
    text: string;
}

export function ChatTab() {
    const [agents, setAgents] = useState<string[]>([]);
    const [selectedAgent, setSelectedAgent] = useState('');
    const [query, setQuery] = useState('');
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetch('/api/config')
            .then((response) => response.json())
            .then((config) => {
                const configuredAgents = Array.isArray(config.agents) ? config.agents : [];
                setAgents(configuredAgents);
                setSelectedAgent(configuredAgents[0] || '');
            })
            .catch((caughtError) => setError(String(caughtError)));
    }, []);

    const send = useCallback(async () => {
        const trimmedQuery = query.trim();
        if (!trimmedQuery || !selectedAgent) return;

        setMessages((current) => [...current, { sender: 'user', text: trimmedQuery }]);
        setQuery('');
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetch('/api/chat-with-agent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    agentModelString: selectedAgent,
                    params: { query: trimmedQuery },
                }),
            });
            const body = await response.json();
            if (!response.ok) {
                throw new Error(body.message || `Request failed with status ${response.status}`);
            }
            setMessages((current) => [...current, { sender: 'agent', text: body.message }]);
        } catch (caughtError) {
            setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
        } finally {
            setIsLoading(false);
        }
    }, [query, selectedAgent]);

    return (
        <div class="tab-content-item">
            <h2>Chat with OpenAI</h2>
            {error && <pre class="error-display">{error}</pre>}
            <div class="chat-controls filter-bar">
                <label for="agent-select">Agent:</label>
                <select
                    id="agent-select"
                    value={selectedAgent}
                    onChange={(event) => setSelectedAgent((event.target as HTMLSelectElement).value)}
                    disabled={agents.length === 0 || isLoading}
                >
                    {agents.length === 0 && <option value="">No agents configured</option>}
                    {agents.map((agent) => (
                        <option key={agent} value={agent}>
                            {agent}
                        </option>
                    ))}
                </select>
            </div>
            <div class="chat-history">
                {messages.map((message, index) => (
                    <div key={`${message.sender}-${index}`} class={`chat-message msg-${message.sender}`}>
                        <strong>{message.sender === 'user' ? 'You' : selectedAgent}:</strong>
                        <p>{message.text}</p>
                    </div>
                ))}
                {isLoading && (
                    <p>
                        <em>Waiting for OpenAI...</em>
                    </p>
                )}
            </div>
            <div class="chat-input-area">
                <textarea
                    value={query}
                    onInput={(event) => setQuery((event.target as HTMLTextAreaElement).value)}
                    disabled={!selectedAgent || isLoading}
                    placeholder="Enter a message"
                />
                <button type="button" onClick={send} disabled={!selectedAgent || !query.trim() || isLoading}>
                    Send
                </button>
            </div>
        </div>
    );
}
