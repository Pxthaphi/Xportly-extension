/**
 * Popup Script
 * - Handles UI interactions
 * - Communicates with background service worker
 */

// DOM Elements
const elements = {
  status: document.getElementById('status'),
  statusText: document.querySelector('.status-text'),
  statusIcon: document.querySelector('.status-icon'),
  imageInfo: document.getElementById('image-info'),
  originalSize: document.getElementById('original-size'),
  dimensions: document.getElementById('dimensions'),
  optionsSection: document.getElementById('options-section'),
  format: document.getElementById('format'),
  maxSize: document.getElementById('max-size'),
  resizeWidth: document.getElementById('resize-width'),
  actions: document.getElementById('actions'),
  btnProcess: document.getElementById('btn-process'),
  btnOriginal: document.getElementById('btn-original'),
  processing: document.getElementById('processing'),
  result: document.getElementById('result'),
  finalSize: document.getElementById('final-size'),
  savedPercent: document.getElementById('saved-percent'),
  finalQuality: document.getElementById('final-quality'),
  btnDownload: document.getElementById('btn-download'),
  error: document.getElementById('error'),
  errorMessage: document.getElementById('error-message'),
  btnRetry: document.getElementById('btn-retry'),
  btnFallback: document.getElementById('btn-fallback'),
  warning: document.getElementById('warning'),
  warningMessage: document.getElementById('warning-message'),
  btnClear: document.getElementById('btn-clear')
};

// State
let capturedImage = null;
let processedImage = null;

/**
 * Initialize popup
 */
async function init() {
  // Check for captured image
  const response = await chrome.runtime.sendMessage({ type: 'GET_CAPTURED_IMAGE' });
  
  if (response.success && response.data) {
    capturedImage = response.data;
    showImageReady();
  } else {
    showWaiting();
  }

  // Set up event listeners
  setupEventListeners();
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  elements.btnProcess.addEventListener('click', handleProcess);
  elements.btnOriginal.addEventListener('click', handleDownloadOriginal);
  elements.btnDownload.addEventListener('click', handleDownloadProcessed);
  elements.btnRetry.addEventListener('click', handleProcess);
  elements.btnFallback.addEventListener('click', handleDownloadOriginal);
  elements.btnClear.addEventListener('click', handleClear);

  // Listen for new image captures
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'IMAGE_READY') {
      capturedImage = message.data;
      showImageReady();
    }
  });
}

/**
 * Show waiting state
 */
function showWaiting() {
  elements.status.className = 'status waiting';
  elements.statusIcon.textContent = '⏳';
  elements.statusText.textContent = 'Waiting for export...';
  
  hideAll();
  elements.status.parentElement.classList.remove('hidden');
}

/**
 * Show image ready state
 */
function showImageReady() {
  elements.status.className = 'status ready';
  elements.statusIcon.textContent = '✅';
  elements.statusText.textContent = 'Image captured!';
  
  // Show image info
  elements.originalSize.textContent = formatSize(capturedImage.originalSize);
  elements.dimensions.textContent = `${capturedImage.width} × ${capturedImage.height}`;
  
  // Update resize placeholder
  elements.resizeWidth.placeholder = `${capturedImage.width} (original)`;
  
  // Show sections
  elements.imageInfo.classList.remove('hidden');
  elements.optionsSection.classList.remove('hidden');
  elements.actions.classList.remove('hidden');
  
  // Hide other states
  elements.processing.classList.add('hidden');
  elements.result.classList.add('hidden');
  elements.error.classList.add('hidden');
  elements.warning.classList.add('hidden');
}

/**
 * Show processing state
 */
function showProcessing() {
  elements.actions.classList.add('hidden');
  elements.processing.classList.remove('hidden');
  elements.result.classList.add('hidden');
  elements.error.classList.add('hidden');
  elements.warning.classList.add('hidden');
  
  elements.status.className = 'status processing';
  elements.statusIcon.textContent = '⚙️';
  elements.statusText.textContent = 'Processing...';
}

/**
 * Show result state
 */
function showResult(data) {
  elements.processing.classList.add('hidden');
  elements.result.classList.remove('hidden');
  
  elements.finalSize.textContent = formatSize(data.finalSize);
  
  const savedBytes = capturedImage.originalSize - data.finalSize;
  const savedPct = Math.round((savedBytes / capturedImage.originalSize) * 100);
  elements.savedPercent.textContent = savedPct > 0 ? `${savedPct}%` : '0%';
  
  elements.finalQuality.textContent = data.finalQuality ? `${Math.round(data.finalQuality * 100)}%` : 'N/A';
  
  // Show warning if target not reached
  if (!data.reachedTarget && elements.maxSize.value) {
    elements.warning.classList.remove('hidden');
    elements.warningMessage.textContent = 
      `Smallest achievable: ${formatSize(data.finalSize)} (target: ${elements.maxSize.value} KB)`;
  }
  
  elements.status.className = 'status ready';
  elements.statusIcon.textContent = '✅';
  elements.statusText.textContent = 'Ready to download!';
}

/**
 * Show error state
 */
function showError(message) {
  elements.processing.classList.add('hidden');
  elements.error.classList.remove('hidden');
  elements.errorMessage.textContent = message;
  
  elements.status.className = 'status waiting';
  elements.statusIcon.textContent = '❌';
  elements.statusText.textContent = 'Error occurred';
}

/**
 * Hide all dynamic sections
 */
function hideAll() {
  elements.imageInfo.classList.add('hidden');
  elements.optionsSection.classList.add('hidden');
  elements.actions.classList.add('hidden');
  elements.processing.classList.add('hidden');
  elements.result.classList.add('hidden');
  elements.error.classList.add('hidden');
  elements.warning.classList.add('hidden');
}

/**
 * Handle process button click
 */
async function handleProcess() {
  if (!capturedImage) return;
  
  showProcessing();
  
  try {
    const options = {
      format: elements.format.value,
      maxSizeKB: elements.maxSize.value ? parseInt(elements.maxSize.value) : null,
      resizeWidth: elements.resizeWidth.value ? parseInt(elements.resizeWidth.value) : null
    };
    
    const response = await chrome.runtime.sendMessage({
      type: 'PROCESS_IMAGE',
      options
    });
    
    if (response.success) {
      processedImage = response;
      showResult(response);
    } else {
      showError(response.error || 'Processing failed');
    }
  } catch (error) {
    showError(error.message);
  }
}

/**
 * Handle download original button
 */
async function handleDownloadOriginal() {
  if (!capturedImage) return;
  
  try {
    await chrome.runtime.sendMessage({
      type: 'DOWNLOAD_IMAGE',
      base64: capturedImage.base64,
      filename: capturedImage.filename || 'canva-export',
      mimeType: capturedImage.mimeType
    });
  } catch (error) {
    showError('Download failed: ' + error.message);
  }
}

/**
 * Handle download processed button
 */
async function handleDownloadProcessed() {
  if (!processedImage) return;
  
  try {
    await chrome.runtime.sendMessage({
      type: 'DOWNLOAD_IMAGE',
      base64: processedImage.base64,
      filename: (capturedImage.filename || 'canva-export') + '-optimized',
      mimeType: processedImage.mimeType
    });
  } catch (error) {
    showError('Download failed: ' + error.message);
  }
}

/**
 * Handle clear button
 */
async function handleClear() {
  await chrome.runtime.sendMessage({ type: 'CLEAR_CAPTURED' });
  capturedImage = null;
  processedImage = null;
  showWaiting();
}

/**
 * Format file size for display
 */
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
