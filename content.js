/**
 * Content Script - runs on canva.com
 * Shows overlay UI for image processing (supports multiple images)
 */

console.log('[SCE] Content script starting...');

const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');
(document.head || document.documentElement).appendChild(script);
script.onload = () => script.remove();

let capturedImages = [];
let selectedImageIndex = 0;

// Reset on page load
chrome.runtime.sendMessage({ type: 'CLEAR_CAPTURED' }).catch(() => {});

window.addEventListener('message', async (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== 'CANVA_EXPORT_CAPTURED') return;
  if (event.data?.source !== 'smart-canva-exporter') return;
  
  console.log('[SCE] Got image from page script');
  const imageData = { id: Date.now(), ...event.data.data };
  capturedImages = [imageData];
  
  try {
    await chrome.runtime.sendMessage({ type: 'IMAGE_CAPTURED', ...imageData });
    if (event.data.showOverlay) showOverlay();
  } catch (e) {
    console.error('[SCE] Error:', e);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SHOW_OVERLAY') {
    if (message.images && message.images.length > 0) {
      capturedImages = message.images;
      loadImageDimensions().then(() => showOverlay());
    } else if (message.data) {
      capturedImages = [message.data];
      loadImageDimensions().then(() => showOverlay());
    }
  }
  sendResponse({ ok: true });
  return true;
});

async function loadImageDimensions() {
  for (let img of capturedImages) {
    if (!img.width || !img.height) {
      const dims = await getImageDimensions(img.base64);
      img.width = dims.width;
      img.height = dims.height;
    }
  }
}

function getImageDimensions(base64) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = base64;
  });
}

function showOverlay() {
  const existing = document.querySelector('#sce-overlay');
  if (existing) existing.remove();
  
  selectedImageIndex = 0;
  
  const overlay = document.createElement('div');
  overlay.id = 'sce-overlay';
  overlay.innerHTML = getOverlayHTML();
  document.body.appendChild(overlay);
  
  const savedTheme = localStorage.getItem('sce-theme') || 'light';
  if (savedTheme === 'light') overlay.classList.add('light');
  
  setupEventListeners();
  updateSelectedImage();
}

function setupEventListeners() {
  document.getElementById('sce-close').addEventListener('click', closeOverlay);
  document.getElementById('sce-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'sce-overlay') closeOverlay();
  });
  
  document.getElementById('sce-btn-optimize').addEventListener('click', handleOptimize);
  document.getElementById('sce-btn-original').addEventListener('click', handleDownloadOriginal);
  
  document.getElementById('sce-format').addEventListener('change', (e) => {
    const hasMultiple = capturedImages.length > 1;
    const format = e.target.value.toUpperCase();
    document.getElementById('sce-btn-optimize').innerHTML = `${icons.bolt} Download ${format}${hasMultiple ? ` (${capturedImages.length})` : ''}`;
  });
  
  document.getElementById('sce-theme-toggle').addEventListener('click', toggleTheme);
  document.addEventListener('keydown', handleEsc);
  
  // Image list click handlers
  document.querySelectorAll('.sce-thumb').forEach((thumb, index) => {
    thumb.addEventListener('click', () => selectImage(index));
  });
}

const icons = {
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>',
  error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M3 9h18"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>'
};

function toggleTheme() {
  const overlay = document.getElementById('sce-overlay');
  const btn = document.getElementById('sce-theme-toggle');
  const isLight = overlay.classList.toggle('light');
  btn.innerHTML = isLight ? icons.moon : icons.sun;
  localStorage.setItem('sce-theme', isLight ? 'light' : 'dark');
}

function selectImage(index) {
  selectedImageIndex = index;
  updateSelectedImage();
}

function updateSelectedImage() {
  const img = capturedImages[selectedImageIndex];
  if (!img) return;
  
  document.getElementById('sce-preview-img').src = img.base64;
  document.getElementById('sce-img-dimensions').textContent = `${img.width} × ${img.height}`;
  document.getElementById('sce-img-size').textContent = formatSize(img.originalSize);
  document.getElementById('sce-img-format').textContent = getExtFromMime(img.mimeType).toUpperCase();
  document.getElementById('sce-resize').placeholder = `${img.width} (original)`;
  
  // Update button text
  const ext = getExtFromMime(img.mimeType).toUpperCase();
  const hasMultiple = capturedImages.length > 1;
  document.getElementById('sce-btn-original').innerHTML = `${icons.download} Download Original ${ext}${hasMultiple ? ` (${capturedImages.length})` : ''}`;
  
  // Update thumbnail selection
  document.querySelectorAll('.sce-thumb').forEach((thumb, i) => {
    thumb.classList.toggle('selected', i === selectedImageIndex);
  });
}

function handleEsc(e) {
  if (e.key === 'Escape') closeOverlay();
}

function closeOverlay() {
  const overlay = document.getElementById('sce-overlay');
  if (overlay) overlay.remove();
  document.removeEventListener('keydown', handleEsc);
}

async function handleOptimize() {
  const hasMultiple = capturedImages.length > 1;
  
  if (hasMultiple) {
    // Download all as ZIP
    await handleDownloadAllAsZip();
    return;
  }
  
  // Single image
  const img = capturedImages[selectedImageIndex];
  if (!img) return;
  
  const spinner = document.getElementById('sce-spinner');
  const result = document.getElementById('sce-result');
  const btnOptimize = document.getElementById('sce-btn-optimize');
  
  spinner.classList.add('show');
  result.classList.remove('show');
  btnOptimize.disabled = true;
  
  const options = {
    format: document.getElementById('sce-format').value,
    maxSizeKB: document.getElementById('sce-max-size').value ? parseInt(document.getElementById('sce-max-size').value) : null,
    resizeWidth: document.getElementById('sce-resize').value ? parseInt(document.getElementById('sce-resize').value) : null
  };
  
  try {
    const response = await chrome.runtime.sendMessage({ type: 'PROCESS_IMAGE', options, imageId: img.id });
    
    spinner.classList.remove('show');
    btnOptimize.disabled = false;
    
    if (response.success) {
      result.classList.remove('error');
      result.classList.add('show');
      document.getElementById('sce-result-text').innerHTML = `${icons.check} Complete`;
      document.getElementById('sce-final-size').textContent = formatSize(response.finalSize);
      
      const savedPct = Math.round((1 - response.finalSize / img.originalSize) * 100);
      document.getElementById('sce-saved').textContent = savedPct > 0 ? `${savedPct}%` : '0%';
      
      await chrome.runtime.sendMessage({
        type: 'DOWNLOAD_IMAGE',
        base64: response.base64,
        filename: (img.filename || 'canva-export') + '-optimized',
        mimeType: response.mimeType
      });
      
      await chrome.runtime.sendMessage({ type: 'CLEAR_CAPTURED' });
      capturedImages = [];
      setTimeout(closeOverlay, 1500);
    } else {
      result.classList.add('error', 'show');
      document.getElementById('sce-result-text').innerHTML = `${icons.error} ${response.error || 'Processing failed'}`;
    }
  } catch (error) {
    spinner.classList.remove('show');
    btnOptimize.disabled = false;
    result.classList.add('error', 'show');
    document.getElementById('sce-result-text').innerHTML = `${icons.error} ${error.message}`;
  }
}

async function handleDownloadOriginal() {
  const hasMultiple = capturedImages.length > 1;
  
  if (hasMultiple) {
    // Download all originals as ZIP
    await handleDownloadAllOriginalAsZip();
    return;
  }
  
  // Single image
  const img = capturedImages[selectedImageIndex];
  if (!img) return;
  
  try {
    await chrome.runtime.sendMessage({
      type: 'DOWNLOAD_IMAGE',
      base64: img.base64,
      filename: img.filename || 'canva-export',
      mimeType: img.mimeType
    });
    
    await chrome.runtime.sendMessage({ type: 'CLEAR_CAPTURED' });
    capturedImages = [];
    closeOverlay();
  } catch (error) {
    console.error('[SCE] Download error:', error);
  }
}

async function handleDownloadAllAsZip() {
  const options = {
    format: document.getElementById('sce-format').value,
    maxSizeKB: document.getElementById('sce-max-size').value ? parseInt(document.getElementById('sce-max-size').value) : null,
    resizeWidth: document.getElementById('sce-resize').value ? parseInt(document.getElementById('sce-resize').value) : null
  };
  
  const spinner = document.getElementById('sce-spinner');
  const btnOptimize = document.getElementById('sce-btn-optimize');
  
  spinner.classList.add('show');
  btnOptimize.disabled = true;
  
  const processedImages = [];
  
  for (let i = 0; i < capturedImages.length; i++) {
    const img = capturedImages[i];
    try {
      const response = await chrome.runtime.sendMessage({ type: 'PROCESS_IMAGE', options, imageId: img.id });
      
      if (response.success) {
        processedImages.push({
          base64: response.base64,
          filename: (img.filename || `canva-export-${i + 1}`) + '-optimized',
          mimeType: response.mimeType,
          format: options.format
        });
      }
    } catch (e) {
      console.error('[SCE] Error processing image:', e);
    }
  }
  
  if (processedImages.length > 0) {
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'CREATE_ZIP',
        images: processedImages
      });
      
      if (result.success) {
        await chrome.runtime.sendMessage({
          type: 'DOWNLOAD_IMAGE',
          base64: result.base64,
          filename: 'xportly-export',
          mimeType: 'application/zip'
        });
      }
    } catch (e) {
      console.error('[SCE] Error creating ZIP:', e);
    }
  }
  
  spinner.classList.remove('show');
  
  await chrome.runtime.sendMessage({ type: 'CLEAR_CAPTURED' });
  capturedImages = [];
  closeOverlay();
}

async function handleDownloadAllOriginalAsZip() {
  const spinner = document.getElementById('sce-spinner');
  const btnOriginal = document.getElementById('sce-btn-original');
  
  spinner.classList.add('show');
  btnOriginal.disabled = true;
  
  const images = capturedImages.map((img, i) => ({
    base64: img.base64,
    filename: img.filename || `canva-export-${i + 1}`,
    mimeType: img.mimeType
  }));
  
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'CREATE_ZIP',
      images: images
    });
    
    if (result.success) {
      await chrome.runtime.sendMessage({
        type: 'DOWNLOAD_IMAGE',
        base64: result.base64,
        filename: 'xportly-original',
        mimeType: 'application/zip'
      });
    }
  } catch (e) {
    console.error('[SCE] Error creating ZIP:', e);
  }
  
  spinner.classList.remove('show');
  
  await chrome.runtime.sendMessage({ type: 'CLEAR_CAPTURED' });
  capturedImages = [];
  closeOverlay();
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function getExtFromMime(mimeType) {
  const map = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  return map[mimeType] || 'png';
}

console.log('[SCE] Content script ready');

function getOverlayHTML() {
  const savedTheme = localStorage.getItem('sce-theme') || 'light';
  const img = capturedImages[selectedImageIndex] || capturedImages[0];
  const hasMultiple = capturedImages.length > 1;
  const originalExt = img ? getExtFromMime(img.mimeType).toUpperCase() : 'PNG';
  
  const thumbsHTML = hasMultiple ? capturedImages.map((image, i) => `
    <div class="sce-thumb ${i === selectedImageIndex ? 'selected' : ''}" data-index="${i}">
      <img src="${image.base64}" alt="Thumb ${i + 1}">
      <span class="sce-thumb-num">${i + 1}</span>
    </div>
  `).join('') : '';
  
  return `
    <div id="sce-modal" class="${hasMultiple ? 'multi' : ''}">
      <div id="sce-header">
        <div>
          <h2>Xportly</h2>
          <div id="sce-subtitle">${hasMultiple ? `${capturedImages.length} images captured` : 'Optimize your image before downloading'}</div>
        </div>
        <div id="sce-header-actions">
          <button class="sce-icon-btn" id="sce-theme-toggle" title="Toggle theme">${savedTheme === 'dark' ? icons.sun : icons.moon}</button>
          <button class="sce-icon-btn" id="sce-close" title="Close">${icons.close}</button>
        </div>
      </div>
      
      <div id="sce-body">
        <div id="sce-thumbs" class="${hasMultiple ? 'show' : ''}">${thumbsHTML}</div>
        
        <div id="sce-left">
          <div id="sce-preview-container">
            <img id="sce-preview-img" src="${img?.base64 || ''}" alt="Preview">
          </div>
          <div id="sce-info">
            <div class="sce-info-item">${icons.grid} <span id="sce-img-dimensions">${img?.width || 0} × ${img?.height || 0}</span></div>
            <div class="sce-info-item">${icons.file} <span id="sce-img-size">${img ? formatSize(img.originalSize) : '-'}</span></div>
            <div class="sce-info-item">${icons.image} <span id="sce-img-format">${originalExt}</span></div>
          </div>
        </div>
        
        <div id="sce-right">
          <div id="sce-options">
            <div class="sce-option">
              <label>Output Format</label>
              <select id="sce-format">
                <option value="webp">WebP (recommended)</option>
                <option value="jpg">JPEG</option>
                <option value="png">PNG</option>
              </select>
            </div>
            
            <div class="sce-option">
              <label>Max File Size (KB)</label>
              <input type="number" id="sce-max-size" placeholder="No limit" min="10">
              <div class="hint">Auto-compress to target size</div>
            </div>
            
            <div class="sce-option">
              <label>Resize Width (px)</label>
              <input type="number" id="sce-resize" placeholder="${img?.width || 0} (original)" min="100">
              <div class="hint">Height scales proportionally</div>
            </div>
          </div>
          
          <div id="sce-spinner">
            <div class="spinner"></div>
            <div>Processing...</div>
          </div>
          
          <div id="sce-result">
            <div id="sce-result-text">${icons.check} Complete</div>
            <div id="sce-result-stats">
              <div class="sce-stat">
                <div class="sce-stat-value" id="sce-final-size">-</div>
                <div class="sce-stat-label">Size</div>
              </div>
              <div class="sce-stat">
                <div class="sce-stat-value" id="sce-saved">-</div>
                <div class="sce-stat-label">Saved</div>
              </div>
            </div>
          </div>
          
          <div id="sce-actions">
            <button class="sce-btn sce-btn-primary" id="sce-btn-optimize">${icons.bolt} ${hasMultiple ? `Download WEBP (${capturedImages.length})` : 'Download WEBP'}</button>
            <button class="sce-btn sce-btn-secondary" id="sce-btn-original">${icons.download} Download Original ${originalExt}${hasMultiple ? ` (${capturedImages.length})` : ''}</button>
          </div>
        </div>
      </div>
    </div>
  `;
}
