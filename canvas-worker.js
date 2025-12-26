// canvas-worker.js

self.onmessage = async function (e) {
  const { type, imageBlob, width, height, quality } = e.data;

  if (type === "resize") {
    try {
      // Create ImageBitmap from blob
      const imageBitmap = await createImageBitmap(imageBlob);

      // Create OffscreenCanvas
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");

      // Draw with quality settings
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(imageBitmap, 0, 0, width, height);

      // Convert to blob
      const blob = await canvas.convertToBlob({
        type: "image/jpeg",
        quality: quality,
      });

      self.postMessage({ success: true, blob });
    } catch (error) {
      self.postMessage({ success: false, error: error.message });
    }
  }
};
