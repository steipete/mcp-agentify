import { h } from 'preact';
import { TabsComponent } from './components/TabsComponent';
import { StatusTab } from './components/StatusTab';
import { ConfigDetailsTab } from './components/ConfigDetailsTab';
import { LogsTab } from './components/LogsTab';
import { TracesTab } from './components/TracesTab';
import { AgentsBackendsTab } from './components/AgentsBackendsTab';
import { ChatTab } from './components/ChatTab';
// We will import useState, useEffect etc. as needed later

// Import a global stylesheet if you have one (optional)
// import './style.css'; 

export function App() {
    const tabs = [
        { id: 'status', name: 'Status & Config', content: <StatusTab /> },
        { id: 'configDetails', name: 'Config Details', content: <ConfigDetailsTab /> },
        { id: 'agentsBackends', name: 'Agents & Backends', content: <AgentsBackendsTab /> },
        { id: 'chat', name: 'Chat with Agents', content: <ChatTab /> },
        { id: 'logs', name: 'Logs', content: <LogsTab /> },
        { id: 'traces', name: 'Traces', content: <TracesTab /> },
    ];

    return (
        <div class="app-container"> {/* Changed from generic container for clarity */}
            <header>
                <h1>MCP Agentify - Control Panel</h1>
            </header>
            <main>
                <TabsComponent tabs={tabs} />
            </main>
            <footer>
                <p>MCP Agentify Status: <span id="footer-status">UI Loaded</span></p>
            </footer>
        </div>
    );
} 