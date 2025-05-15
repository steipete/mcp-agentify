import { h, type ComponentChild } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';

interface Tab {
    id: string;
    name: string;
    content: ComponentChild;
}

interface TabsComponentProps {
    tabs: Tab[];
}

const HASH_PREFIX = '#/tabs/';

export function TabsComponent({ tabs }: TabsComponentProps) {
    const getTabIdFromUrl = useCallback(() => {
        if (typeof window === 'undefined') return null;
        const hash = window.location.hash;
        if (hash.startsWith(HASH_PREFIX)) {
            const tabId = hash.substring(HASH_PREFIX.length);
            return tabs.find(t => t.id === tabId) ? tabId : null;
        }
        return null;
    }, [tabs]);

    const [activeTabId, setActiveTabId] = useState<string>(() => {
        const fromUrl = getTabIdFromUrl();
        if (fromUrl) return fromUrl;
        return (tabs && tabs.length > 0) ? tabs[0].id : '';
    });

    // Effect 1: Listen to URL hash changes and update state
    useEffect(() => {
        const handleHashChange = () => {
            const tabIdFromUrl = getTabIdFromUrl();
            if (tabIdFromUrl) {
                if (tabIdFromUrl !== activeTabId) {
                    setActiveTabId(tabIdFromUrl);
                }
            } else if (tabs && tabs.length > 0) {
                // Hash is invalid or cleared, default to first tab
                if (activeTabId !== tabs[0].id) {
                    setActiveTabId(tabs[0].id);
                    // The change to activeTabId will trigger Effect 2 to update the hash
                }
            }
        };

        if (typeof window !== 'undefined') {
            window.addEventListener('hashchange', handleHashChange);
        }
        return () => {
            if (typeof window !== 'undefined') {
                window.removeEventListener('hashchange', handleHashChange);
            }
        };
    }, [tabs, activeTabId, getTabIdFromUrl]); // Include activeTabId to avoid stale closure in handleHashChange

    // Effect 2: Update URL hash when activeTabId changes or tabs definition changes
    useEffect(() => {
        if (typeof window === 'undefined') return;

        if (tabs && tabs.length > 0) {
            const currentTabIsValid = tabs.some(tab => tab.id === activeTabId);
            let targetTabId = activeTabId;

            if (!currentTabIsValid) {
                // If activeTabId is not valid (e.g. initial empty state, or tabs changed)
                // set it to the first tab.
                targetTabId = tabs[0].id;
                if (activeTabId !== targetTabId) {
                    setActiveTabId(targetTabId); // This will cause this effect to re-run with the correct targetTabId
                    return; // Exit early, the re-run will handle hash update
                }
            }
            
            // At this point, targetTabId is valid (either original activeTabId or defaulted to first tab)
            const newHash = `${HASH_PREFIX}${targetTabId}`;
            if (window.location.hash !== newHash) {
                window.location.hash = newHash;
            }

        } else {
            // No tabs are present
            if (activeTabId !== '') {
                setActiveTabId('');
            }
            if (window.location.hash.startsWith(HASH_PREFIX) && window.location.hash !== HASH_PREFIX) {
                 // Only clear if it was a tab hash. Avoid clearing unrelated hashes.
                window.location.hash = '';
            }
        }
    }, [activeTabId, tabs]); // Rerun when activeTabId or tabs change

    const handleTabClick = (tabId: string) => {
        if (tabId !== activeTabId) {
            setActiveTabId(tabId);
        }
    };

    if (!tabs || tabs.length === 0) {
        return <p>No tabs to display.</p>;
    }

    const activeTabContent = tabs.find(tab => tab.id === activeTabId)?.content;

    return (
        <div>
            <div class="tabs">
                {tabs.map((tab) => (
                    <button
                        type="button"
                        key={tab.id}
                        class={`tab-button ${tab.id === activeTabId ? 'active' : ''}`}
                        onClick={() => handleTabClick(tab.id)}
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