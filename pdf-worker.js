// pdf-worker.js

// Import PDF.js library in worker context
importScripts(
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
);
importScripts(
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"
);

// Configure PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

self.onmessage = async function (e) {
  const { type, data, scale, pageNumber } = e.data;

  if (type === "renderPage") {
    try {
      // pdfjsLib udah available dari pdf.worker.min.js
      const pdf = await pdfjsLib.getDocument({ data }).promise;
      const page = await pdf.getPage(pageNumber || 1);

      const viewport = page.getViewport({ scale: scale || 0.5 });

      const canvas = new OffscreenCanvas(viewport.width, viewport.height);
      const context = canvas.getContext("2d");

      await page.render({
        canvasContext: context,
        viewport: viewport,
      }).promise;

      const blob = await canvas.convertToBlob();

      self.postMessage({
        success: true,
        blob: blob,
        width: viewport.width,
        height: viewport.height,
      });
    } catch (error) {
      self.postMessage({
        success: false,
        error: error.message,
      });
    }
  }
};
