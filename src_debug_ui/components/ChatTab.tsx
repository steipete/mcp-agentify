import { h, Fragment } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import type { OrchestrationContext } from '../../src/interfaces'; // For context passing

interface Agent {
    id: string; // e.g., "openai_gpt-4.1"
    displayName: string; // e.g., "OpenAI/gpt-4.1"
    methodName: string; // e.g., "agentify/agent_openai_gpt_4_1"
}

interface ChatMessage {
    sender: 'user' | 'agent';
    text: string;
    timestamp: Date;
    data?: any; // For agent's structured response if any
}

export function ChatTab() {
    const [agents, setAgents] = useState<Agent[]>([]);
    const [selectedAgent, setSelectedAgent] = useState<string>('');
    const [currentQuery, setCurrentQuery] = useState<string>('');
    const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    // Fetch available dynamic agents
    useEffect(() => {
        fetch('/api/config-details')
            .then(res => res.ok ? res.json() : Promise.reject(new Error(`API error: ${res.status}`)))
            .then(data => {
                const effectiveConfig = data?.finalEffectiveConfig || data?.initialEnvConfig;
                if (effectiveConfig && effectiveConfig.gptAgents && Array.isArray(effectiveConfig.gptAgents)) {
                    const availableAgents = effectiveConfig.gptAgents.map((fullAgentString: string) => {
                        const sanitizedMethodPart = fullAgentString.replace(/[^a-zA-Z0-9_\/]/g, '_').replace(/\//g, '_');
                        return {
                            id: sanitizedMethodPart, // Use sanitized part for a React key
                            displayName: fullAgentString,
                            methodName: `agentify/agent_${sanitizedMethodPart}`
                        };
                    });
                    setAgents(availableAgents);
                    if (availableAgents.length > 0) {
                        setSelectedAgent(availableAgents[0].methodName);
                    }
                }
            })
            .catch(err => {
                console.error('Error fetching agent list:', err);
                setError('Could not load agent list.');
            });
    }, []);

    const handleSendQuery = useCallback(async () => {
        if (!selectedAgent || !currentQuery.trim()) return;

        const userMessage: ChatMessage = {
            sender: 'user',
            text: currentQuery,
            timestamp: new Date(),
        };
        setChatHistory(prev => [...prev, userMessage]);
        setIsLoading(true);
        setError(null);

        try {
            const requestBody = {
                query: currentQuery,
                context: null 
            };
            setCurrentQuery(''); // Clear input

            // We need a new backend endpoint to proxy this chat message to an internal MCP call
            const response = await fetch('/api/chat-with-agent', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ agentMethod: selectedAgent, params: requestBody }),
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({ message: `HTTP error ${response.status}` }));
                throw new Error(errData.message || `Agent call failed with status ${response.status}`);
            }

            const agentResponseData = await response.json();
            const agentMessage: ChatMessage = {
                sender: 'agent',
                text: agentResponseData.message || 'No message from agent.',
                timestamp: new Date(),
                data: agentResponseData,
            };
            setChatHistory(prev => [...prev, agentMessage]);

        } catch (err: any) { // Catch as any to access err.message
            console.error('Error sending agent query:', err);
            setError(err.message || 'Failed to get response from agent.');
            const errorMessage: ChatMessage = {
                sender: 'agent',
                text: `Error: ${err.message || 'Failed to get response'}`,
                timestamp: new Date(),
            };
            setChatHistory(prev => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
        }
    }, [selectedAgent, currentQuery]);

    return (
        <div class="tab-content-item" id="chat-section-content">
            <h2>Chat with Agents</h2>
            {error && <pre class="error-display">Error: {error}</pre>}
            <div class="chat-controls filter-bar">
                <label for="agent-select">Select Agent:</label>
                <select 
                    id="agent-select" 
                    value={selectedAgent} 
                    onChange={(e: Event) => setSelectedAgent((e.target as HTMLSelectElement).value)}
                    disabled={agents.length === 0 || isLoading}
                >
                    {agents.length === 0 && <option value="">No agents available (set AGENTS env var)</option>}
                    {agents.map(agent => (
                        <option key={agent.id} value={agent.methodName}>{agent.displayName}</option>
                    ))}
                </select>
            </div>

            <div class="chat-history">
                {chatHistory.map((msg, index) => (
                    <div key={index} class={`chat-message msg-${msg.sender}`}>
                        <span class="timestamp">{msg.timestamp.toLocaleTimeString()}</span>
                        <strong class="sender">{msg.sender === 'user' ? 'You' : 'Agent'}:</strong>
                        <p class="text">{msg.text}</p>
                        {msg.data && (
                            <details>
                                <summary>Raw Response Data</summary>
                                <pre>{JSON.stringify(msg.data, null, 2)}</pre>
                            </details>
                        )}
                    </div>
                ))}
                {isLoading && <div class="chat-message msg-system"><em>Agent is thinking...</em></div>}
            </div>

            <div class="chat-input-area">
                <textarea 
                    id="chat-query-input"
                    value={currentQuery}
                    onInput={(e: Event) => setCurrentQuery((e.target as HTMLTextAreaElement).value)}
                    placeholder="Enter your query..."
                    disabled={isLoading || agents.length === 0}
                />
                <button 
                    type="button" 
                    onClick={handleSendQuery} 
                    disabled={isLoading || !currentQuery.trim() || agents.length === 0 || !selectedAgent}
                >
                    Send
                </button>
            </div>
        </div>
    );
} 