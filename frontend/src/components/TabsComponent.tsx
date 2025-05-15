import { h, ComponentChild } from 'preact';
import { useState, useEffect } from 'preact/hooks';

interface Tab {
    id: string;
    name: string;
    content: ComponentChild;
}

interface TabsComponentProps {
    tabs: Tab[];
}

export function TabsComponent({ tabs }: TabsComponentProps) {
    const [activeTabId, setActiveTabId] = useState<string>(tabs && tabs.length > 0 ? tabs[0].id : '');

    if (!tabs || tabs.length === 0) {
        return <p>No tabs to display.</p>;
    }

    useEffect(() => {
        if (tabs && tabs.length > 0) {
            const currentActiveTabExists = tabs.some(tab => tab.id === activeTabId);
            if (!currentActiveTabExists) {
                setActiveTabId(tabs[0].id);
            }
        } else {
            setActiveTabId('');
        }
    }, [tabs, activeTabId]);

    const activeTabContent = tabs.find(tab => tab.id === activeTabId)?.content;

    return (
        <div>
            <div class="tabs">
                {tabs.map((tab) => (
                    <button
                        type="button"
                        key={tab.id}
                        class={`tab-button ${tab.id === activeTabId ? 'active' : ''}`}
                        onClick={() => setActiveTabId(tab.id)}
                    >
                        {tab.name}
                    </button>
                ))}
            </div>
            <div class="tab-content-area">
                {activeTabContent}
            </div>
        </div>
    );
} 