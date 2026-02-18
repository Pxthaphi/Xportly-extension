/**
 * Injected Script - intercepts downloads and prevents default Canva download
 */

(function() {
  'use strict';
  
  console.log('[SCE-INJ] Starting...');
  
  const captured = new Set();
  let lastCapturedImage = null;
  
  function send(blob, name, preventDownload = true) {
    const key = blob.size + '-' + (name || '');
    if (captured.has(key)) return;
    if (blob.size < 5000) return;
    captured.add(key);
    
    console.log('[SCE-INJ] Capturing:', blob.size, blob.type);
    
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        lastCapturedImage = {
          base64: reader.result,
          originalSize: blob.size,
          mimeType: blob.type || 'image/png',
          filename: name || 'canva-export',
          width: img.naturalWidth,
          height: img.naturalHeight
        };
        
        window.postMessage({
          type: 'CANVA_EXPORT_CAPTURED',
          source: 'smart-canva-exporter',
          data: lastCapturedImage,
          showOverlay: true
        }, '*');
        console.log('[SCE-INJ] Sent!', img.naturalWidth, 'x', img.naturalHeight);
      };
      img.onerror = () => {
        lastCapturedImage = {
          base64: reader.result,
          originalSize: blob.size,
          mimeType: blob.type || 'image/png',
          filename: name || 'canva-export',
          width: 0,
          height: 0
        };
        window.postMessage({
          type: 'CANVA_EXPORT_CAPTURED',
          source: 'smart-canva-exporter',
          data: lastCapturedImage,
          showOverlay: true
        }, '*');
        console.log('[SCE-INJ] Sent (no dimensions)');
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(blob);
    
    return preventDownload;
  }
  
  // Track pending blob URLs to prevent their downloads
  const pendingBlobUrls = new Set();
  
  // 1. Intercept createObjectURL - catches blob URLs
  const origCreateURL = URL.createObjectURL;
  URL.createObjectURL = function(obj) {
    const url = origCreateURL.apply(this, arguments);
    if (obj instanceof Blob) {
      console.log('[SCE-INJ] createObjectURL:', obj.type, obj.size);
      if ((obj.type?.startsWith('image/') && obj.size > 50000) || obj.size > 100000) {
        pendingBlobUrls.add(url);
        send(obj, 'canva-export', true);
      }
    }
    return url;
  };
  
  // 2. Intercept anchor click with download attribute - PREVENT DEFAULT
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function() {
    if (this.download || this.href?.startsWith('blob:')) {
      console.log('[SCE-INJ] Anchor click intercepted:', this.href?.slice(0, 60), 'download:', this.download);
      
      if (this.href?.startsWith('blob:') && pendingBlobUrls.has(this.href)) {
        console.log('[SCE-INJ] Blocking download, showing overlay instead');
        // Don't call original click - prevent download
        return;
      }
      
      if (this.href?.startsWith('blob:')) {
        fetch(this.href)
          .then(r => r.blob())
          .then(blob => {
            if (blob.size > 50000) {
              console.log('[SCE-INJ] Fetched blob from anchor:', blob.type, blob.size);
              send(blob, this.download || 'canva-export', true);
              // Don't proceed with download
              return;
            }
            // Small file, allow download
            origClick.apply(this, arguments);
          })
          .catch(e => {
            console.log('[SCE-INJ] Fetch error:', e);
            origClick.apply(this, arguments);
          });
        return;
      }
    }
    return origClick.apply(this, arguments);
  };
  
  // 3. Intercept appendChild to catch dynamically created download links
  const origAppendChild = Node.prototype.appendChild;
  Node.prototype.appendChild = function(child) {
    if (child instanceof HTMLAnchorElement && (child.download || child.href?.startsWith('blob:'))) {
      console.log('[SCE-INJ] appendChild anchor:', child.href?.slice(0, 60));
      
      if (child.href?.startsWith('blob:') && pendingBlobUrls.has(child.href)) {
        // Already captured, don't add to DOM
        console.log('[SCE-INJ] Blocking anchor append');
        return child;
      }
    }
    return origAppendChild.apply(this, arguments);
  };
  
  // 4. Intercept fetch for image responses
  const origFetch = window.fetch;
  window.fetch = async function(...args) {
    const res = await origFetch.apply(this, args);
    try {
      const url = String(args[0]?.url || args[0] || '');
      const ct = res.headers.get('content-type') || '';
      
      if (ct.startsWith('image/') && !url.includes('.svg')) {
        const clone = res.clone();
        const blob = await clone.blob();
        if (blob.size > 50000) {
          console.log('[SCE-INJ] Fetch image:', url.slice(0, 60), blob.size);
          send(blob, 'canva-export', false); // Don't block fetch responses
        }
      }
    } catch(e) {}
    return res;
  };
  
  // 5. Intercept XHR
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  
  XMLHttpRequest.prototype.open = function(m, url) {
    this._url = url;
    return origOpen.apply(this, arguments);
  };
  
  XMLHttpRequest.prototype.send = function() {
    this.addEventListener('load', () => {
      try {
        const ct = this.getResponseHeader('content-type') || '';
        if (ct.startsWith('image/') && this.response instanceof Blob && this.response.size > 50000) {
          console.log('[SCE-INJ] XHR image:', this._url?.slice(0, 60));
          send(this.response, 'canva-export', false);
        }
      } catch(e) {}
    });
    return origSend.apply(this, arguments);
  };
  
  // 6. Watch for download links being clicked - PREVENT DEFAULT
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    
    if (a.download || a.href?.startsWith('blob:')) {
      console.log('[SCE-INJ] Click on download link:', a.href?.slice(0, 60));
      
      if (a.href?.startsWith('blob:')) {
        e.preventDefault();
        e.stopPropagation();
        
        fetch(a.href)
          .then(r => r.blob())
          .then(blob => {
            if (blob.size > 50000) {
              send(blob, a.download || 'canva-export', true);
            }
          })
          .catch(() => {});
        return false;
      }
    }
  }, true);
  
  // 7. MutationObserver to watch for new anchor elements
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLAnchorElement && node.href?.startsWith('blob:')) {
          console.log('[SCE-INJ] New anchor detected:', node.href?.slice(0, 60));
          fetch(node.href)
            .then(r => r.blob())
            .then(blob => {
              if (blob.size > 50000) {
                pendingBlobUrls.add(node.href);
                send(blob, node.download || 'canva-export', true);
              }
            })
            .catch(() => {});
        }
      }
    }
  });
  observer.observe(document, { childList: true, subtree: true });
  
  console.log('[SCE-INJ] Ready - monitoring all download methods (with blocking)');
})();
