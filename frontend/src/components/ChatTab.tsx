import { h, Fragment } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import type { OrchestrationContext } from '../../../src/interfaces'; // Adjusted path

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

    // Fetch available dynamic agents with basic retry (handles early 503)
    useEffect(() => {
        const fetchAgents = (attempt = 0) => {
            fetch('/api/config-details')
                .then(res => {
                    if (!res.ok) {
                        console.error(
                            'ChatTab: API call to /api/config-details failed with status:',
                            res.status,
                        );
                        return res.text().then(text => { // Try to get error text
                            throw new Error(`API error ${res.status}: ${text || 'No error message'}`);
                        });
                    }
                    return res.json();
                })
                .then(data => {
                    console.log(
                        'ChatTab: Received data from /api/config-details:',
                        JSON.stringify(data, null, 2),
                    ); // Log the entire raw data

                    let agentsListToProcess: string[] = [];
                    
                    if (data?.finalEffectiveConfig?.gptAgents && Array.isArray(data.finalEffectiveConfig.gptAgents) && data.finalEffectiveConfig.gptAgents.length > 0) {
                        agentsListToProcess = data.finalEffectiveConfig.gptAgents;
                        console.log(
                            'ChatTab: Using gptAgents from finalEffectiveConfig:',
                            JSON.stringify(agentsListToProcess),
                        );
                    } 
                    else if (data?.initialEnvConfig?.gptAgents && Array.isArray(data.initialEnvConfig.gptAgents) && data.initialEnvConfig.gptAgents.length > 0) {
                        agentsListToProcess = data.initialEnvConfig.gptAgents;
                        console.log(
                            'ChatTab: Using gptAgents from initialEnvConfig:',
                            JSON.stringify(agentsListToProcess),
                        );
                    } else {
                        console.warn('ChatTab: No gptAgents array found or array is empty in both finalEffectiveConfig and initialEnvConfig.');
                        // Log the relevant parts of the config to see why it's empty
                        if (data?.finalEffectiveConfig) {
                            console.log(
                                'ChatTab: finalEffectiveConfig.gptAgents:',
                                JSON.stringify(data.finalEffectiveConfig.gptAgents)
                            );
                        }
                        if (data?.initialEnvConfig) {
                            console.log(
                                'ChatTab: initialEnvConfig.gptAgents:', 
                                JSON.stringify(data.initialEnvConfig.gptAgents), // Ensure this line has a comma if it's not the last arg
                            );
                        }
                    }

                    if (agentsListToProcess.length > 0) {
                        setError(null); // clear previous error if retry succeeds
                        const availableAgents = agentsListToProcess.map((fullAgentString: string) => {
                            const sanitizedMethodPart = fullAgentString.replace(/[^a-zA-Z0-9_\/]/g, '_').replace(/\//g, '_');
                            return {
                                id: sanitizedMethodPart, // Use sanitized part for a React key
                                displayName: fullAgentString,
                                methodName: `agentify/agent_${sanitizedMethodPart}`
                            };
                        });
                        console.log('ChatTab: Processed availableAgents:', JSON.stringify(availableAgents));
                        setAgents(availableAgents);
                        if (availableAgents.length > 0) { // This check is a bit redundant now but harmless
                            setSelectedAgent(availableAgents[0].methodName);
                            console.log('ChatTab: Selected agent set to:', availableAgents[0].methodName); 
                        }
                    } else {
                        setAgents([]);
                        setSelectedAgent('');
                        console.warn('ChatTab: agentsListToProcess is empty. Setting no agents.'); 
                    }
                })
                .catch((err: any) => {
                    console.error('ChatTab: Error fetching or processing agent list:', err.message, err.stack);
                    setError(`Could not load agent list: ${err.message}`);
                    setAgents([]); // Clear agents on error
                    setSelectedAgent('');
                    if (attempt < 2) {
                        setTimeout(() => fetchAgents(attempt + 1), 1000);
                    }
                });
        };

        fetchAgents();
    }, []);

    const handleSendQuery = useCallback(async () => {
        if (!selectedAgent || !currentQuery.trim() || agents.length === 0) {
            return;
        }

        const agentToCall = agents.find(agent => agent.methodName === selectedAgent);
        if (!agentToCall) {
            setError('Selected agent details not found. Cannot send query.');
            setIsLoading(false);
            return;
        }
        const agentIdentifierForApi = agentToCall.displayName;

        const userMessage: ChatMessage = {
            sender: 'user',
            text: currentQuery,
            timestamp: new Date(),
        };
        setChatHistory(prev => [...prev, userMessage]);
        setIsLoading(true);
        setError(null);

        try {
            const requestBodyForAgentParams = {
                query: currentQuery,
                context: null 
            };
            setCurrentQuery(''); 

            const response = await fetch('/api/chat-with-agent', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    agentModelString: agentIdentifierForApi,
                    params: requestBodyForAgentParams
                }),
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

        } catch (err: any) { 
            console.error('ChatTab: Error in handleSendQuery:', err);
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
    }, [selectedAgent, currentQuery, agents]);

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