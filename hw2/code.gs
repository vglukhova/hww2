// app.js - Review Sentiment Analyzer with Automatic Google Sheets Logging
import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js";

// Configuration
const GOOGLE_SCRIPT_URL = 'YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL'; // Replace with your Google Script URL
const MODEL_NAME = 'Xenova/distilbert-base-uncased-finetuned-sst-2-english';
const TSV_FILE = 'reviews_test.tsv';

// State management
let reviews = [];
let sentimentPipeline = null;
let currentAnalysis = null;
let modelLoaded = false;
let reviewsLoaded = false;
let autoLoggingEnabled = true; // Enable automatic logging by default
let isProcessing = false;
let analysisQueue = [];

// DOM Elements
const reviewBox = document.getElementById('reviewBox');
const resultBox = document.getElementById('resultBox');
const analyzeBtn = document.getElementById('analyzeBtn');
const logBtn = document.getElementById('logBtn');
const modelStatus = document.getElementById('modelStatus');
const reviewsStatus = document.getElementById('reviewsStatus');
const errorBox = document.getElementById('errorBox');
const errorMessage = document.getElementById('errorMessage');

// Initialize application
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Load reviews and model in parallel
        await Promise.all([
            loadReviews(),
            loadModel()
        ]);
        
        analyzeBtn.disabled = false;
        analyzeBtn.addEventListener('click', () => analyzeRandomReview(true)); // true = user-initiated
        logBtn.addEventListener('click', logToGoogleSheets);
        
        // Update UI to show automatic logging status
        updateLogButtonStatus();
        
        // Start automatic analysis if there are reviews
        if (reviews.length > 0) {
            // Start with one analysis immediately
            setTimeout(() => analyzeRandomReview(false), 1000);
            
            // Set up periodic analysis every 30 seconds
            setInterval(() => {
                if (!isProcessing && reviews.length > 0) {
                    analyzeRandomReview(false);
                }
            }, 30000);
        }
        
    } catch (error) {
        showError(`Failed to initialize application: ${error.message}`);
    }
});

/**
 * Load reviews from TSV file using Papa Parse
 */
async function loadReviews() {
    try {
        const response = await fetch(TSV_FILE);
        if (!response.ok) {
            throw new Error(`Failed to load TSV file: ${response.status} ${response.statusText}`);
        }
        
        const tsvContent = await response.text();
        
        // Parse TSV using Papa Parse
        const result = Papa.parse(tsvContent, {
            header: true,
            delimiter: "\t",
            skipEmptyLines: true
        });
        
        if (result.errors.length > 0) {
            console.warn('Parsing warnings:', result.errors);
        }
        
        // Extract review texts from 'text' column
        reviews = result.data
            .map(row => row.text)
            .filter(text => text && typeof text === 'string' && text.trim().length > 0);
        
        if (reviews.length === 0) {
            throw new Error('No valid reviews found in TSV file');
        }
        
        // Update status
        reviewsStatus.classList.remove('loading');
        reviewsStatus.classList.add('success');
        reviewsStatus.querySelector('.status-icon').innerHTML = '<i class="fas fa-check"></i>';
        reviewsStatus.querySelector('p').textContent = `Loaded ${reviews.length} reviews`;
        reviewsLoaded = true;
        
        console.log(`Successfully loaded ${reviews.length} reviews`);
        
    } catch (error) {
        reviewsStatus.classList.remove('loading');
        reviewsStatus.classList.add('error');
        reviewsStatus.querySelector('.status-icon').innerHTML = '<i class="fas fa-times"></i>';
        reviewsStatus.querySelector('p').textContent = 'Failed to load reviews';
        throw error;
    }
}

/**
 * Load sentiment analysis model using Transformers.js
 */
async function loadModel() {
    try {
        console.log('Loading sentiment analysis model...');
        
        sentimentPipeline = await pipeline('text-classification', MODEL_NAME, {
            progress_callback: (progress) => {
                if (progress.status === 'downloading') {
                    modelStatus.querySelector('p').textContent = 
                        `Downloading model: ${Math.round(progress.progress * 100)}%`;
                }
            }
        });
        
        // Update status
        modelStatus.classList.remove('loading');
        modelStatus.classList.add('success');
        modelStatus.querySelector('.status-icon').innerHTML = '<i class="fas fa-check"></i>';
        modelStatus.querySelector('p').textContent = 'Model loaded and ready';
        modelLoaded = true;
        
        console.log('Sentiment analysis model loaded successfully');
        
    } catch (error) {
        modelStatus.classList.remove('loading');
        modelStatus.classList.add('error');
        modelStatus.querySelector('.status-icon').innerHTML = '<i class="fas fa-times"></i>';
        modelStatus.querySelector('p').textContent = 'Failed to load model';
        throw new Error(`Model loading failed: ${error.message}`);
    }
}

/**
 * Select a random review from the loaded reviews
 */
function getRandomReview() {
    if (reviews.length === 0) {
        throw new Error('No reviews available');
    }
    
    const randomIndex = Math.floor(Math.random() * reviews.length);
    return reviews[randomIndex];
}

/**
 * Analyze the sentiment of a given text using Transformers.js
 */
async function analyzeSentiment(text) {
    if (!sentimentPipeline) {
        throw new Error('Sentiment model not loaded');
    }
    
    if (!text || text.trim().length === 0) {
        throw new Error('Review text is empty');
    }
    
    // Run sentiment analysis
    const results = await sentimentPipeline(text);
    
    if (!Array.isArray(results) || results.length === 0) {
        throw new Error('Invalid analysis results');
    }
    
    // Get the primary result (highest score)
    const primaryResult = results[0];
    
    // Determine sentiment category
    const label = primaryResult.label.toUpperCase();
    const score = primaryResult.score;
    
    let sentiment;
    if (label.includes('POSITIVE') && score > 0.5) {
        sentiment = 'positive';
    } else if (label.includes('NEGATIVE') && score > 0.5) {
        sentiment = 'negative';
    } else {
        sentiment = 'neutral';
    }
    
    return {
        label,
        score,
        sentiment,
        confidence: (score * 100).toFixed(1)
    };
}

/**
 * Update UI with analysis results
 */
function updateUI(review, analysis, userInitiated = true) {
    // Only update UI if user initiated the analysis
    if (userInitiated) {
        // Update review display
        reviewBox.textContent = review;
        reviewBox.classList.add('pulse');
        
        // Update result display
        resultBox.className = `result-box ${analysis.sentiment}`;
        
        const sentimentIcon = resultBox.querySelector('.sentiment-icon i');
        const sentimentLabel = resultBox.querySelector('.sentiment-label');
        const confidenceEl = resultBox.querySelector('.confidence');
        
        // Set icon based on sentiment
        switch (analysis.sentiment) {
            case 'positive':
                sentimentIcon.className = 'fas fa-thumbs-up';
                break;
            case 'negative':
                sentimentIcon.className = 'fas fa-thumbs-down';
                break;
            default:
                sentimentIcon.className = 'fas fa-question-circle';
        }
        
        sentimentLabel.textContent = analysis.label;
        confidenceEl.textContent = `${analysis.confidence}% confidence`;
        
        // Remove pulse animation after a delay
        setTimeout(() => {
            reviewBox.classList.remove('pulse');
        }, 1000);
    }
    
    // Always store current analysis for logging
    currentAnalysis = {
        review,
        ...analysis,
        timestamp: new Date().toISOString(),
        userInitiated: userInitiated
    };
    
    // Log automatically if enabled and not a duplicate
    if (autoLoggingEnabled && !isDuplicateAnalysis(currentAnalysis)) {
        logToGoogleSheetsAutomatically();
    }
    
    // Add to analysis queue for tracking
    analysisQueue.push({
        timestamp: currentAnalysis.timestamp,
        review: currentAnalysis.review.substring(0, 50) + '...',
        sentiment: currentAnalysis.label,
        confidence: currentAnalysis.confidence
    });
    
    // Keep only last 10 analyses in queue
    if (analysisQueue.length > 10) {
        analysisQueue.shift();
    }
}

/**
 * Check if analysis is a duplicate of recent ones
 */
function isDuplicateAnalysis(newAnalysis) {
    // Check if same review was analyzed in last 5 minutes
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    
    return analysisQueue.some(item => {
        return item.review.includes(newAnalysis.review.substring(0, 50)) &&
               new Date(item.timestamp).getTime() > fiveMinutesAgo;
    });
}

/**
 * Handle random review analysis
 */
async function analyzeRandomReview(userInitiated = true) {
    if (!modelLoaded || !reviewsLoaded) {
        showError('Model or reviews not loaded yet');
        return;
    }
    
    if (isProcessing) {
        console.log('Already processing, skipping...');
        return;
    }
    
    try {
        // Reset error display
        hideError();
        
        // Set processing flag
        isProcessing = true;
        
        // Update UI only for user-initiated analyses
        if (userInitiated) {
            analyzeBtn.disabled = true;
            analyzeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analyzing...';
        }
        
        // Get random review
        const review = getRandomReview();
        
        // Show review in UI if user initiated
        if (userInitiated) {
            reviewBox.textContent = review;
        }
        
        // Analyze sentiment
        const analysis = await analyzeSentiment(review);
        
        // Update UI and store analysis
        updateUI(review, analysis, userInitiated);
        
        // Show success indicator for automatic analyses
        if (!userInitiated) {
            showAutoAnalysisIndicator();
        }
        
    } catch (error) {
        console.error('Analysis failed:', error);
        if (userInitiated) {
            showError(`Analysis failed: ${error.message}`);
        }
    } finally {
        // Restore button state for user-initiated analyses
        if (userInitiated) {
            analyzeBtn.disabled = false;
            analyzeBtn.innerHTML = '<i class="fas fa-random"></i> Analyze Random Review';
        }
        
        // Clear processing flag
        isProcessing = false;
    }
}

/**
 * Show indicator for automatic analysis
 */
function showAutoAnalysisIndicator() {
    const statusBox = document.querySelector('.status-box');
    
    // Create or update auto-analysis indicator
    let autoStatus = document.getElementById('autoStatus');
    if (!autoStatus) {
        autoStatus = document.createElement('div');
        autoStatus.id = 'autoStatus';
        autoStatus.className = 'status-item success';
        autoStatus.innerHTML = `
            <div class="status-icon">
                <i class="fas fa-robot"></i>
            </div>
            <div class="status-text">
                <h4>Auto Analysis</h4>
                <p>Last auto-analysis: <span id="lastAutoTime">Just now</span></p>
            </div>
        `;
        statusBox.appendChild(autoStatus);
    }
    
    // Update time
    const lastAutoTime = document.getElementById('lastAutoTime');
    if (lastAutoTime) {
        lastAutoTime.textContent = new Date().toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    }
    
    // Add pulse animation
    autoStatus.classList.add('pulse');
    setTimeout(() => {
        autoStatus.classList.remove('pulse');
    }, 1000);
}

/**
 * Update log button status
 */
function updateLogButtonStatus() {
    if (autoLoggingEnabled) {
        logBtn.innerHTML = '<i class="fas fa-robot"></i> Auto-Logging: ON';
        logBtn.style.background = 'var(--positive)';
        logBtn.style.color = 'white';
        logBtn.title = 'Click to disable automatic logging';
    } else {
        logBtn.innerHTML = '<i class="fas fa-robot"></i> Auto-Logging: OFF';
        logBtn.style.background = 'var(--neutral)';
        logBtn.style.color = 'white';
        logBtn.title = 'Click to enable automatic logging';
    }
}

/**
 * Toggle automatic logging
 */
function toggleAutoLogging() {
    autoLoggingEnabled = !autoLoggingEnabled;
    updateLogButtonStatus();
    
    // Show notification
    const message = autoLoggingEnabled ? 
        'Automatic logging enabled' : 
        'Automatic logging disabled';
    
    showNotification(message);
}

/**
 * Show temporary notification
 */
function showNotification(message) {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: var(--primary);
        color: white;
        padding: 15px 25px;
        border-radius: 10px;
        box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        z-index: 1000;
        animation: slideIn 0.3s ease, fadeOut 0.3s ease 2.7s forwards;
    `;
    
    notification.innerHTML = `<i class="fas fa-info-circle"></i> ${message}`;
    document.body.appendChild(notification);
    
    // Remove after 3 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 3000);
}

/**
 * Collect metadata from client
 */
function collectMetadata() {
    return {
        userAgent: navigator.userAgent,
        language: navigator.language,
        platform: navigator.platform,
        screenResolution: `${window.screen.width}x${window.screen.height}`,
        model: MODEL_NAME,
        timestamp: new Date().toISOString(),
        reviewCount: reviews.length,
        analysisTime: new Date().toISOString(),
        autoLogged: true,
        totalAnalyses: analysisQueue.length,
        userInitiated: currentAnalysis?.userInitiated || false
    };
}

/**
 * Log analysis results to Google Sheets automatically
 */
async function logToGoogleSheetsAutomatically() {
    if (!currentAnalysis) {
        console.warn('No analysis to log');
        return;
    }
    
    if (!GOOGLE_SCRIPT_URL || GOOGLE_SCRIPT_URL === 'YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL') {
        console.warn('Google Sheets integration not configured');
        return;
    }
    
    if (!autoLoggingEnabled) {
        console.log('Auto-logging disabled, skipping...');
        return;
    }
    
    try {
        // Prepare data for Google Sheets
        const payload = {
            ts_iso: currentAnalysis.timestamp,
            review: currentAnalysis.review,
            sentiment: `${currentAnalysis.label} (${currentAnalysis.confidence}%)`,
            meta: JSON.stringify({
                ...collectMetadata(),
                analysis: {
                    label: currentAnalysis.label,
                    score: currentAnalysis.score,
                    sentiment: currentAnalysis.sentiment,
                    confidence: currentAnalysis.confidence,
                    userInitiated: currentAnalysis.userInitiated,
                    autoLogged: true
                }
            })
        };
        
        // Send to Google Apps Script
        await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        
        console.log('Data auto-logged to Google Sheets:', {
            timestamp: payload.ts_iso,
            sentiment: payload.sentiment,
            reviewLength: payload.review.length
        });
        
        // Update UI to show successful auto-log
        updateAutoLogStatus();
        
    } catch (error) {
        console.error('Failed to auto-log to Google Sheets:', error);
        // Don't show error to user for auto-logging failures
    }
}

/**
 * Update auto-log status in UI
 */
function updateAutoLogStatus() {
    const statusBox = document.querySelector('.status-box');
    
    // Create or update auto-log status
    let autoLogStatus = document.getElementById('autoLogStatus');
    if (!autoLogStatus) {
        autoLogStatus = document.createElement('div');
        autoLogStatus.id = 'autoLogStatus';
        autoLogStatus.className = 'status-item success';
        autoLogStatus.innerHTML = `
            <div class="status-icon">
                <i class="fas fa-cloud-upload-alt"></i>
            </div>
            <div class="status-text">
                <h4>Google Sheets Logging</h4>
                <p>Last auto-log: <span id="lastLogTime">Just now</span></p>
            </div>
        `;
        statusBox.appendChild(autoLogStatus);
    }
    
    // Update time
    const lastLogTime = document.getElementById('lastLogTime');
    if (lastLogTime) {
        lastLogTime.textContent = new Date().toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit',
            second: '2-digit'
        });
    }
}

/**
 * Manual logging (when user clicks the button)
 */
async function logToGoogleSheets() {
    // Toggle auto-logging when button is clicked
    toggleAutoLogging();
}

/**
 * Display error message in UI
 */
function showError(message) {
    console.error('Application error:', message);
    errorMessage.textContent = message;
    errorBox.classList.add('show');
    
    // Auto-hide error after 10 seconds
    setTimeout(hideError, 10000);
}

/**
 * Hide error message
 */
function hideError() {
    errorBox.classList.remove('show');
}

// Add CSS for notifications
const style = document.createElement('style');
style.textContent = `
    @keyframes fadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
    }
    
    .notification i {
        margin-right: 10px;
    }
`;
document.head.appendChild(style);

// Export functions for testing (optional)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getRandomReview,
        analyzeSentiment,
        collectMetadata,
        analyzeRandomReview,
        toggleAutoLogging
    };
}
