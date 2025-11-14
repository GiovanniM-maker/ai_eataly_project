/**
 * Image processing utilities for compression and resizing
 */

/**
 * Resize and compress image using canvas
 * @param {File} file - Original image file
 * @param {number} maxSize - Maximum width/height in pixels (default: 1500)
 * @returns {Promise<Blob>} - Compressed image blob
 */
export async function resizeImage(file, maxSize = 1500) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const img = new Image();
      
      img.onload = () => {
        // Calculate new dimensions maintaining aspect ratio
        let width = img.width;
        let height = img.height;
        
        if (width > maxSize || height > maxSize) {
          if (width > height) {
            height = (height * maxSize) / width;
            width = maxSize;
          } else {
            width = (width * maxSize) / height;
            height = maxSize;
          }
        }
        
        // Create canvas and draw resized image
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        // Convert to blob with compression
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to compress image'));
            }
          },
          'image/jpeg', // Use JPEG for better compression
          0.7 // Quality: 0.7 = 70% quality (good balance)
        );
      };
      
      img.onerror = () => {
        reject(new Error('Failed to load image'));
      };
      
      img.src = e.target.result;
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    
    reader.readAsDataURL(file);
  });
}

/**
 * Convert Blob to base64 string
 * @param {Blob} blob - Image blob
 * @returns {Promise<string>} - Base64 string
 */
export async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onloadend = () => {
      resolve(reader.result);
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to convert blob to base64'));
    };
    
    reader.readAsDataURL(blob);
  });
}

/**
 * Complete image processing pipeline
 * Resizes, compresses, and converts to base64
 * @param {File} file - Original image file
 * @param {number} maxSize - Maximum width/height in pixels (default: 1500)
 * @returns {Promise<{blob: Blob, base64: string, originalSize: number, compressedSize: number}>}
 */
export async function processImage(file, maxSize = 1500) {
  const originalSize = file.size;
  
  console.log('[IMG] Processing image:', {
    name: file.name,
    type: file.type,
    originalSize: `${(originalSize / 1024).toFixed(2)} KB`
  });
  
  // Resize and compress
  const compressedBlob = await resizeImage(file, maxSize);
  const compressedSize = compressedBlob.size;
  
  console.log('[IMG] Compression complete:', {
    originalSize: `${(originalSize / 1024).toFixed(2)} KB`,
    compressedSize: `${(compressedSize / 1024).toFixed(2)} KB`,
    reduction: `${((1 - compressedSize / originalSize) * 100).toFixed(1)}%`
  });
  
  // Convert to base64
  const base64 = await blobToBase64(compressedBlob);
  
  return {
    blob: compressedBlob,
    base64,
    originalSize,
    compressedSize
  };
}

