/**
 * Compressor Utility Library
 * Shared compression logic that can be used across different contexts
 */

const Compressor = {
  /**
   * Format file size for display
   */
  formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  },

  /**
   * Calculate compression ratio
   */
  getCompressionRatio(originalSize, newSize) {
    if (!originalSize) return 0;
    return Math.round((1 - newSize / originalSize) * 100);
  },

  /**
   * Check if format supports quality parameter
   */
  supportsQuality(format) {
    return ['webp', 'jpg', 'jpeg'].includes(format.toLowerCase());
  },

  /**
   * Get recommended starting quality for format
   */
  getDefaultQuality(format) {
    switch (format.toLowerCase()) {
      case 'webp': return 0.85;
      case 'jpg':
      case 'jpeg': return 0.92;
      default: return 1;
    }
  },

  /**
   * Estimate if target size is achievable
   * Based on typical compression ratios
   */
  estimateAchievable(originalSize, targetSize, format) {
    // WebP typically achieves 25-35% smaller than JPEG
    // JPEG at quality 0.1 is roughly 5-10% of original PNG
    const minRatio = format === 'webp' ? 0.03 : 0.05;
    const minPossible = originalSize * minRatio;
    return targetSize >= minPossible;
  }
};

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Compressor;
}
