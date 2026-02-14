    let currentUser = null; // User authentication state
    let firebaseDB = null;
    let database = null;
    let auth = null;
    let isSyncing = false;
    let currentActiveTab = 'prod'; // Initialize to 'prod' since it's the default visible tab
    
    // --- GLOBAL ENFORCEMENT ---
    const USE_IDB_ONLY = true;


const BackgroundSyncQueue = {
    queue: [],
    processing: false,
    batchSize: 50,
    throttleDelay: 1000, // 1 second between batches
    retryAttempts: 3,
    
    /**
     * Add sync operation to queue
     * @param {string} operation - Type of operation (create, update, delete)
     * @param {string} collection - Firestore collection name
     * @param {object} data - Data to sync
     * @param {string} id - Optional document ID
     */
    enqueue(operation, collection, data, id = null) {
        this.queue.push({
            operation,
            collection,
            data,
            id: id || this.generateId(),
            timestamp: Date.now(),
            attempts: 0
        });
        
        // Start processing if not already running
        if (!this.processing) {
            this.processQueue();
        }
    },
    
    /**
     * Process queued sync operations in background
     */
    async processQueue() {
        if (this.processing || this.queue.length === 0) return;
        
        this.processing = true;
        
        try {
            while (this.queue.length > 0) {
                // Take a batch from queue
                const batch = this.queue.splice(0, this.batchSize);
                
                // Process batch in background
                await this.processBatch(batch);
                
                // Throttle to prevent overwhelming network
                if (this.queue.length > 0) {
                    await this.sleep(this.throttleDelay);
                }
            }
        } catch (error) {
            console.error('[BackgroundSync] Queue processing error:', error);
        } finally {
            this.processing = false;
        }
    },
    
    /**
     * Process a batch of operations
     */
    async processBatch(batch) {
        if (!firebaseDB || !currentUser) {
            // Re-queue for later
            this.queue.push(...batch);
            return;
        }
        
        const firestoreBatch = firebaseDB.batch();
        let operationCount = 0;
        
        for (const item of batch) {
            try {
                const docRef = firebaseDB
                    .collection('users')
                    .doc(currentUser.id)
                    .collection(item.collection)
                    .doc(item.id);
                
                switch (item.operation) {
                    case 'create':
                    case 'update':
                        firestoreBatch.set(docRef, {
                            ...item.data,
                            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                            syncedAt: firebase.firestore.FieldValue.serverTimestamp()
                        }, { merge: true });
                        operationCount++;
                        break;
                        
                    case 'delete':
                        firestoreBatch.delete(docRef);
                        operationCount++;
                        break;
                }
            } catch (error) {
                console.error(`[BackgroundSync] Error processing ${item.operation}:`, error);
                
                // Retry logic
                if (item.attempts < this.retryAttempts) {
                    item.attempts++;
                    this.queue.push(item);
                }
            }
        }
        
        // Commit batch to Firestore
        if (operationCount > 0) {
            try {
                await firestoreBatch.commit();
                // Track writes
                if (typeof trackFirestoreWrite === 'function') {
                    trackFirestoreWrite(operationCount);
                }
                console.log(`[BackgroundSync] ✓ Synced ${operationCount} operations`);
            } catch (error) {
                console.error('[BackgroundSync] Batch commit failed:', error);
                // Re-queue for retry
                this.queue.push(...batch.map(item => ({ ...item, attempts: item.attempts + 1 })));
            }
        }
    },
    
    /**
     * Generate unique ID for sync operation
     */
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    },
    
    /**
     * Sleep utility for throttling
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },
    
    /**
     * Get queue status
     */
    getStatus() {
        return {
            queueLength: this.queue.length,
            processing: this.processing,
            pending: this.queue.length
        };
    },
    
    /**
     * Clear queue
     */
    clear() {
        this.queue = [];
        this.processing = false;
    }
};

// Make BackgroundSyncQueue globally available
window.BackgroundSyncQueue = BackgroundSyncQueue;

// ============================================================================
// PUBLIC SYNC API (Called from app.js)
// ============================================================================

/**
 * Queue data for background sync to Firestore
 * This is the main function app.js calls after saving to IndexedDB
 */
async function queueBackgroundSync(collection, data, operation = 'update') {
    if (!currentUser || !firebaseDB) {
        console.log('[BackgroundSync] Skipping - user not logged in or Firebase not ready');
        return;
    }
    
    try {
        // Extract ID from data if present
        const docId = data.id || BackgroundSyncQueue.generateId();
        
        // Queue the operation
        BackgroundSyncQueue.enqueue(operation, collection, data, docId);
        
        console.log(`[BackgroundSync] Queued ${operation} for ${collection}`);
    } catch (error) {
        console.error('[BackgroundSync] Error queuing sync:', error);
    }
}

/**
 * Immediate sync (when user explicitly requests sync)
 * This bypasses the queue for immediate execution
 */
async function immediateSync(collection, data, operation = 'update') {
    if (!currentUser || !firebaseDB) {
        throw new Error('User not logged in or Firebase not initialized');
    }
    
    try {
        const docId = data.id || Date.now().toString();
        const docRef = firebaseDB
            .collection('users')
            .doc(currentUser.id)
            .collection(collection)
            .doc(docId);
        
        switch (operation) {
            case 'create':
            case 'update':
                await docRef.set({
                    ...data,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    syncedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                if (typeof trackFirestoreWrite === 'function') {
                    trackFirestoreWrite(1);
                }
                break;
                
            case 'delete':
                await docRef.delete();
                if (typeof trackFirestoreWrite === 'function') {
                    trackFirestoreWrite(1);
                }
                break;
        }
        
        console.log(`[ImmediateSync] ✓ ${operation} completed for ${collection}`);
        return true;
    } catch (error) {
        console.error('[ImmediateSync] Error:', error);
        throw error;
    }
}

// Expose sync functions globally
window.queueBackgroundSync = queueBackgroundSync;
window.immediateSync = immediateSync;



// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyDYjGQILtrcG2nfKACSfsVtfIPZOAgbr_s",
  authDomain: "calculator-fabd3.firebaseapp.com",
  databaseURL: "https://calculator-fabd3-default-rtdb.firebaseio.com",
  projectId: "calculator-fabd3",
  storageBucket: "calculator-fabd3.firebasestorage.app",
  messagingSenderId: "124313576124",
  appId: "1:124313576124:web:fb721bb61bc19b51db26b9"
};
// ============================================
// FIRESTORE USAGE TRACKING WITH AUTO-RESET
// ============================================

// Load stats from localStorage or initialize
function loadFirestoreStats() {
    const saved = localStorage.getItem('firestoreStats');
    if (saved) {
        try {
            firestoreStats = JSON.parse(saved);
            // Ensure lastReset exists (for backwards compatibility)
            if (!firestoreStats.lastReset) {
                firestoreStats.lastReset = Date.now();
            }
            // Check if auto-reset is needed after loading
            checkAndAutoResetFirestoreStats();
        } catch (e) {
            console.error('Error loading Firestore stats:', e);
            firestoreStats = {
                reads: 0,
                writes: 0,
                history: [],
                lastReset: Date.now()
            };
        }
    } else {
        firestoreStats = {
            reads: 0,
            writes: 0,
            history: [],
            lastReset: Date.now()
        };
    }
}

// Save stats to localStorage
function saveFirestoreStats() {
    try {
        localStorage.setItem('firestoreStats', JSON.stringify(firestoreStats));
    } catch (e) {
        console.error('Error saving Firestore stats:', e);
    }
}

let firestoreStats = {
    reads: 0,
    writes: 0,
    history: [],
    lastReset: Date.now()
};

let firestoreUsageChart = null;

// Auto-reset function - resets stats every 24 hours
function checkAndAutoResetFirestoreStats() {
    const now = Date.now();
    const hoursSinceReset = (now - firestoreStats.lastReset) / (1000 * 60 * 60);
    
    // Reset if more than 24 hours have passed
    if (hoursSinceReset >= 24) {
        // console.log('⟲ Auto-resetting Firestore stats (24 hours elapsed)');
        firestoreStats.reads = 0;
        firestoreStats.writes = 0;
        firestoreStats.history = [];
        firestoreStats.lastReset = now;
        saveFirestoreStats();
        updateFirestoreDisplay();
        
        if (firestoreUsageChart) {
            firestoreUsageChart.data.labels = [];
            firestoreUsageChart.data.datasets[0].data = [];
            firestoreUsageChart.data.datasets[1].data = [];
            firestoreUsageChart.update();
        }
    }
}

// Run auto-reset check every hour - DISABLED FOR PERFORMANCE
// setInterval(checkAndAutoResetFirestoreStats, 60 * 60 * 1000);

// Initialize chart when DOM is ready
function initFirestoreUsageChart() {
    const canvas = document.getElementById('firestoreUsageChart');
    if (!canvas) {
        console.warn('firestoreUsageChart canvas element not found');
        return;
    }
    
    // Additional check to ensure it's a canvas element
    if (!(canvas instanceof HTMLCanvasElement)) {
        console.warn('firestoreUsageChart is not a canvas element');
        return;
    }
    
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        console.warn('Could not get 2d context from canvas');
        return;
    }
    
    firestoreUsageChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Reads',
                    data: [],
                    borderColor: '#30d158',
                    backgroundColor: 'rgba(48, 209, 88, 0.1)',
                    tension: 0.4,
                    fill: true
                },
                {
                    label: 'Writes',
                    data: [],
                    borderColor: '#007aff',
                    backgroundColor: 'rgba(0, 122, 255, 0.1)',
                    tension: 0.4,
                    fill: true
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: 'var(--text-muted)',
                        font: { size: 10 }
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    }
                },
                x: {
                    ticks: {
                        color: 'var(--text-muted)',
                        font: { size: 9 }
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    }
                }
            }
        }
    });
}

// Track Firestore reads
function trackFirestoreRead(count = 1) {
    checkAndAutoResetFirestoreStats(); // Check for auto-reset
    firestoreStats.reads += count;
    saveFirestoreStats(); // Persist to localStorage
    updateFirestoreDisplay();
    // console.log(`▭ Firestore Read: +${count} (Total: ${firestoreStats.reads})`);
}

// Track Firestore writes
function trackFirestoreWrite(count = 1) {
    checkAndAutoResetFirestoreStats(); // Check for auto-reset
    firestoreStats.writes += count;
    saveFirestoreStats(); // Persist to localStorage
    updateFirestoreDisplay();
    // console.log(`✍ Firestore Write: +${count} (Total: ${firestoreStats.writes})`);
}

// Update display
function updateFirestoreDisplay() {
    const readsEl = document.getElementById('firestore-reads-count');
    const writesEl = document.getElementById('firestore-writes-count');
    
    if (readsEl) readsEl.textContent = firestoreStats.reads;
    if (writesEl) writesEl.textContent = firestoreStats.writes;
    
    // Update chart every 10 operations
    if ((firestoreStats.reads + firestoreStats.writes) % 10 === 0) {
        updateFirestoreChart();
    }
}

// Update chart
function updateFirestoreChart() {
    if (!firestoreUsageChart) return;
    
    const now = new Date();
    const timeLabel = now.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
    
    // Add data point
    firestoreUsageChart.data.labels.push(timeLabel);
    firestoreUsageChart.data.datasets[0].data.push(firestoreStats.reads);
    firestoreUsageChart.data.datasets[1].data.push(firestoreStats.writes);
    
    // Keep only last 10 points
    if (firestoreUsageChart.data.labels.length > 10) {
        firestoreUsageChart.data.labels.shift();
        firestoreUsageChart.data.datasets[0].data.shift();
        firestoreUsageChart.data.datasets[1].data.shift();
    }
    
    firestoreUsageChart.update();
}

// Reset stats (now only used internally for auto-reset)
function resetFirestoreStats() {
    firestoreStats = { reads: 0, writes: 0, history: [], lastReset: Date.now() };
    updateFirestoreDisplay();
    
    if (firestoreUsageChart) {
        firestoreUsageChart.data.labels = [];
        firestoreUsageChart.data.datasets[0].data = [];
        firestoreUsageChart.data.datasets[1].data = [];
        firestoreUsageChart.update();
    }
    
    // console.log('⟲ Firestore stats reset');
}

// Initialize chart when data menu opens
const originalOpenDataMenu = window.openDataMenu;
window.openDataMenu = function() {
    if (typeof originalOpenDataMenu === 'function') {
        originalOpenDataMenu();
    } else {
        document.getElementById('dataMenuOverlay').style.display = 'flex';
    }
    
    // Initialize chart if not already done
    setTimeout(() => {
        if (!firestoreUsageChart) {
            initFirestoreUsageChart();
        }
    }, 100);
};

// === NOTE: Global variables (currentUser, database, auth, etc.) are declared at the top of the script ===

// === ACTIVE TAB TRACKING FOR OPTIMIZED RENDERING ===