import { h } from 'preact';
// We will import useState, useEffect etc. as needed later

// Import a global stylesheet if you have one (optional)
// import './style.css'; 

export function App() {
    // Placeholder content - we will build out tabs and components here
    return (
        <div class="app-container"> {/* Changed from generic container for clarity */}
            <header>
                <h1>MCP Agentify - Frontend</h1>
            </header>
            <main>
                <p>Loading UI components...</p>
                {/* Future tabs will go here: <TabsComponent /> */}
            </main>
            <footer>
                <p>MCP Agentify Status: <span id="footer-status">Connecting...</span></p>
            </footer>
        </div>
    );
} 