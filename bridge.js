/**
 * BRIDGE.JS - Inter-Layer Communication Bridge
 * 
 * Purpose: Provides clean API between application layers
 * ──────────────────────────────────────────────────────────────
 * 
 * ARCHITECTURE:
 * 
 *   index.html (UI Layer - Static HTML)
 *        ↕
 *   bridge.js (Communication Layer) ← YOU ARE HERE
 *        ↕
 *   app.js (Logic Layer - Dynamic HTML/CSS)
 *        ↕
 *   firestore.js (Data Layer)
 * 
 * ──────────────────────────────────────────────────────────────
 * LOAD ORDER: Must load AFTER firestore.js and app.js
 * ──────────────────────────────────────────────────────────────
 */

let bridgeReady = false;
let initializationComplete = false;

const BridgeState = {
    dataLayerReady: false,
    appLayerReady: false,
    uiLayerReady: false,
};

async function initializeBridge() {
    console.log('[Bridge] 🚀 Starting initialization...');
    
    await waitForDOM();
    BridgeState.uiLayerReady = true;
    console.log('[Bridge] ✓ UI Layer ready');
    
    await waitForDataLayer();
    BridgeState.dataLayerReady = true;
    console.log('[Bridge] ✓ Data Layer ready');
    
    await waitForAppLayer();
    BridgeState.appLayerReady = true;
    console.log('[Bridge] ✓ App Layer ready');
    
    bridgeReady = true;
    initializationComplete = true;
    console.log('[Bridge] ✅ Bridge fully initialized and operational');
}

function waitForDOM() {
    return new Promise((resolve) => {
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            resolve();
        } else {
            document.addEventListener('DOMContentLoaded', resolve);
        }
    });
}

function waitForDataLayer() {
    return new Promise((resolve) => {
        let attempts = 0;
        const maxAttempts = 200;
        
        const check = setInterval(() => {
            attempts++;
            
            if (typeof idb !== 'undefined' && idb.init) {
                clearInterval(check);
                resolve();
            }
            
            if (attempts >= maxAttempts) {
                console.warn('[Bridge] Data layer timeout - continuing anyway');
                clearInterval(check);
                resolve();
            }
        }, 50);
    });
}

function waitForAppLayer() {
    return new Promise((resolve) => {
        let attempts = 0;
        const maxAttempts = 100;
        
        const check = setInterval(() => {
            attempts++;
            
            if (typeof showTab !== 'undefined' || document.readyState === 'complete') {
                clearInterval(check);
                resolve();
            }
            
            if (attempts >= maxAttempts) {
                console.warn('[Bridge] App layer timeout - continuing anyway');
                clearInterval(check);
                resolve();
            }
        }, 50);
    });
}

window.DataBridge = {
    isReady() {
        return bridgeReady && BridgeState.dataLayerReady;
    },
    
    getStatus() {
        return {
            ready: bridgeReady,
            ...BridgeState
        };
    },
    
    async ensureReady() {
        if (this.isReady()) return true;
        
        return new Promise((resolve) => {
            const check = setInterval(() => {
                if (bridgeReady) {
                    clearInterval(check);
                    resolve(true);
                }
            }, 50);
            
            setTimeout(() => {
                clearInterval(check);
                resolve(false);
            }, 10000);
        });
    },
    
    async getLocal(key) {
        await this.ensureReady();
        try {
            if (typeof idb !== 'undefined' && idb.get) {
                return await idb.get(key);
            }
        } catch (error) {
            console.error(`[Bridge] Error getting ${key}:`, error);
        }
        return null;
    },
    
    async setLocal(key, value) {
        await this.ensureReady();
        try {
            if (typeof idb !== 'undefined' && idb.set) {
                await idb.set(key, value);
                return true;
            }
        } catch (error) {
            console.error(`[Bridge] Error setting ${key}:`, error);
        }
        return false;
    },
    
    async removeLocal(key) {
        await this.ensureReady();
        try {
            if (typeof idb !== 'undefined' && idb.remove) {
                await idb.remove(key);
                return true;
            }
        } catch (error) {
            console.error(`[Bridge] Error removing ${key}:`, error);
        }
        return false;
    }
};

initializeBridge().catch((error) => {
    console.error('[Bridge] ❌ Initialization failed:', error);
});

console.log('[Bridge] 📦 Module loaded');
