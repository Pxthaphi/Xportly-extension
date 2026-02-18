/**
 * Offscreen Document Script
 * - Handles image processing using Canvas API
 * - Performs format conversion and compression
 * - Runs in a separate document because service workers can't access DOM
 */

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// Listen for messages from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;
  
  if (message.type === 'PROCESS_IMAGE') {
    processImage(message.data)
      .then(sendResponse)
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  if (message.type === 'EXTRACT_ZIP') {
    extractZip(message.data)
      .then(sendResponse)
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  if (message.type === 'CREATE_ZIP') {
    createZipFile(message.data)
      .then(sendResponse)
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

/**
 * Main image processing function
 */
async function processImage(options) {
  const { base64, format, maxSizeKB, resizeWidth, originalWidth, originalHeight } = options;
  
  try {
    // Load image from base64
    const img = await loadImage(base64);
    
    // Calculate dimensions
    let targetWidth = img.naturalWidth;
    let targetHeight = img.naturalHeight;
    
    if (resizeWidth && resizeWidth < targetWidth) {
      const ratio = resizeWidth / targetWidth;
      targetWidth = resizeWidth;
      targetHeight = Math.round(targetHeight * ratio);
    }
    
    // Warn if image is very large
    if (targetWidth > 4096 || targetHeight > 4096) {
      console.warn('[Xportly] Large image detected, may cause memory issues');
    }
    
    // Set canvas size and draw image
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    ctx.clearRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
    
    // Get mime type for output format
    const mimeType = getMimeType(format);
    
    // Compress to target size
    const result = await compressToTargetSize(canvas, mimeType, maxSizeKB);
    
    return {
      success: true,
      base64: result.base64,
      finalSize: result.size,
      finalQuality: result.quality,
      mimeType,
      width: targetWidth,
      height: targetHeight,
      reachedTarget: result.reachedTarget
    };
  } catch (error) {
    console.error('[Xportly] Processing error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Load image from base64 string
 */
function loadImage(base64) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = base64;
  });
}

/**
 * Get MIME type from format string
 */
function getMimeType(format) {
  const types = {
    'webp': 'image/webp',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png'
  };
  return types[format.toLowerCase()] || 'image/png';
}

/**
 * Compress image to target file size
 * Uses iterative quality reduction
 */
async function compressToTargetSize(canvas, mimeType, maxSizeKB) {
  // PNG doesn't support quality parameter
  if (mimeType === 'image/png') {
    const blob = await canvasToBlob(canvas, mimeType, 1);
    const base64 = await blobToBase64(blob);
    return {
      base64,
      size: blob.size,
      quality: 1,
      reachedTarget: !maxSizeKB || blob.size <= maxSizeKB * 1024
    };
  }
  
  // If no size limit, use high quality
  if (!maxSizeKB) {
    const blob = await canvasToBlob(canvas, mimeType, 0.92);
    const base64 = await blobToBase64(blob);
    return {
      base64,
      size: blob.size,
      quality: 0.92,
      reachedTarget: true
    };
  }
  
  const targetBytes = maxSizeKB * 1024;
  let quality = 0.92;
  let bestResult = null;
  
  // Iterative compression loop
  while (quality >= 0.1) {
    const blob = await canvasToBlob(canvas, mimeType, quality);
    const base64 = await blobToBase64(blob);
    
    bestResult = {
      base64,
      size: blob.size,
      quality: Math.round(quality * 100) / 100,
      reachedTarget: blob.size <= targetBytes
    };
    
    if (blob.size <= targetBytes) {
      return bestResult;
    }
    
    quality -= 0.05;
  }
  
  // Couldn't reach target, return best effort
  return bestResult;
}

/**
 * Convert canvas to Blob
 */
function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Failed to create blob')),
      mimeType,
      quality
    );
  });
}

/**
 * Convert Blob to base64
 */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

console.log('[Xportly] Offscreen document ready');

/**
 * Extract images from ZIP file
 */
async function extractZip(data) {
  const { base64Zip, zipFilename } = data;
  
  try {
    // Convert base64 to blob
    const response = await fetch(base64Zip);
    const zipBlob = await response.blob();
    
    // Use JSZip to extract
    const zip = await JSZip.loadAsync(zipBlob);
    const images = [];
    
    const filePromises = [];
    zip.forEach((relativePath, zipEntry) => {
      if (zipEntry.dir) return;
      
      const ext = relativePath.split('.').pop().toLowerCase();
      if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
        filePromises.push(
          zipEntry.async('blob').then(async (blob) => {
            const base64 = await blobToBase64(blob);
            const dimensions = await getImageDimensions(base64);
            
            return {
              base64,
              originalSize: blob.size,
              mimeType: blob.type || `image/${ext === 'jpg' ? 'jpeg' : ext}`,
              filename: relativePath.split('/').pop().replace(/\.[^/.]+$/, ''),
              width: dimensions.width,
              height: dimensions.height
            };
          })
        );
      }
    });
    
    const extractedImages = await Promise.all(filePromises);
    
    return {
      success: true,
      images: extractedImages.filter(img => img !== null)
    };
  } catch (error) {
    console.error('[Xportly] ZIP extraction error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get image dimensions from base64
 */
function getImageDimensions(base64) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = base64;
  });
}

/**
 * Create ZIP file from processed images
 */
async function createZipFile(data) {
  const { images } = data;
  
  try {
    const zip = new JSZip();
    
    for (const img of images) {
      // Convert base64 to blob
      const response = await fetch(img.base64);
      const blob = await response.blob();
      
      const extMap = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };
      const ext = extMap[img.mimeType] || img.format || 'png';
      const filename = `${img.filename}.${ext}`;
      
      zip.file(filename, blob);
    }
    
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const base64 = await blobToBase64(zipBlob);
    
    return { success: true, base64 };
  } catch (error) {
    console.error('[Xportly] Create ZIP error:', error);
    return { success: false, error: error.message };
  }
}
