/**
 * Background Service Worker
 * - Intercepts downloads from Canva
 * - Coordinates messaging between content script, popup, and offscreen document
 */

let capturedImageData = null;
let capturedImages = []; // Support multiple images
let offscreenDocumentCreated = false;

// Listen for downloads from Canva - CANCEL and intercept
chrome.downloads.onCreated.addListener(async (downloadItem) => {
  console.log('[SCE-BG] Download detected:', downloadItem);
  
  const url = downloadItem.url || '';
  const filename = downloadItem.filename || '';
  const mime = downloadItem.mime || '';
  
  const isCanvaDownload = url.includes('canva') || 
                          url.includes('export-download') ||
                          downloadItem.referrer?.includes('canva');
  
  const isImage = mime.startsWith('image/') || 
                  /\.(png|jpg|jpeg|webp)$/i.test(filename) ||
                  /\.(png|jpg|jpeg|webp)$/i.test(url);
  
  const isZip = mime === 'application/zip' || 
                mime === 'application/x-zip-compressed' ||
                /\.zip$/i.test(filename) ||
                /\.zip$/i.test(url);
  
  if (isCanvaDownload && (isImage || isZip)) {
    console.log('[SCE-BG] Canva download - cancelling and intercepting!', isZip ? '(ZIP)' : '(Image)');
    
    // CANCEL the download immediately
    try {
      await chrome.downloads.cancel(downloadItem.id);
      console.log('[SCE-BG] Download cancelled:', downloadItem.id);
      chrome.downloads.erase({ id: downloadItem.id });
    } catch (e) {
      console.log('[SCE-BG] Could not cancel:', e.message);
    }
    
    // Fetch the file ourselves
    try {
      const response = await fetch(url);
      if (response.ok) {
        const blob = await response.blob();
        console.log('[SCE-BG] Fetched blob:', blob.size, blob.type);
        
        if (isZip || blob.type === 'application/zip') {
          // Handle ZIP file - extract images
          await handleZipFile(blob, extractFilename(filename || url));
        } else if (blob.size > 5000) {
          // Single image
          await handleSingleImage(blob, extractFilename(filename || url));
        }
      }
    } catch (e) {
      console.log('[SCE-BG] Could not fetch download URL:', e.message);
    }
  }
});

async function handleSingleImage(blob, filename) {
  const base64 = await blobToBase64(blob);
  
  const imageData = {
    id: Date.now(),
    base64,
    originalSize: blob.size,
    mimeType: blob.type || 'image/png',
    filename: filename || 'canva-export',
    width: 0,
    height: 0,
    timestamp: Date.now()
  };
  
  capturedImages = [imageData];
  capturedImageData = imageData;
  
  await chrome.storage.session.set({ capturedImages });
  console.log('[SCE-BG] Single image captured!');
  
  chrome.action.setBadgeText({ text: '1' });
  chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });
  
  notifyTabsWithImages(capturedImages);
}

async function handleZipFile(blob, zipFilename) {
  console.log('[SCE-BG] Processing ZIP file...');
  
  try {
    await ensureOffscreenDocument();
    
    // Send ZIP to offscreen for extraction
    const base64Zip = await blobToBase64(blob);
    const result = await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'EXTRACT_ZIP',
      data: { base64Zip, zipFilename }
    });
    
    if (result.success && result.images.length > 0) {
      capturedImages = result.images.map((img, index) => ({
        id: Date.now() + index,
        ...img,
        timestamp: Date.now()
      }));
      capturedImageData = capturedImages[0];
      
      await chrome.storage.session.set({ capturedImages });
      console.log('[SCE-BG] Extracted', capturedImages.length, 'images from ZIP');
      
      chrome.action.setBadgeText({ text: String(capturedImages.length) });
      chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });
      
      notifyTabsWithImages(capturedImages);
    }
  } catch (e) {
    console.error('[SCE-BG] ZIP extraction error:', e);
  }
}

async function notifyTabsWithImages(images) {
  try {
    const tabs = await chrome.tabs.query({ url: '*://*.canva.com/*' });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { 
        type: 'SHOW_OVERLAY',
        data: images.length === 1 ? images[0] : null,
        images: images
      }).catch(() => {});
    }
  } catch (e) {
    console.log('[SCE-BG] Could not notify tabs:', e);
  }
}

// Also listen for download changes to get final URL
chrome.downloads.onChanged.addListener(async (delta) => {
  if (delta.url) {
    console.log('[SCE-BG] Download URL changed:', delta.url.current);
  }
});

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function extractFilename(str) {
  const match = str.match(/([^\/\\]+)\.(png|jpg|jpeg|webp)/i);
  return match ? match[1] : 'canva-export';
}

async function notifyTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: '*://*.canva.com/*' });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: 'IMAGE_CAPTURED_BY_BG' }).catch(() => {});
    }
  } catch (e) {}
}

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(error => {
    console.error('[SCE-BG] Error:', error);
    sendResponse({ success: false, error: error.message });
  });
  return true;
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'IMAGE_CAPTURED':
      capturedImageData = {
        id: Date.now(),
        base64: message.base64,
        originalSize: message.originalSize,
        filename: message.filename || 'canva-export',
        mimeType: message.mimeType,
        width: message.width,
        height: message.height,
        timestamp: Date.now()
      };
      capturedImages = [capturedImageData];
      await chrome.storage.session.set({ capturedImages });
      console.log('[SCE-BG] Image captured from content script');
      return { success: true };

    case 'GET_CAPTURED_IMAGE':
      if (capturedImages.length === 0) {
        const stored = await chrome.storage.session.get('capturedImages');
        capturedImages = stored.capturedImages || [];
        capturedImageData = capturedImages[0] || null;
      }
      return { success: true, data: capturedImageData, images: capturedImages };

    case 'PROCESS_IMAGE':
      return await processImage(message.options, message.imageId);

    case 'DOWNLOAD_IMAGE':
      return await downloadImage(message.base64, message.filename, message.mimeType);

    case 'OPEN_POPUP':
      chrome.action.openPopup().catch(() => {
        chrome.action.setBadgeText({ text: String(capturedImages.length || 1) });
        chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });
      });
      return { success: true };

    case 'CLEAR_CAPTURED':
      capturedImageData = null;
      capturedImages = [];
      await chrome.storage.session.remove('capturedImages');
      chrome.action.setBadgeText({ text: '' });
      return { success: true };
    
    case 'REMOVE_IMAGE':
      capturedImages = capturedImages.filter(img => img.id !== message.imageId);
      if (capturedImages.length === 0) {
        capturedImageData = null;
        chrome.action.setBadgeText({ text: '' });
      } else {
        capturedImageData = capturedImages[0];
        chrome.action.setBadgeText({ text: String(capturedImages.length) });
      }
      await chrome.storage.session.set({ capturedImages });
      return { success: true, images: capturedImages };

    case 'CREATE_ZIP':
      return await createZip(message.images);

    default:
      return { success: false, error: 'Unknown message type' };
  }
}

async function ensureOffscreenDocument() {
  if (offscreenDocumentCreated) return;
  
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Image processing and format conversion'
    });
    offscreenDocumentCreated = true;
  } catch (error) {
    if (!error.message.includes('already exists')) {
      throw error;
    }
    offscreenDocumentCreated = true;
  }
}

async function closeOffscreenDocument() {
  if (!offscreenDocumentCreated) return;
  try {
    await chrome.offscreen.closeDocument();
    offscreenDocumentCreated = false;
  } catch (e) {}
}

async function processImage(options, imageId) {
  const { format, maxSizeKB, resizeWidth } = options;
  
  // Find the specific image or use first one
  let imageToProcess = capturedImageData;
  if (imageId && capturedImages.length > 0) {
    imageToProcess = capturedImages.find(img => img.id === imageId) || capturedImages[0];
  }
  
  if (!imageToProcess) {
    const stored = await chrome.storage.session.get('capturedImages');
    capturedImages = stored.capturedImages || [];
    imageToProcess = capturedImages.find(img => img.id === imageId) || capturedImages[0];
  }
  
  if (!imageToProcess) {
    return { success: false, error: 'No image captured' };
  }

  try {
    await ensureOffscreenDocument();

    const result = await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'PROCESS_IMAGE',
      data: {
        base64: imageToProcess.base64,
        format,
        maxSizeKB,
        resizeWidth,
        originalWidth: imageToProcess.width,
        originalHeight: imageToProcess.height
      }
    });

    return result;
  } catch (error) {
    console.error('[SCE-BG] Processing error:', error);
    return { success: false, error: error.message };
  }
}

async function downloadImage(base64, filename, mimeType) {
  try {
    const extMap = {
      'image/webp': 'webp',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'application/zip': 'zip'
    };
    const ext = extMap[mimeType] || 'png';
    const safeName = (filename || 'canva-export')
      .replace(/[<>:"/\\|?*]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 100) || 'canva-export';
    const fullFilename = `${safeName}.${ext}`;

    const downloadId = await chrome.downloads.download({
      url: base64,
      filename: fullFilename,
      saveAs: true
    });

    setTimeout(() => closeOffscreenDocument(), 1000);
    return { success: true, downloadId };
  } catch (error) {
    console.error('[SCE-BG] Download error:', error);
    return { success: false, error: error.message };
  }
}

async function createZip(images) {
  try {
    await ensureOffscreenDocument();
    
    const result = await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'CREATE_ZIP',
      data: { images }
    });
    
    return result;
  } catch (error) {
    console.error('[SCE-BG] Create ZIP error:', error);
    return { success: false, error: error.message };
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('[SCE-BG] Extension installed/updated');
  chrome.storage.session.remove('capturedImage');
});

// Handle extension icon click - open overlay on active tab
chrome.action.onClicked.addListener(async (tab) => {
  console.log('[SCE-BG] Extension icon clicked');
  
  if (!tab.url?.includes('canva.com')) {
    return;
  }
  
  if (capturedImages.length === 0) {
    const stored = await chrome.storage.session.get('capturedImages');
    capturedImages = stored.capturedImages || [];
    capturedImageData = capturedImages[0] || null;
  }
  
  if (capturedImages.length > 0) {
    chrome.tabs.sendMessage(tab.id, {
      type: 'SHOW_OVERLAY',
      data: capturedImages.length === 1 ? capturedImages[0] : null,
      images: capturedImages
    }).catch(() => {});
  }
});

console.log('[SCE-BG] Background service worker started');
