// script.js
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

let files = [];
let selectedIndices = new Set();
const allObjectURLs = new Set();

// ✅ Lazy loading setup
let imageObserver = null;

function initImageObserver() {
  if ("IntersectionObserver" in window) {
    imageObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const img = entry.target;
            if (img.dataset.src) {
              img.src = img.dataset.src;
              img.removeAttribute("data-src");
              imageObserver.unobserve(img);
            }
          }
        });
      },
      {
        root: null,
        rootMargin: "100px", // Load 100px before entering viewport
        threshold: 0.01,
      }
    );
  }
}

// Initialize observer
initImageObserver();

// ✅ Selection persistence system
let selectionHistory = [];
let canRestoreSelection = false;

function saveSelectionState() {
  // Save current selection state
  const state = {
    indices: Array.from(selectedIndices),
    fileNames: Array.from(selectedIndices).map((i) => files[i]?.name),
    timestamp: Date.now(),
  };

  selectionHistory.push(state);

  // Keep only last 10 states
  if (selectionHistory.length > 10) {
    selectionHistory.shift();
  }

  canRestoreSelection = true;
  updateRestoreButton(); // ✅ Show restore button
}

function restoreSelectionState() {
  if (selectionHistory.length === 0 || !canRestoreSelection) {
    return false;
  }

  const lastState = selectionHistory[selectionHistory.length - 1];

  // Try to restore by matching file names (more reliable after operations)
  selectedIndices.clear();

  lastState.fileNames.forEach((fileName) => {
    const index = files.findIndex((f) => f.name === fileName);
    if (index !== -1) {
      selectedIndices.add(index);
    }
  });

  // Update UI
  showPreview();
  updateFileCount();

  return selectedIndices.size > 0;
}

function manualRestoreSelection() {
  const restored = restoreSelectionState();

  if (restored) {
    showSuccess(`Restored ${selectedIndices.size} selected file(s)!`, 3000);

    // Hide restore button after use
    const btn = document.getElementById("restoreSelectionBtn");
    if (btn) {
      btn.style.display = "none";
    }

    canRestoreSelection = false;
  } else {
    showError("No selection to restore!", "warning");
  }
}

// ✅ Show restore button when selection can be restored
function updateRestoreButton() {
  const btn = document.getElementById("restoreSelectionBtn");
  if (btn && canRestoreSelection && files.length > 0) {
    btn.style.display = "inline-block";
  } else if (btn) {
    btn.style.display = "none";
  }
}

function clearSelectionHistory() {
  selectionHistory = [];
  canRestoreSelection = false;
}

let currentMode = "pdf";

// ✅ Add PDF Worker support
let pdfWorker = null;
let canvasWorker = null;

let isPdfWorkerSupported = false;

// ✅ Virtual scrolling support
let virtualScrollEnabled = false;
const VIRTUAL_SCROLL_THRESHOLD = 50; // Enable when > 50 files
const VISIBLE_BUFFER = 5; // Render 5 extra items on each side
let virtualScrollState = {
  itemHeight: 155, // 140px + 15px gap
  itemWidth: 155,
  itemsPerRow: 5,
  visibleRange: { start: 0, end: 20 },
};

function enableVirtualScroll() {
  if (files.length > VIRTUAL_SCROLL_THRESHOLD) {
    virtualScrollEnabled = true;
    initVirtualScroll();
  } else {
    virtualScrollEnabled = false;
  }
}

// ✅ Utility functions
function throttle(func, delay) {
  let lastCall = 0;
  return function (...args) {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      func(...args);
    }
  };
}

function debounce(func, delay) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  };
}

function initVirtualScroll() {
  const container = document.getElementById("imagePreviewContainer");
  if (!container) return;

  // Calculate items per row
  const containerWidth = container.offsetWidth;
  virtualScrollState.itemsPerRow = Math.floor(
    containerWidth / virtualScrollState.itemWidth
  );

  // Setup scroll listener
  container.addEventListener("scroll", throttle(handleVirtualScroll, 100));

  updateVirtualScroll();
}

function handleVirtualScroll() {
  const container = document.getElementById("imagePreviewContainer");
  const scrollTop = container.scrollTop;

  const firstVisibleRow = Math.floor(scrollTop / virtualScrollState.itemHeight);
  const visibleRows = Math.ceil(
    container.offsetHeight / virtualScrollState.itemHeight
  );

  const start = Math.max(
    0,
    (firstVisibleRow - VISIBLE_BUFFER) * virtualScrollState.itemsPerRow
  );
  const end = Math.min(
    files.length,
    (firstVisibleRow + visibleRows + VISIBLE_BUFFER) *
      virtualScrollState.itemsPerRow
  );

  if (
    start !== virtualScrollState.visibleRange.start ||
    end !== virtualScrollState.visibleRange.end
  ) {
    virtualScrollState.visibleRange = { start, end };
    updateVirtualScroll();
  }
}

function updateVirtualScroll() {
  const viewport = document.getElementById("imagePreviewViewport");
  const preview = document.getElementById("imagePreview");

  if (!viewport || !preview) return;

  const totalRows = Math.ceil(files.length / virtualScrollState.itemsPerRow);
  const totalHeight = totalRows * virtualScrollState.itemHeight;

  viewport.style.height = `${totalHeight}px`;
  preview.style.transform = `translateY(${
    Math.floor(
      virtualScrollState.visibleRange.start / virtualScrollState.itemsPerRow
    ) * virtualScrollState.itemHeight
  }px)`;

  // Render only visible items
  renderVisibleItems();
}

function renderVisibleItems() {
  const preview = document.getElementById("imagePreview");
  preview.innerHTML = "";

  for (
    let i = virtualScrollState.visibleRange.start;
    i < virtualScrollState.visibleRange.end && i < files.length;
    i++
  ) {
    const file = files[i];
    const card = createPreviewCard(file, i);
    preview.appendChild(card);
  }
}

function createPreviewCard(file, index) {
  const card = document.createElement("div");
  card.className = "preview-card";
  if (selectedIndices.has(index)) card.classList.add("selected");

  // Mobile-friendly touch handling
  let touchStartTime = 0;
  let touchMoved = false;

  const touchStartHandler = (e) => {
    touchStartTime = Date.now();
    touchMoved = false;
    e.preventDefault();
  };

  const touchMoveHandler = (e) => {
    touchMoved = true;
  };

  const touchEndHandler = (e) => {
    const touchDuration = Date.now() - touchStartTime;

    if (!touchMoved && touchDuration < 300) {
      if (!e.target.classList.contains("remove-btn")) {
        toggleSelection(index);

        card.style.transform = "scale(0.95)";
        setTimeout(() => {
          card.style.transform = "scale(1)";
        }, 100);
      }
    }
  };

  // ✅ DEFINE clickHandler BEFORE USE!
  const clickHandler = (e) => {
    if (!e.target.classList.contains("remove-btn")) {
      toggleSelection(index);
    }
  };

  // Add both touch and click listeners
  if ("ontouchstart" in window) {
    eventListeners.add(card, "touchstart", touchStartHandler, {
      passive: false,
    });
    eventListeners.add(card, "touchmove", touchMoveHandler, { passive: true });
    eventListeners.add(card, "touchend", touchEndHandler, { passive: true });
  } else {
    eventListeners.add(card, "click", clickHandler); // ✅ NOW DEFINED!
  }

  // ✅ Improve touch target size
  card.style.minWidth = "44px";
  card.style.minHeight = "44px";
  card.style.transition = "transform 0.1s ease";

  // ✅ HAPUS DUPLICATE CODE DI SINI! (yang const clickHandler kedua)

  if (file.type === "application/pdf") {
    renderPDFPreview(file, card, index);
  } else {
    const imgElement = document.createElement("img");
    const objUrl = createTrackedURL(file, index);

    if (imageObserver && files.length > 20) {
      imgElement.src =
        'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 140"%3E%3Crect width="140" height="140" fill="%23f3f4f6"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%239ca3af" font-size="14"%3ELoading...%3C/text%3E%3C/svg%3E';
      imgElement.dataset.src = objUrl;
      imageObserver.observe(imgElement);
    } else {
      imgElement.src = objUrl;
    }

    imgElement.alt = `Preview of ${file.name}`;
    card.appendChild(imgElement);
  }

  const overlay = document.createElement("div");
  overlay.className = "preview-overlay";
  const filename = document.createElement("p");
  filename.className = "preview-filename";
  filename.textContent = file.name;
  filename.title = file.name;
  overlay.appendChild(filename);
  card.appendChild(overlay);

  const removeBtn = document.createElement("button");
  removeBtn.textContent = "×";
  removeBtn.classList.add("remove-btn");

  const removeBtnHandler = (e) => {
    e.stopPropagation();
    removeFile(index);
  };
  eventListeners.add(removeBtn, "click", removeBtnHandler);

  card.appendChild(removeBtn);

  return card;
}

function initPDFWorker() {
  if (typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined") {
    try {
      pdfWorker = new Worker("pdf-worker.js");
      isPdfWorkerSupported = true;
      console.log("PDF Worker initialized");
    } catch (e) {
      console.warn("PDF Worker not available:", e);
      isPdfWorkerSupported = false;
    }
  }
}

// ✅ ADD Canvas Worker initialization
function initCanvasWorker() {
  if (typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined") {
    try {
      canvasWorker = new Worker("canvas-worker.js");
      console.log("Canvas Worker initialized");
    } catch (e) {
      console.warn("Canvas Worker not available:", e);
      canvasWorker = null;
    }
  }
}

// Initialize workers on load
initPDFWorker();
initCanvasWorker(); // ✅ ADD THIS LINE

const VALID_IMAGE_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/svg+xml",
  "image/webp",
];

// ✅ File signature validation (magic bytes)
const FILE_SIGNATURES = {
  "image/jpeg": [[0xff, 0xd8, 0xff]],
  "image/png": [[0x89, 0x50, 0x4e, 0x47]],
  "image/webp": [[0x52, 0x49, 0x46, 0x46]], // RIFF
  "application/pdf": [[0x25, 0x50, 0x44, 0x46]], // %PDF
};

async function validateFileType(file) {
  // Check extension first
  const validExtensions = [
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".pdf",
    ".heic",
    ".heif",
  ];
  const fileName = file.name.toLowerCase();
  const hasValidExtension = validExtensions.some((ext) =>
    fileName.endsWith(ext)
  );

  if (!hasValidExtension) {
    return {
      valid: false,
      error: `Invalid file extension. Allowed: ${validExtensions.join(", ")}`,
    };
  }

  // ✅ Check for double extensions (security)
  const extensionCount = (fileName.match(/\./g) || []).length;
  if (extensionCount > 1) {
    // Allow only safe double extensions like .tar.gz
    const lastTwo = fileName.split(".").slice(-2).join(".");
    if (!["tar.gz", "backup.zip"].includes(lastTwo)) {
      return {
        valid: false,
        error: "Suspicious file name detected (double extension)",
      };
    }
  }

  // ✅ Read file signature (first 8 bytes)
  try {
    const buffer = await file.slice(0, 8).arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Check against known signatures
    const expectedSignatures = FILE_SIGNATURES[file.type];
    if (expectedSignatures) {
      const isValid = expectedSignatures.some((signature) => {
        return signature.every((byte, index) => bytes[index] === byte);
      });

      if (!isValid) {
        return {
          valid: false,
          error: `File "${file.name}" claims to be ${file.type} but signature doesn't match. Possible fake extension.`,
        };
      }
    }

    // ✅ Additional checks for HEIC (harder to validate by bytes alone)
    if (file.type.includes("heic") || file.type.includes("heif")) {
      // HEIC files should have 'ftyp' at byte 4-7
      const ftypCheck = String.fromCharCode(...bytes.slice(4, 8));
      if (!ftypCheck.includes("ftyp")) {
        return {
          valid: false,
          error: `File "${file.name}" doesn't appear to be a valid HEIC/HEIF file`,
        };
      }
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: `Failed to validate file: ${error.message}`,
    };
  }
}

// Validate file type based on current mode
function validateFileForMode(file, mode) {
  const isPDF = file.type === "application/pdf";
  const isImage = VALID_IMAGE_TYPES.includes(file.type);

  const modeRules = {
    pdf: {
      accept: ["image"],
      reject: ["application/pdf"],
      message: "PDF mode only accepts images (they will be converted to PDF)",
    },
    merge: {
      accept: ["application/pdf"],
      reject: ["image"],
      message: "Merge mode only accepts PDF files",
    },
    split: {
      accept: ["application/pdf"],
      reject: ["image"],
      message: "Split mode only accepts PDF files",
    },
    jpeg: {
      accept: ["image/heic", "image/heif"],
      reject: ["application/pdf", "image/jpeg", "image/jpg", "image/png"],
      message: "HEIC to JPG mode only accepts HEIC/HEIF files",
    },
    compress: {
      accept: ["image"],
      reject: [],
      message: "Compress mode works best with images",
    },
    rotate: {
      accept: ["image"],
      reject: ["application/pdf"],
      message: "Rotate mode only accepts images",
    },
    filter: {
      accept: ["image"],
      reject: ["application/pdf"],
      message: "Filter mode only accepts images",
    },
    convert: {
      accept: ["image"],
      reject: ["application/pdf"],
      message: "Convert mode only accepts images",
    },
    editor: {
      accept: ["image"],
      reject: ["application/pdf"],
      message: "Editor mode only accepts images (1 at a time)",
    },
    delete: {
      accept: ["image", "application/pdf"],
      reject: [],
      message: "Delete mode accepts all files",
    },
    ocr: {
      accept: ["image"],
      reject: ["application/pdf"],
      message: "OCR mode only accepts images",
    },
  };

  const rule = modeRules[mode];

  if (!rule) {
    return { valid: true };
  }

  if (rule.accept.length > 0) {
    const isAccepted = rule.accept.some((type) => {
      if (type === "image") {
        return isImage;
      } else if (type === "application/pdf") {
        return isPDF;
      } else {
        return file.type === type;
      }
    });

    if (!isAccepted) {
      return {
        valid: false,
        error: file.name + " rejected! " + rule.message,
      };
    }
  }

  if (rule.reject.length > 0) {
    const isRejected = rule.reject.some((type) => {
      if (type === "image") {
        return isImage;
      } else if (type === "application/pdf") {
        return isPDF;
      } else {
        return file.type === type;
      }
    });

    if (isRejected) {
      return {
        valid: false,
        error: file.name + " rejected! " + rule.message,
      };
    }
  }

  return { valid: true };
}

const MAX_FILE_SIZE = 20 * 1024 * 1024;

// ✅ Memory limits
const MAX_TOTAL_MEMORY = 500 * 1024 * 1024; // 500MB max total
const MAX_FILES_COUNT = 200; // Max 200 files
let currentMemoryUsage = 0;

function calculateMemoryUsage() {
  currentMemoryUsage = files.reduce((total, file) => total + file.size, 0);
  return currentMemoryUsage;
}

function checkMemoryLimit(newFiles) {
  const newFilesSize = newFiles.reduce((total, file) => total + file.size, 0);
  const totalAfterAdd = currentMemoryUsage + newFilesSize;

  if (totalAfterAdd > MAX_TOTAL_MEMORY) {
    const availableMB = (
      (MAX_TOTAL_MEMORY - currentMemoryUsage) /
      1024 /
      1024
    ).toFixed(2);
    return {
      allowed: false,
      message: `Memory limit exceeded! You can add max ${availableMB}MB more files.`,
    };
  }

  if (files.length + newFiles.length > MAX_FILES_COUNT) {
    const availableCount = MAX_FILES_COUNT - files.length;
    return {
      allowed: false,
      message: `File count limit! You can add max ${availableCount} more files.`,
    };
  }

  return { allowed: true };
}

function updateMemoryDisplay() {
  const memoryMB = (currentMemoryUsage / 1024 / 1024).toFixed(2);
  const maxMemoryMB = (MAX_TOTAL_MEMORY / 1024 / 1024).toFixed(0);
  const percentage = ((currentMemoryUsage / MAX_TOTAL_MEMORY) * 100).toFixed(1);

  const fileCount = document.getElementById("fileCount");
  fileCount.innerHTML = `${files.length} file${
    files.length !== 1 ? "s" : ""
  } (${memoryMB}MB / ${maxMemoryMB}MB - ${percentage}%)`;

  // Warning if > 80%
  if (percentage > 80) {
    fileCount.style.color = "#ef4444";
    fileCount.style.fontWeight = "600";
  } else {
    fileCount.style.color = "var(--color-text-secondary)";
    fileCount.style.fontWeight = "400";
  }
}

// Better ObjectURL management with individual tracking
const fileObjectURLs = new Map(); // Track URLs per file index

function createTrackedURL(blob, fileIndex = null) {
  const url = URL.createObjectURL(blob);

  if (fileIndex !== null) {
    if (!fileObjectURLs.has(fileIndex)) {
      fileObjectURLs.set(fileIndex, []);
    }
    fileObjectURLs.get(fileIndex).push(url);
  } else {
    allObjectURLs.add(url);
  }

  return url;
}

function revokeFileURLs(fileIndex) {
  const urls = fileObjectURLs.get(fileIndex);
  if (urls) {
    urls.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch (e) {
        console.warn("Failed to revoke URL:", e);
      }
    });
    fileObjectURLs.delete(fileIndex);
  }
}

function revokeAllTrackedURLs() {
  // Revoke file-specific URLs
  fileObjectURLs.forEach((urls, index) => {
    urls.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch (e) {}
    });
  });
  fileObjectURLs.clear();

  // Revoke general URLs
  allObjectURLs.forEach((url) => {
    try {
      URL.revokeObjectURL(url);
    } catch (e) {}
  });
  allObjectURLs.clear();
}

// Update showPreview to use indexed URLs
// ✅ Optimized showPreview with incremental rendering
async function showPreview() {
  const previewContainer = document.getElementById("imagePreview");

  // Revoke old URLs before re-rendering
  const oldIndices = new Set();
  for (let i = 0; i < previewContainer.children.length; i++) {
    oldIndices.add(i);
  }
  oldIndices.forEach((i) => revokeFileURLs(i));

  previewContainer.innerHTML = "";

  // ✅ Batch render to avoid blocking UI
  const BATCH_SIZE = 10;

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, Math.min(i + BATCH_SIZE, files.length));

    // Render batch
    batch.forEach((file, batchIdx) => {
      const actualIndex = i + batchIdx;
      const card = createPreviewCard(file, actualIndex);
      previewContainer.appendChild(card);
    });

    // ✅ Yield to main thread every batch
    if (i + BATCH_SIZE < files.length) {
      await new Promise((resolve) => {
        if ("requestIdleCallback" in window) {
          requestIdleCallback(resolve);
        } else {
          setTimeout(resolve, 0);
        }
      });
    }
  }
}

// Update removeFile to revoke URLs
function removeFile(index) {
  // ✅ Cleanup event listeners for this card
  const preview = document.getElementById("imagePreview");
  const card = preview?.children[index];
  if (card) {
    eventListeners.remove(card);
    const removeBtn = card.querySelector(".remove-btn");
    if (removeBtn) {
      eventListeners.remove(removeBtn);
    }
  }
  // Revoke URLs for this file
  revokeFileURLs(index);

  // Cleanup PDF preview if exists
  cleanupPDFPreview(index);

  files.splice(index, 1);
  selectedIndices.delete(index);

  const newIndices = new Set();
  selectedIndices.forEach((i) => {
    if (i > index) newIndices.add(i - 1);
    else if (i < index) newIndices.add(i);
  });
  selectedIndices = newIndices;

  // Re-index URL tracking
  const newURLMap = new Map();
  fileObjectURLs.forEach((urls, i) => {
    if (i < index) {
      newURLMap.set(i, urls);
    } else if (i > index) {
      newURLMap.set(i - 1, urls);
    }
  });
  fileObjectURLs.clear();
  newURLMap.forEach((urls, i) => fileObjectURLs.set(i, urls));

  // Re-index PDF cleanup tasks
  const newTasks = new Map();
  pdfCleanupTasks.forEach((task, i) => {
    if (i < index) newTasks.set(i, task);
    else if (i > index) newTasks.set(i - 1, task);
  });
  pdfCleanupTasks.clear();
  newTasks.forEach((task, i) => pdfCleanupTasks.set(i, task));

  showPreview();
  updateFileCount();

  if (files.length === 0) {
    document.getElementById("thumbnailControls").style.display = "none";
    document.getElementById("batchControls").style.display = "none";
  }
}

function sanitizeFileName(name) {
  if (!name || typeof name !== "string") return "file";
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

document.querySelectorAll(".mode-tab").forEach((tab) => {
  // pakai ini
  tab.addEventListener("click", (e) => {
    // ✅ Use currentTarget instead of target to get the button element
    const clickedTab = e.currentTarget;

    document
      .querySelectorAll(".mode-tab")
      .forEach((t) => t.classList.remove("active"));
    clickedTab.classList.add("active");

    const category = clickedTab.dataset.category;
    document
      .querySelectorAll(".mode-options")
      .forEach((opt) => opt.classList.remove("active"));

    const targetOption = document.querySelector(
      `.mode-options[data-for="${category}"]`
    );
    if (targetOption) {
      targetOption.classList.add("active");
    }
  });
});

// Same fix for mode-card
document.querySelectorAll(".mode-card").forEach((card) => {
  card.addEventListener("click", (e) => {
    const clickedCard = e.currentTarget;

    document
      .querySelectorAll(".mode-card")
      .forEach((c) => c.classList.remove("selected"));
    clickedCard.classList.add("selected");

    currentMode = clickedCard.dataset.mode;

    const compressPanel = document.getElementById("compressPanel");
    if (currentMode === "compress") {
      compressPanel.classList.add("active");
    } else {
      compressPanel.classList.remove("active");
    }

    // UPDATE FILE INPUT ACCEPT BASED ON MODE
    updateFileInputAccept(currentMode);
  });
});

// ADD NEW FUNCTION
function updateFileInputAccept(mode) {
  const fileInput = document.getElementById("imageInput");

  const acceptMap = {
    pdf: "image/*",
    merge: "application/pdf",
    split: "application/pdf",
    jpeg: ".heic,.heif",
    compress: "image/*",
    rotate: "image/*",
    filter: "image/*",
    convert: "image/*",
    editor: "image/*",
    ocr: "image/*",
    delete: "image/*,application/pdf",
  };

  fileInput.accept = acceptMap[mode] || "image/*,application/pdf";

  // UPDATE DROP ZONE MESSAGE
  const modeMessages = {
    pdf: "Upload images to convert to PDF",
    merge: "Upload multiple PDF files to merge",
    split: "Upload PDF file to split",
    jpeg: "Upload HEIC/HEIF files to convert",
    compress: "Upload images to compress",
    rotate: "Upload images to rotate",
    filter: "Upload images to apply filters",
    convert: "Upload images to convert format",
    editor: "Upload 1 image to edit",
    ocr: "Upload images to extract text",
    delete: "Upload files to delete",
  };

  const dropZone = document.querySelector(".drop-zone p");
  if (dropZone && modeMessages[mode]) {
    dropZone.textContent = modeMessages[mode];
  }
}

// Same fix for preset-card
document.querySelectorAll(".preset-card").forEach((preset) => {
  preset.addEventListener("click", (e) => {
    // ✅ Use currentTarget
    const clickedPreset = e.currentTarget; // pakai ini

    document
      .querySelectorAll(".preset-card")
      .forEach((p) => p.classList.remove("active"));
    clickedPreset.classList.add("active");

    const presetType = clickedPreset.dataset.preset;
    const qualitySlider = document.getElementById("compressQuality");
    const qualityValue = document.getElementById("qualityValue");

    if (presetType === "balanced") qualitySlider.value = 80;
    else if (presetType === "high") qualitySlider.value = 90;
    else if (presetType === "web") qualitySlider.value = 60;

    qualityValue.textContent = qualitySlider.value + "%";
  });
});

document.getElementById("compressQuality").addEventListener("input", (e) => {
  document.getElementById("qualityValue").textContent = e.target.value + "%";
});

const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("imageInput");

dropZone.addEventListener("click", () => fileInput.click());

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});

let dragCounter = 0; // Track enter/leave balance

dropZone.addEventListener("dragenter", (e) => {
  e.preventDefault();
  dragCounter++;
  dropZone.classList.add("drag-over");
});

dropZone.addEventListener("dragleave", (e) => {
  e.preventDefault();
  dragCounter--;

  // ✅ Only remove class when truly leaving dropzone
  if (dragCounter === 0) {
    dropZone.classList.remove("drag-over");
  }
});

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dragCounter = 0; // Reset counter
  dropZone.classList.remove("drag-over");
  const droppedFiles = Array.from(e.dataTransfer.files);
  handleFiles(droppedFiles);
});

// ✅ Alternative: Replace the input element entirely (most reliable)
function resetFileInput() {
  const oldInput = document.getElementById("imageInput");
  const newInput = oldInput.cloneNode(true);

  // Re-attach event listener
  newInput.addEventListener("change", (e) => {
    const selectedFiles = Array.from(e.target.files);
    handleFiles(selectedFiles);
    resetFileInput(); // Recursive reset
  });

  oldInput.parentNode.replaceChild(newInput, oldInput);
}

// Update handleFiles to use new reset
fileInput.addEventListener("change", (e) => {
  const selectedFiles = Array.from(e.target.files);
  handleFiles(selectedFiles);
  resetFileInput(); // ✅ Most reliable method
});

async function handleFiles(newFiles) {
  // ✅ VALIDATE FILE TYPE PER MODE
  const filteredFiles = [];

  for (const f of newFiles) {
    // Check if file type matches current mode
    const isValidForMode = validateFileForMode(f, currentMode);

    if (!isValidForMode.valid) {
      showError(isValidForMode.error, "warning");
      continue;
    }

    filteredFiles.push(f);
  }

  if (filteredFiles.length === 0) {
    showError("No valid files for current mode!");
    return;
  }

  // Check memory limit
  const memoryCheck = checkMemoryLimit(filteredFiles);
  if (!memoryCheck.allowed) {
    showError(memoryCheck.message);
    return;
  }

  const convertedFiles = [];

  for (const f of filteredFiles) {
    // Validate file size
    if (f.size > MAX_FILE_SIZE) {
      showError(`File "${f.name}" too large! Max 20MB.`, "warning");
      continue;
    }

    // Validate file type with signature check
    const validation = await validateFileType(f);
    if (!validation.valid) {
      showError(validation.error, "warning");
      continue;
    }

    const isHeic =
      f.type === "image/heic" ||
      f.type === "image/heif" ||
      /\.hei[cf]$/i.test(f.name);
    if (isHeic) {
      try {
        showInfo("Converting HEIC...");
        const converted = await convertHeicToJpeg(f, 0.9);
        convertedFiles.push(...converted);
        hideInfo();
      } catch (e) {
        showError(`HEIC conversion failed: ${e.message}`, "warning");
      }
    } else {
      convertedFiles.push(f);
    }
  }

  if (convertedFiles.length === 0) {
    showError("No files could be processed!");
    return;
  }

  files.push(...convertedFiles);

  if (files.length > 0) {
    calculateMemoryUsage();
    enableVirtualScroll();
    showPreview();
    updateFileCount();
    document.getElementById("thumbnailControls").style.display = "flex";
    document.getElementById("batchControls").style.display = "flex";
    hideError();
  }
}

async function convertHeicToJpeg(file, quality = 0.9) {
  const result = await heic2any({ blob: file, toType: "image/jpeg", quality });
  const blobs = Array.isArray(result) ? result : [result];
  return blobs.map((blob, idx) => {
    const base = file.name.replace(/\.(heic|heif)$/i, "");
    const name = blobs.length > 1 ? `${base}_${idx + 1}.jpg` : `${base}.jpg`;
    return new File([blob], name, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  });
}

// Add cleanup tracking
const pdfCleanupTasks = new Map();

// ✅ Event listener tracking
const eventListeners = {
  elements: new Map(),
  add(element, event, handler, options) {
    if (!this.elements.has(element)) {
      this.elements.set(element, []);
    }
    this.elements.get(element).push({ event, handler, options });
    element.addEventListener(event, handler, options);
  },
  remove(element) {
    const listeners = this.elements.get(element);
    if (listeners) {
      listeners.forEach(({ event, handler, options }) => {
        element.removeEventListener(event, handler, options);
      });
      this.elements.delete(element);
    }
  },
  removeAll() {
    this.elements.forEach((listeners, element) => {
      listeners.forEach(({ event, handler, options }) => {
        try {
          element.removeEventListener(event, handler, options);
        } catch (e) {
          console.warn("Failed to remove listener:", e);
        }
      });
    });
    this.elements.clear();
  },
};

// Cleanup on page unload
window.addEventListener("beforeunload", () => {
  eventListeners.removeAll();
  revokeAllTrackedURLs();

  // Cleanup workers
  if (pdfWorker) {
    pdfWorker.terminate();
  }
  if (canvasWorker) {
    // ✅ NOW PROPERLY CLEANED
    canvasWorker.terminate();
  }

  // ✅ Cleanup image observer
  if (imageObserver) {
    imageObserver.disconnect();
  }
});

async function renderPDFPreview(file, div, index) {
  const loadingDiv = document.createElement("div");
  loadingDiv.className = "preview-loading";
  loadingDiv.innerHTML =
    '<div class="loading-spinner"></div><small style="margin-top:10px;color:#6b7280;">Loading PDF...</small>';
  div.appendChild(loadingDiv);

  try {
    const arrayBuffer = await file.arrayBuffer();

    // ✅ Try worker first if available
    if (isPdfWorkerSupported && pdfWorker) {
      await renderPDFWithWorker(arrayBuffer, div, loadingDiv, index);
    } else {
      await renderPDFMainThread(arrayBuffer, div, loadingDiv, index);
    }
  } catch (error) {
    console.error("PDF preview error:", error);
    div.removeChild(loadingDiv);
    const errorDiv = document.createElement("div");
    errorDiv.className = "preview-error";
    errorDiv.innerHTML = "<span>⚠️</span><small>Preview failed</small>";
    div.appendChild(errorDiv);
  }
}

async function renderPDFWithWorker(arrayBuffer, div, loadingDiv, index) {
  return new Promise((resolve, reject) => {
    pdfWorker.onmessage = async (e) => {
      if (e.data.success) {
        const img = document.createElement("img");
        img.src = URL.createObjectURL(e.data.blob);
        img.style.width = "140px";
        img.style.height = "140px";
        img.style.objectFit = "cover";

        div.removeChild(loadingDiv);
        div.appendChild(img);

        pdfCleanupTasks.set(index, {
          blob: e.data.blob,
          img: img,
        });

        resolve();
      } else {
        reject(new Error(e.data.error));
      }
    };

    pdfWorker.postMessage({
      type: "renderPage",
      data: arrayBuffer,
      scale: 0.5,
      pageNumber: 1,
    });
  });
}

async function renderPDFMainThread(arrayBuffer, div, loadingDiv, index) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(1);

  const baseScale = page.getViewport({ scale: 1 });
  const MAX_PREVIEW = 500;
  let scale = 0.5;
  if (baseScale.width > MAX_PREVIEW || baseScale.height > MAX_PREVIEW) {
    scale = Math.min(
      MAX_PREVIEW / baseScale.width,
      MAX_PREVIEW / baseScale.height
    );
  }

  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  canvas.height = viewport.height;
  canvas.width = viewport.width;

  await page.render({ canvasContext: context, viewport: viewport }).promise;

  div.removeChild(loadingDiv);
  div.appendChild(canvas);

  pdfCleanupTasks.set(index, {
    pdf: pdf,
    canvas: canvas,
    context: context,
  });
}

// Add cleanup function
function cleanupPDFPreview(index) {
  const task = pdfCleanupTasks.get(index);
  if (task) {
    // Clear canvas
    if (task.context && task.canvas) {
      task.context.clearRect(0, 0, task.canvas.width, task.canvas.height);
      task.canvas.width = 0;
      task.canvas.height = 0;
    }

    // Destroy PDF document
    if (task.pdf) {
      task.pdf.destroy();
    }

    pdfCleanupTasks.delete(index);
  }
}

// Update clearFiles to cleanup all
function clearFiles() {
  // Cleanup all PDFs
  pdfCleanupTasks.forEach((task, index) => {
    cleanupPDFPreview(index);
  });

  files = [];
  selectedIndices.clear();
  currentMemoryUsage = 0;
  virtualScrollEnabled = false;

  // ✅ Clear selection history
  clearSelectionHistory();

  showPreview();
  updateMemoryDisplay();
  document.getElementById("thumbnailControls").style.display = "none";
  document.getElementById("batchControls").style.display = "none";

  // Hide compress panel
  const compressPanel = document.getElementById("compressPanel");
  if (compressPanel) {
    compressPanel.classList.remove("active");
  }

  // Reset compress stats
  const compressStats = document.getElementById("compressStats");
  if (compressStats) {
    compressStats.textContent = "";
  }

  // Reset mode to default
  currentMode = "pdf";
  document.querySelectorAll(".mode-card").forEach((card) => {
    card.classList.remove("selected");
    if (card.dataset.mode === "pdf") {
      card.classList.add("selected");
    }
  });

  // Reset quality slider
  const qualitySlider = document.getElementById("compressQuality");
  if (qualitySlider) {
    qualitySlider.value = 80;
    document.getElementById("qualityValue").textContent = "80%";
  }

  revokeAllTrackedURLs();
}

function toggleSelection(index) {
  const previewContainer = document.getElementById("imagePreview");
  const fileDiv = previewContainer.children[index];

  if (!fileDiv) return;

  if (selectedIndices.has(index)) {
    selectedIndices.delete(index);
    fileDiv.classList.remove("selected");
  } else {
    selectedIndices.add(index);
    fileDiv.classList.add("selected");
  }
}

function selectAll() {
  selectedIndices.clear();
  files.forEach((_, i) => selectedIndices.add(i));
  showPreview();
}

function deselectAll() {
  selectedIndices.clear();
  showPreview();
}

function invertSelection() {
  const newSelection = new Set();
  files.forEach((_, i) => {
    if (!selectedIndices.has(i)) newSelection.add(i);
  });
  selectedIndices = newSelection;
  showPreview();
}

function deleteSelected() {
  if (selectedIndices.size === 0) {
    showError("No files selected!");
    return;
  }
  const toKeep = files.filter((_, i) => !selectedIndices.has(i));
  files = toKeep;
  selectedIndices.clear();
  showPreview();
  updateFileCount();
}

function changeThumbnailSize(size, clickedButton) {
  const preview = document.getElementById("imagePreview");
  const multiplier = size === "small" ? 0.7 : size === "large" ? 1.3 : 1;

  preview.querySelectorAll("img, canvas").forEach((el) => {
    el.style.width = 140 * multiplier + "px";
    el.style.height = 140 * multiplier + "px";
  });

  // Remove active from all buttons
  document.querySelectorAll(".thumbnail-controls .batch-btn").forEach((btn) => {
    btn.classList.remove("active");
  });

  // Add active to clicked button
  if (clickedButton) {
    clickedButton.classList.add("active");
  }
}

function updateFileCount() {
  const count = files.length;
  const countElement = document.getElementById("fileCount");

  if (count === 0) {
    countElement.textContent = "No files selected";
  } else {
    const selectedCount = selectedIndices.size;
    countElement.textContent = `${count} file${count !== 1 ? "s" : ""} loaded${
      selectedCount > 0 ? ` • ${selectedCount} selected` : ""
    }`;
  }

  // ✅ Update restore button visibility
  updateRestoreButton();
}

async function processWithYield(processFunc, items, batchSize = 3) {
  const results = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, Math.min(i + batchSize, items.length));

    // Process batch
    const batchResults = await Promise.all(
      batch.map((item) => processFunc(item, i + batch.indexOf(item)))
    );

    results.push(...batchResults);

    // ✅ Yield to main thread
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return results;
}

// Add timeout wrapper for long operations
function withTimeout(promise, timeoutMs = 30000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Operation timeout")), timeoutMs)
    ),
  ]);
}

// ✅ Progress timing system
let progressStartTime = null;
let progressProcessedCount = 0;
let progressTotalCount = 0;
let progressSpeeds = []; // Track last 5 speeds

function startProgressTiming(totalItems) {
  progressStartTime = Date.now();
  progressProcessedCount = 0;
  progressTotalCount = totalItems;
  progressSpeeds = [];
}

function updateProgressTiming(currentIndex) {
  progressProcessedCount = currentIndex;

  const elapsed = Date.now() - progressStartTime;
  const elapsedSeconds = elapsed / 1000;

  if (progressProcessedCount > 0) {
    // Calculate current speed
    const currentSpeed = progressProcessedCount / elapsedSeconds; // items/sec

    // Keep last 5 speeds for smoothing
    progressSpeeds.push(currentSpeed);
    if (progressSpeeds.length > 5) {
      progressSpeeds.shift();
    }

    // Average speed
    const avgSpeed =
      progressSpeeds.reduce((a, b) => a + b, 0) / progressSpeeds.length;

    // Calculate remaining
    const remaining = progressTotalCount - progressProcessedCount;
    const estimatedSeconds = remaining / avgSpeed;

    return {
      elapsed: formatTime(elapsedSeconds),
      remaining: formatTime(estimatedSeconds),
      speed: avgSpeed.toFixed(1),
      percentage: ((progressProcessedCount / progressTotalCount) * 100).toFixed(
        1
      ),
    };
  }

  return null;
}

function formatTime(seconds) {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  } else if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  }
}

async function processFiles() {
  if (files.length === 0) {
    showError("Please select files first!");
    return;
  }

  const filesToProcess =
    selectedIndices.size > 0
      ? files.filter((_, i) => selectedIndices.has(i))
      : files;

  if (filesToProcess.length === 0) {
    showError("No files to process!");
    return;
  }

  // ✅ Save selection state before processing
  saveSelectionState();

  showProgress();
  hideError();
  hideSuccess();

  // Disable UI during processing
  document.getElementById("convertBtn").disabled = true;
  const dropZone = document.getElementById("dropZone");
  dropZone.style.pointerEvents = "none";
  dropZone.style.opacity = "0.5";

  try {
    switch (currentMode) {
      case "pdf":
        await withTimeout(convertToPDF(filesToProcess), 120000);
        break;
      case "jpeg":
        await withTimeout(convertHeicFiles(filesToProcess), 120000);
        break;
      case "merge":
        await withTimeout(mergePDFs(filesToProcess), 120000);
        break;
      case "compress":
        await withTimeout(compressFiles(filesToProcess), 120000);
        break;
      case "ocr":
        await withTimeout(performOCR(filesToProcess), 300000);
        break;
      case "rotate":
        await withTimeout(rotateImages(filesToProcess), 120000);
        break;
      case "delete":
        await deleteFiles(filesToProcess);
        break;
      case "filter":
        await withTimeout(applyFilters(filesToProcess), 180000);
        break;
      case "split":
        await withTimeout(splitPDFs(filesToProcess), 180000);
        break;
      case "convert":
        await withTimeout(convertFormats(filesToProcess), 180000);
        break;
      case "editor":
        await openImageEditor(filesToProcess);
        break;
      default:
        showError("Mode not implemented yet!");
    }

    // ✅ Try to restore selection after successful operation
    setTimeout(() => {
      if (files.length > 0) {
        const restored = restoreSelectionState();
        if (restored) {
          showSuccess("Selection restored after operation", 3000);
        }
      }
    }, 500);
  } catch (error) {
    if (error.message === "Operation timeout") {
      showError("Processing took too long. Try with fewer or smaller files.");
    } else {
      showError("Error: " + error.message);
    }
  } finally {
    hideProgress();
    document.getElementById("convertBtn").disabled = false;
    dropZone.style.pointerEvents = "auto";
    dropZone.style.opacity = "1";
  }
}

async function convertToPDF(filesToProcess) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();
  let firstPage = true;

  // ✅ Chunked processing dengan yield
  for (let i = 0; i < filesToProcess.length; i++) {
    updateProgress(
      (i / filesToProcess.length) * 100,
      `Processing ${i + 1}/${filesToProcess.length}`
    );

    const file = filesToProcess[i];
    const img = await createImageBitmap(file);

    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);

    const imgData = canvas.toDataURL("image/jpeg", 0.8);

    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    const imgRatio = img.width / img.height;
    const pdfRatio = pdfWidth / pdfHeight;

    let finalWidth, finalHeight;
    if (imgRatio > pdfRatio) {
      finalWidth = pdfWidth;
      finalHeight = pdfWidth / imgRatio;
    } else {
      finalHeight = pdfHeight;
      finalWidth = pdfHeight * imgRatio;
    }

    if (!firstPage) pdf.addPage();
    pdf.addImage(imgData, "JPEG", 0, 0, finalWidth, finalHeight);
    firstPage = false;

    // ✅ Yield to main thread setiap 3 pages
    if ((i + 1) % 3 === 0 && i + 1 < filesToProcess.length) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const filename = sanitizeFileName(`converted_${Date.now()}.pdf`);
  pdf.save(filename);
  showSuccess(`PDF created successfully: ${filename}`);
}

async function convertHeicFiles(filesToProcess) {
  const zip = new JSZip();

  for (let i = 0; i < filesToProcess.length; i++) {
    updateProgress(
      (i / filesToProcess.length) * 100,
      `Converting ${i + 1}/${filesToProcess.length}`
    );

    const file = filesToProcess[i];
    const isHeic =
      file.type === "image/heic" ||
      file.type === "image/heif" ||
      /\.hei[cf]$/i.test(file.name);

    if (isHeic) {
      const converted = await convertHeicToJpeg(file, 0.9);
      converted.forEach((f) => {
        zip.file(f.name, f);
      });
    } else {
      zip.file(file.name, file);
    }
  }

  const content = await zip.generateAsync({ type: "blob" });
  const url = createTrackedURL(content);
  const a = document.createElement("a");
  a.href = url;
  a.download = `converted_images_${Date.now()}.zip`;
  a.click();

  showSuccess("Images converted successfully!");
}

async function mergePDFs(filesToProcess) {
  // ✅ Validate that all files are PDFs
  const nonPDFs = filesToProcess.filter((f) => f.type !== "application/pdf");
  if (nonPDFs.length > 0) {
    showError(
      `Please select only PDF files! Found ${nonPDFs.length} non-PDF file(s).`
    );
    return;
  }

  if (filesToProcess.length < 2) {
    showError("Please select at least 2 PDF files to merge!");
    return;
  }

  try {
    // ✅ Check if pdf-lib is loaded
    if (typeof PDFLib === "undefined") {
      showError("PDF library not loaded! Please refresh the page.");
      return;
    }

    const { PDFDocument } = window["pdfLib"];

    // ✅ Create new merged PDF
    const mergedPdf = await PDFDocument.create();

    startProgressTiming(filesToProcess.length);

    // ✅ Process each PDF
    for (let i = 0; i < filesToProcess.length; i++) {
      const file = filesToProcess[i];

      updateProgress(
        ((i + 1) / filesToProcess.length) * 100,
        `Merging PDF ${i + 1}/${filesToProcess.length}: ${file.name}`,
        i + 1,
        filesToProcess.length
      );

      try {
        // Load PDF
        const pdfBytes = await file.arrayBuffer();
        const pdf = await PDFDocument.load(pdfBytes);

        // Get all pages
        const pageCount = pdf.getPageCount();
        const pageIndices = Array.from({ length: pageCount }, (_, i) => i);

        // Copy pages to merged PDF
        const copiedPages = await mergedPdf.copyPages(pdf, pageIndices);

        // Add all copied pages
        copiedPages.forEach((page) => {
          mergedPdf.addPage(page);
        });
      } catch (error) {
        showError(
          `Failed to process ${file.name}: ${error.message}`,
          "warning"
        );
        continue; // Skip this file but continue with others
      }
    }

    // ✅ Check if any pages were added
    if (mergedPdf.getPageCount() === 0) {
      showError("No pages could be merged. Check if PDFs are valid.");
      return;
    }

    // ✅ Save merged PDF
    updateProgress(100, "Finalizing merged PDF...");

    const mergedPdfBytes = await mergedPdf.save();
    const blob = new Blob([mergedPdfBytes], { type: "application/pdf" });

    // ✅ Download
    const url = createTrackedURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `merged_${filesToProcess.length}_files_${Date.now()}.pdf`;
    a.click();

    showSuccess(
      `Successfully merged ${
        filesToProcess.length
      } PDFs into one file! (${mergedPdf.getPageCount()} pages total)`
    );
  } catch (error) {
    showError(`PDF merge failed: ${error.message}`);
    console.error("Merge error:", error);
  }
}

async function splitPDFs(filesToProcess) {
  // ✅ Validate only PDFs
  const nonPDFs = filesToProcess.filter((f) => f.type !== "application/pdf");
  if (nonPDFs.length > 0) {
    showError("Please select only PDF files to split!");
    return;
  }

  if (filesToProcess.length === 0) {
    showError("No PDF files selected!");
    return;
  }

  // ✅ Ask user for split method
  const splitMethod = prompt(
    "🔪 Choose split method:\n\n" +
      "1 = Split into individual pages\n" +
      '2 = Split by page range (e.g., "1-3,5-7")\n' +
      "3 = Split every N pages (e.g., every 2 pages)\n" +
      '4 = Extract specific pages (e.g., "1,3,5")\n\n' +
      "Enter number (1-4):",
    "1"
  );

  if (splitMethod === null) {
    showError("Split cancelled");
    return;
  }

  try {
    if (typeof PDFLib === "undefined") {
      showError("PDF library not loaded! Please refresh the page.");
      return;
    }

    const { PDFDocument } = window["pdfLib"];

    const zip = new JSZip();

    startProgressTiming(filesToProcess.length);

    for (let fileIdx = 0; fileIdx < filesToProcess.length; fileIdx++) {
      const file = filesToProcess[fileIdx];

      updateProgress(
        ((fileIdx + 1) / filesToProcess.length) * 100,
        `Splitting ${file.name} (${fileIdx + 1}/${filesToProcess.length})`,
        fileIdx + 1,
        filesToProcess.length
      );

      try {
        const pdfBytes = await file.arrayBuffer();
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const totalPages = pdfDoc.getPageCount();

        const baseName = file.name.replace(".pdf", "");

        // ✅ Method 1: Split into individual pages
        if (splitMethod === "1") {
          for (let pageNum = 0; pageNum < totalPages; pageNum++) {
            const newPdf = await PDFDocument.create();
            const [copiedPage] = await newPdf.copyPages(pdfDoc, [pageNum]);
            newPdf.addPage(copiedPage);

            const newPdfBytes = await newPdf.save();
            zip.file(`${baseName}_page_${pageNum + 1}.pdf`, newPdfBytes);
          }
        }

        // ✅ Method 2: Split by ranges
        else if (splitMethod === "2") {
          const rangeInput = prompt(
            `📄 ${file.name} has ${totalPages} pages.\n\n` +
              'Enter page ranges (e.g., "1-3,5-7" or "1-10,15-20"):\n\n' +
              "Format: START-END, separated by commas",
            `1-${Math.ceil(totalPages / 2)},${
              Math.ceil(totalPages / 2) + 1
            }-${totalPages}`
          );

          if (!rangeInput) continue;

          const ranges = rangeInput.split(",").map((r) => r.trim());

          for (let rangeIdx = 0; rangeIdx < ranges.length; rangeIdx++) {
            const range = ranges[rangeIdx];
            const [start, end] = range
              .split("-")
              .map((n) => parseInt(n.trim()));

            if (
              isNaN(start) ||
              isNaN(end) ||
              start < 1 ||
              end > totalPages ||
              start > end
            ) {
              showError(`Invalid range: ${range}`, "warning");
              continue;
            }

            const newPdf = await PDFDocument.create();
            const pageIndices = Array.from(
              { length: end - start + 1 },
              (_, i) => start - 1 + i
            );

            const copiedPages = await newPdf.copyPages(pdfDoc, pageIndices);
            copiedPages.forEach((page) => newPdf.addPage(page));

            const newPdfBytes = await newPdf.save();
            zip.file(`${baseName}_pages_${start}-${end}.pdf`, newPdfBytes);
          }
        }

        // ✅ Method 3: Split every N pages
        else if (splitMethod === "3") {
          const nPages = prompt(
            `📄 ${file.name} has ${totalPages} pages.\n\n` +
              "Split every how many pages?\n" +
              '(e.g., enter "2" to split every 2 pages)',
            "2"
          );

          const n = parseInt(nPages);
          if (isNaN(n) || n < 1) {
            showError("Invalid number!", "warning");
            continue;
          }

          let partNum = 1;
          for (let i = 0; i < totalPages; i += n) {
            const newPdf = await PDFDocument.create();
            const endPage = Math.min(i + n, totalPages);
            const pageIndices = Array.from(
              { length: endPage - i },
              (_, idx) => i + idx
            );

            const copiedPages = await newPdf.copyPages(pdfDoc, pageIndices);
            copiedPages.forEach((page) => newPdf.addPage(page));

            const newPdfBytes = await newPdf.save();
            zip.file(`${baseName}_part_${partNum}.pdf`, newPdfBytes);
            partNum++;
          }
        }

        // ✅ Method 4: Extract specific pages
        else if (splitMethod === "4") {
          const pagesInput = prompt(
            `📄 ${file.name} has ${totalPages} pages.\n\n` +
              'Enter page numbers to extract (e.g., "1,3,5,10"):\n' +
              "Separated by commas",
            "1"
          );

          if (!pagesInput) continue;

          const pageNumbers = pagesInput
            .split(",")
            .map((n) => parseInt(n.trim()));
          const validPages = pageNumbers.filter(
            (n) => !isNaN(n) && n >= 1 && n <= totalPages
          );

          if (validPages.length === 0) {
            showError("No valid pages specified!", "warning");
            continue;
          }

          const newPdf = await PDFDocument.create();
          const pageIndices = validPages.map((n) => n - 1); // Convert to 0-indexed

          const copiedPages = await newPdf.copyPages(pdfDoc, pageIndices);
          copiedPages.forEach((page) => newPdf.addPage(page));

          const newPdfBytes = await newPdf.save();
          zip.file(
            `${baseName}_pages_${validPages.join("_")}.pdf`,
            newPdfBytes
          );
        } else {
          showError("Invalid split method!");
          return;
        }
      } catch (error) {
        showError(`Failed to split ${file.name}: ${error.message}`, "warning");
        continue;
      }
    }

    // ✅ Download ZIP
    if (Object.keys(zip.files).length === 0) {
      showError("No PDFs were split successfully!");
      return;
    }

    updateProgress(100, "Creating ZIP file...");

    const content = await zip.generateAsync({ type: "blob" });
    const url = createTrackedURL(content);
    const a = document.createElement("a");
    a.href = url;
    a.download = `split_pdfs_${Date.now()}.zip`;
    a.click();

    const fileCount = Object.keys(zip.files).length;
    showSuccess(
      `Successfully split into ${fileCount} PDF file${
        fileCount !== 1 ? "s" : ""
      }!`
    );
  } catch (error) {
    showError(`PDF split failed: ${error.message}`);
    console.error("Split error:", error);
  }
}

async function convertFormats(filesToProcess) {
  // ✅ Supported conversions
  const supportedFormats = {
    "image/jpeg": [".jpg", "JPEG"],
    "image/png": [".png", "PNG"],
    "image/webp": [".webp", "WebP"],
  };

  // ✅ Ask target format
  const formatChoice = prompt(
    "🔄 Convert images to which format?\n\n" +
      "1 = JPEG (smaller size, faster, lossy)\n" +
      "2 = PNG (larger size, lossless, supports transparency)\n" +
      "3 = WebP (best compression, modern browsers)\n\n" +
      "Enter number (1-3):",
    "1"
  );

  if (formatChoice === null) {
    showError("Conversion cancelled");
    return;
  }

  const formatMap = {
    1: { mime: "image/jpeg", ext: ".jpg", name: "JPEG" },
    2: { mime: "image/png", ext: ".png", name: "PNG" },
    3: { mime: "image/webp", ext: ".webp", name: "WebP" },
  };

  const targetFormat = formatMap[formatChoice];
  if (!targetFormat) {
    showError("Invalid format choice!");
    return;
  }

  // ✅ Ask for quality (for JPEG and WebP)
  let quality = 0.92;
  if (targetFormat.mime !== "image/png") {
    const qualityInput = prompt(
      `📊 Set ${targetFormat.name} quality:\n\n` +
        "0.1 = Lowest quality (smallest size)\n" +
        "0.5 = Medium quality\n" +
        "0.8 = High quality\n" +
        "1.0 = Maximum quality (largest size)\n\n" +
        "Enter value (0.1 - 1.0):",
      "0.92"
    );

    if (qualityInput !== null) {
      const q = parseFloat(qualityInput);
      if (!isNaN(q) && q >= 0.1 && q <= 1.0) {
        quality = q;
      }
    }
  }

  const zip = new JSZip();
  startProgressTiming(filesToProcess.length);

  let totalOriginalSize = 0;
  let totalConvertedSize = 0;

  for (let i = 0; i < filesToProcess.length; i++) {
    const file = filesToProcess[i];

    // ✅ Only convert images
    if (!VALID_IMAGE_TYPES.includes(file.type)) {
      zip.file(file.name, file);
      updateProgress(
        ((i + 1) / filesToProcess.length) * 100,
        `Skipping ${file.name} (not an image)`,
        i + 1,
        filesToProcess.length
      );
      continue;
    }

    totalOriginalSize += file.size;

    try {
      // ✅ Check if already in target format
      if (file.type === targetFormat.mime) {
        zip.file(file.name, file);
        totalConvertedSize += file.size;

        updateProgress(
          ((i + 1) / filesToProcess.length) * 100,
          `Skipping ${file.name} (already ${targetFormat.name})`,
          i + 1,
          filesToProcess.length
        );
        continue;
      }

      // ✅ Convert format
      const img = await createImageBitmap(file);

      // Create canvas
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");

      // ✅ Handle transparency for PNG
      if (targetFormat.mime === "image/png") {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      } else {
        // Fill white background for JPEG/WebP (no transparency)
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      ctx.drawImage(img, 0, 0);

      // ✅ Convert to blob with target format
      const blob = await new Promise((resolve) => {
        canvas.toBlob(resolve, targetFormat.mime, quality);
      });

      totalConvertedSize += blob.size;

      // ✅ Change file extension
      const newName = file.name.replace(/\.[^.]+$/, targetFormat.ext);
      zip.file(newName, blob);

      // ✅ Update stats in real-time
      const sizeDiff = totalOriginalSize - totalConvertedSize;
      const percentChange = ((sizeDiff / totalOriginalSize) * 100).toFixed(1);

      document.getElementById("compressStats").innerHTML = `
                📊 <strong>Conversion Stats:</strong><br>
                Original: ${(totalOriginalSize / 1024 / 1024).toFixed(2)} MB • 
                Converted: ${(totalConvertedSize / 1024 / 1024).toFixed(
                  2
                )} MB • 
                ${sizeDiff >= 0 ? "Saved" : "Increased"}: ${Math.abs(
        sizeDiff / 1024 / 1024
      ).toFixed(2)} MB (${percentChange}%)
            `;
    } catch (error) {
      showError(`Failed to convert ${file.name}: ${error.message}`, "warning");
      zip.file(file.name, file); // Include original on error
      totalConvertedSize += file.size;
    }

    updateProgress(
      ((i + 1) / filesToProcess.length) * 100,
      `Converting to ${targetFormat.name}: ${i + 1}/${filesToProcess.length}`,
      i + 1,
      filesToProcess.length
    );
  }

  // ✅ Download ZIP
  const content = await zip.generateAsync({ type: "blob" });
  const url = createTrackedURL(content);
  const a = document.createElement("a");
  a.href = url;
  a.download = `converted_to_${targetFormat.name.toLowerCase()}_${Date.now()}.zip`;
  a.click();

  showSuccess(
    `Successfully converted ${filesToProcess.length} file(s) to ${targetFormat.name}!`
  );
}

// ✅ Image Editor - Full featured!
async function openImageEditor(filesToProcess) {
  if (filesToProcess.length === 0) {
    showError("No files selected!");
    return;
  }

  // ✅ Only allow one image at a time for editing
  if (filesToProcess.length > 1) {
    const confirm = window.confirm(
      `You selected ${filesToProcess.length} files.\n\n` +
        "Image editor works on one image at a time.\n" +
        "Edit the first image?"
    );
    if (!confirm) return;
  }

  const file = filesToProcess[0];

  // Validate image type
  if (!VALID_IMAGE_TYPES.includes(file.type)) {
    showError("Please select an image file to edit!");
    return;
  }

  try {
    // ✅ Create editor modal
    const modal = document.createElement("div");
    modal.id = "imageEditorModal";
    modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.95);
            z-index: 10000;
            display: flex;
            flex-direction: column;
            animation: fadeIn 0.3s ease;
        `;

    // ✅ Editor UI
    modal.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:20px;background:#1f2937;border-bottom:2px solid #374151;">
                <h2 style="margin:0;color:white;font-size:24px;">🎨 Image Editor - ${file.name}</h2>
                <div style="display:flex;gap:10px;">
                    <button id="editorSave" style="padding:10px 20px;background:#10b981;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:600;">
                        💾 Save & Download
                    </button>
                    <button id="editorClose" style="padding:10px 20px;background:#ef4444;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:600;">
                        ✕ Close
                    </button>
                </div>
            </div>
            
            <div style="display:flex;flex:1;overflow:hidden;">
                <!-- Left Sidebar - Tools -->
                <div style="width:300px;background:#1f2937;padding:20px;overflow-y:auto;border-right:2px solid #374151;">
                    <h3 style="color:white;margin-top:0;">🛠️ Tools</h3>
                    
                    <!-- Crop Tool -->
                    <div style="background:#374151;padding:15px;border-radius:8px;margin-bottom:15px;">
                        <h4 style="color:white;margin:0 0 10px 0;">✂️ Crop</h4>
                        <button id="enableCrop" style="width:100%;padding:8px;background:#3b82f6;color:white;border:none;border-radius:4px;cursor:pointer;">
                            Enable Crop Mode
                        </button>
                        <button id="applyCrop" style="width:100%;padding:8px;background:#10b981;color:white;border:none;border-radius:4px;cursor:pointer;margin-top:8px;display:none;">
                            ✓ Apply Crop
                        </button>
                        <button id="cancelCrop" style="width:100%;padding:8px;background:#6b7280;color:white;border:none;border-radius:4px;cursor:pointer;margin-top:8px;display:none;">
                            ✗ Cancel
                        </button>
                    </div>
                    
                    <!-- Adjustments -->
                    <div style="background:#374151;padding:15px;border-radius:8px;margin-bottom:15px;">
                        <h4 style="color:white;margin:0 0 10px 0;">🎚️ Adjustments</h4>
                        
                        <label style="color:white;display:block;margin-bottom:8px;">
                            Brightness: <span id="brightnessVal">0</span>
                            <input type="range" id="brightness" min="-100" max="100" value="0" style="width:100%;">
                        </label>
                        
                        <label style="color:white;display:block;margin-bottom:8px;">
                            Contrast: <span id="contrastVal">0</span>
                            <input type="range" id="contrast" min="-100" max="100" value="0" style="width:100%;">
                        </label>
                        
                        <label style="color:white;display:block;margin-bottom:8px;">
                            Saturation: <span id="saturationVal">100</span>%
                            <input type="range" id="saturation" min="0" max="200" value="100" style="width:100%;">
                        </label>
                        
                        <label style="color:white;display:block;margin-bottom:8px;">
                            Blur: <span id="blurVal">0</span>px
                            <input type="range" id="blur" min="0" max="10" value="0" style="width:100%;">
                        </label>
                    </div>
                    
                    <!-- Rotate & Flip -->
                    <div style="background:#374151;padding:15px;border-radius:8px;margin-bottom:15px;">
                        <h4 style="color:white;margin:0 0 10px 0;">🔄 Transform</h4>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                            <button id="rotate90" style="padding:8px;background:#3b82f6;color:white;border:none;border-radius:4px;cursor:pointer;">↻ 90°</button>
                            <button id="rotate270" style="padding:8px;background:#3b82f6;color:white;border:none;border-radius:4px;cursor:pointer;">↺ -90°</button>
                            <button id="flipH" style="padding:8px;background:#8b5cf6;color:white;border:none;border-radius:4px;cursor:pointer;">↔ Flip H</button>
                            <button id="flipV" style="padding:8px;background:#8b5cf6;color:white;border:none;border-radius:4px;cursor:pointer;">↕ Flip V</button>
                        </div>
                    </div>
                    
                    <!-- Quick Filters -->
                    <div style="background:#374151;padding:15px;border-radius:8px;">
                        <h4 style="color:white;margin:0 0 10px 0;">✨ Filters</h4>
                        <button id="filterGrayscale" style="width:100%;padding:8px;background:#6b7280;color:white;border:none;border-radius:4px;cursor:pointer;margin-bottom:8px;">
                            Grayscale
                        </button>
                        <button id="filterSepia" style="width:100%;padding:8px;background:#92400e;color:white;border:none;border-radius:4px;cursor:pointer;margin-bottom:8px;">
                            Sepia
                        </button>
                        <button id="filterInvert" style="width:100%;padding:8px;background:#1f2937;color:white;border:none;border-radius:4px;cursor:pointer;">
                            Invert
                        </button>
                    </div>
                    
                    <!-- Reset -->
                    <button id="resetAll" style="width:100%;padding:12px;background:#ef4444;color:white;border:none;border-radius:8px;cursor:pointer;margin-top:15px;font-weight:600;">
                        ↺ Reset All
                    </button>
                </div>
                
                <!-- Main Canvas Area -->
                <div id="canvasContainer" style="flex:1;display:flex;align-items:center;justify-content:center;background:#111827;overflow:auto;position:relative;">
                    <canvas id="editorCanvas" style="max-width:100%;max-height:100%;box-shadow:0 0 50px rgba(0,0,0,0.5);"></canvas>
                </div>
            </div>
        `;

    document.body.appendChild(modal);

    // ✅ Initialize editor
    const canvas = document.getElementById("editorCanvas");
    const ctx = canvas.getContext("2d");

    // Load image
    const img = await createImageBitmap(file);
    canvas.width = img.width;
    canvas.height = img.height;

    // Store original image data
    let originalImageData;
    let currentRotation = 0;
    let currentFlipH = 1;
    let currentFlipV = 1;
    let cropMode = false;
    let cropRect = null;

    // Draw initial image
    ctx.drawImage(img, 0, 0);
    originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // ✅ Render function with all adjustments
    function renderImage() {
      // Reset canvas
      ctx.putImageData(originalImageData, 0, 0);

      // Get adjustment values
      const brightness = parseInt(document.getElementById("brightness").value);
      const contrast = parseInt(document.getElementById("contrast").value);
      const saturation = parseInt(document.getElementById("saturation").value);
      const blur = parseInt(document.getElementById("blur").value);

      // Apply CSS filters (faster than pixel manipulation)
      canvas.style.filter = `
                brightness(${100 + brightness}%)
                contrast(${100 + contrast}%)
                saturate(${saturation}%)
                blur(${blur}px)
            `;
    }

    // ✅ Adjustment sliders
    ["brightness", "contrast", "saturation", "blur"].forEach((id) => {
      const slider = document.getElementById(id);
      const valSpan = document.getElementById(id + "Val");

      slider.oninput = () => {
        valSpan.textContent =
          slider.value +
          (id === "saturation" ? "%" : id === "blur" ? "px" : "");
        renderImage();
      };
    });

    // ✅ Rotate buttons
    document.getElementById("rotate90").onclick = () => {
      currentRotation += 90;
      applyTransform();
    };

    document.getElementById("rotate270").onclick = () => {
      currentRotation -= 90;
      applyTransform();
    };

    document.getElementById("flipH").onclick = () => {
      currentFlipH *= -1;
      applyTransform();
    };

    document.getElementById("flipV").onclick = () => {
      currentFlipV *= -1;
      applyTransform();
    };

    function applyTransform() {
      const w = canvas.width;
      const h = canvas.height;

      // Swap dimensions for 90/270 rotation
      if (Math.abs(currentRotation % 180) === 90) {
        canvas.width = h;
        canvas.height = w;
      } else {
        canvas.width = w;
        canvas.height = h;
      }

      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.scale(currentFlipH, currentFlipV);
      ctx.rotate((currentRotation * Math.PI) / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      ctx.restore();

      originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      renderImage();
    }

    // ✅ Filter buttons
    document.getElementById("filterGrayscale").onclick = () => {
      let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      imageData = IMAGE_FILTERS.grayscale(imageData);
      ctx.putImageData(imageData, 0, 0);
      originalImageData = imageData;
    };

    document.getElementById("filterSepia").onclick = () => {
      let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      imageData = IMAGE_FILTERS.sepia(imageData);
      ctx.putImageData(imageData, 0, 0);
      originalImageData = imageData;
    };

    document.getElementById("filterInvert").onclick = () => {
      let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      imageData = IMAGE_FILTERS.invert(imageData);
      ctx.putImageData(imageData, 0, 0);
      originalImageData = imageData;
    };

    // ✅ Crop functionality
    document.getElementById("enableCrop").onclick = () => {
      cropMode = true;
      document.getElementById("enableCrop").style.display = "none";
      document.getElementById("applyCrop").style.display = "block";
      document.getElementById("cancelCrop").style.display = "block";
      canvas.style.cursor = "crosshair";

      // Simple crop with mouse events
      let startX,
        startY,
        isDrawing = false;

      canvas.onmousedown = (e) => {
        const rect = canvas.getBoundingClientRect();
        startX = e.clientX - rect.left;
        startY = e.clientY - rect.top;
        isDrawing = true;
      };

      canvas.onmousemove = (e) => {
        if (!isDrawing) return;

        const rect = canvas.getBoundingClientRect();
        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;

        // Redraw image
        ctx.putImageData(originalImageData, 0, 0);

        // Draw crop rectangle
        ctx.strokeStyle = "#3b82f6";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(startX, startY, currentX - startX, currentY - startY);
        ctx.setLineDash([]);

        cropRect = {
          x: Math.min(startX, currentX),
          y: Math.min(startY, currentY),
          width: Math.abs(currentX - startX),
          height: Math.abs(currentY - startY),
        };
      };

      canvas.onmouseup = () => {
        isDrawing = false;
      };
    };

    document.getElementById("applyCrop").onclick = () => {
      if (cropRect && cropRect.width > 0 && cropRect.height > 0) {
        const croppedData = ctx.getImageData(
          cropRect.x,
          cropRect.y,
          cropRect.width,
          cropRect.height
        );
        canvas.width = cropRect.width;
        canvas.height = cropRect.height;
        ctx.putImageData(croppedData, 0, 0);
        originalImageData = croppedData;

        cropMode = false;
        canvas.style.cursor = "default";
        canvas.onmousedown = null;
        canvas.onmousemove = null;
        canvas.onmouseup = null;

        document.getElementById("enableCrop").style.display = "block";
        document.getElementById("applyCrop").style.display = "none";
        document.getElementById("cancelCrop").style.display = "none";
      }
    };

    document.getElementById("cancelCrop").onclick = () => {
      cropMode = false;
      canvas.style.cursor = "default";
      canvas.onmousedown = null;
      canvas.onmousemove = null;
      canvas.onmouseup = null;
      ctx.putImageData(originalImageData, 0, 0);

      document.getElementById("enableCrop").style.display = "block";
      document.getElementById("applyCrop").style.display = "none";
      document.getElementById("cancelCrop").style.display = "none";
    };

    // ✅ Reset button
    document.getElementById("resetAll").onclick = () => {
      ctx.drawImage(img, 0, 0);
      originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      document.getElementById("brightness").value = 0;
      document.getElementById("contrast").value = 0;
      document.getElementById("saturation").value = 100;
      document.getElementById("blur").value = 0;

      ["brightnessVal", "contrastVal", "blurVal"].forEach((id) => {
        document.getElementById(id).textContent = "0";
      });
      document.getElementById("saturationVal").textContent = "100";

      currentRotation = 0;
      currentFlipH = 1;
      currentFlipV = 1;

      renderImage();
    };

    // ✅ Save button
    document.getElementById("editorSave").onclick = async () => {
      // Apply CSS filters to actual canvas pixels
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      const tempCtx = tempCanvas.getContext("2d");

      tempCtx.filter = canvas.style.filter;
      tempCtx.drawImage(canvas, 0, 0);

      const blob = await new Promise((resolve) => {
        tempCanvas.toBlob(resolve, file.type, 0.95);
      });

      const url = createTrackedURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name.replace(/(\.[^.]+)$/, "_edited$1");
      a.click();

      document.body.removeChild(modal);
      showSuccess("Edited image saved successfully!");
    };

    // ✅ Close button
    document.getElementById("editorClose").onclick = () => {
      const confirmClose = window.confirm("Close editor without saving?");
      if (confirmClose) {
        document.body.removeChild(modal);
      }
    };
  } catch (error) {
    showError(`Failed to open editor: ${error.message}`);
    console.error("Editor error:", error);
  }
}

async function resizeImageOptimized(
  file,
  quality,
  maxWidth = null,
  maxHeight = null
) {
  const img = await createImageBitmap(file);

  let targetWidth = img.width;
  let targetHeight = img.height;

  // Calculate dimensions if maxWidth/maxHeight provided
  if (maxWidth || maxHeight) {
    const ratio = img.width / img.height;
    if (maxWidth && img.width > maxWidth) {
      targetWidth = maxWidth;
      targetHeight = maxWidth / ratio;
    }
    if (maxHeight && targetHeight > maxHeight) {
      targetHeight = maxHeight;
      targetWidth = maxHeight * ratio;
    }
  }

  // ✅ Try Canvas Worker first untuk file besar
  if (canvasWorker && file.size > 1024 * 1024) {
    // Use worker for files > 1MB
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Canvas worker timeout"));
      }, 30000);

      canvasWorker.onmessage = (e) => {
        clearTimeout(timeout);
        if (e.data.success) {
          resolve(e.data.blob);
        } else {
          reject(new Error(e.data.error));
        }
      };

      canvasWorker.postMessage({
        type: "resize",
        imageBlob: file,
        width: targetWidth,
        height: targetHeight,
        quality: quality,
      });
    }).catch((error) => {
      console.warn("Canvas Worker failed, using main thread:", error);
      // Fallback to main thread
      return resizeOnMainThread(img, targetWidth, targetHeight, quality);
    });
  }

  // ✅ Fallback to main thread
  return resizeOnMainThread(img, targetWidth, targetHeight, quality);
}

// ✅ Helper function untuk main thread resize
async function resizeOnMainThread(img, targetWidth, targetHeight, quality) {
  const useOffscreen = typeof OffscreenCanvas !== "undefined";
  let canvas, ctx;

  if (useOffscreen) {
    canvas = new OffscreenCanvas(targetWidth, targetHeight);
    ctx = canvas.getContext("2d");
  } else {
    canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    ctx = canvas.getContext("2d");
  }

  // Draw with better quality
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  // Convert to blob
  if (useOffscreen) {
    return await canvas.convertToBlob({ type: "image/jpeg", quality });
  } else {
    return await new Promise((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", quality);
    });
  }
}

async function compressFiles(filesToProcess) {
  const quality = document.getElementById("compressQuality").value / 100;
  const zip = new JSZip();
  let originalSize = 0;
  let compressedSize = 0;

  // ✅ Start timing
  startProgressTiming(filesToProcess.length);

  for (let i = 0; i < filesToProcess.length; i++) {
    const file = filesToProcess[i];
    originalSize += file.size;

    if (VALID_IMAGE_TYPES.includes(file.type)) {
      const blob = await resizeImageOptimized(file, quality);
      compressedSize += blob.size;
      zip.file(file.name.replace(/\.\w+$/, ".jpg"), blob);
    } else {
      zip.file(file.name, file);
      compressedSize += file.size;
    }

    // ✅ Update stats REAL-TIME after each file
    const savedSize = originalSize - compressedSize;
    const savedPercent =
      originalSize > 0 ? ((savedSize / originalSize) * 100).toFixed(1) : 0;

    document.getElementById("compressStats").innerHTML = `
            📊 <strong>Real-time Stats:</strong><br>
            Original: ${(originalSize / 1024 / 1024).toFixed(2)} MB • 
            Compressed: ${(compressedSize / 1024 / 1024).toFixed(2)} MB • 
            Saved: ${(savedSize / 1024 / 1024).toFixed(2)} MB (${savedPercent}%)
        `;

    // ✅ Update progress with timing
    updateProgress(
      ((i + 1) / filesToProcess.length) * 100,
      `Compressing ${i + 1}/${filesToProcess.length}`,
      i + 1,
      filesToProcess.length
    );
  }

  const content = await zip.generateAsync({ type: "blob" });
  const url = createTrackedURL(content);
  const a = document.createElement("a");
  a.href = url;
  a.download = `compressed_${Date.now()}.zip`;
  a.click();

  showSuccess("Files compressed successfully!");
}

// ✅ Rotate images
async function rotateImages(filesToProcess) {
  const zip = new JSZip();

  // ✅ Ask user for rotation angle
  const angle = prompt(
    "Enter rotation angle:\n90 = 90° clockwise\n180 = 180°\n270 = 270° clockwise (90° counter-clockwise)\n\nOr enter custom angle (-360 to 360):",
    "90"
  );

  if (angle === null) {
    showError("Rotation cancelled");
    return;
  }

  const rotationAngle = parseInt(angle);
  if (isNaN(rotationAngle) || rotationAngle < -360 || rotationAngle > 360) {
    showError("Invalid angle! Please enter a number between -360 and 360");
    return;
  }

  // ✅ Start timing
  startProgressTiming(filesToProcess.length);

  for (let i = 0; i < filesToProcess.length; i++) {
    const file = filesToProcess[i];

    // ✅ Only rotate images, skip PDFs
    if (!VALID_IMAGE_TYPES.includes(file.type)) {
      zip.file(file.name, file);
      updateProgress(
        ((i + 1) / filesToProcess.length) * 100,
        `Skipping ${i + 1}/${filesToProcess.length} (not an image)`,
        i + 1,
        filesToProcess.length
      );
      continue;
    }

    try {
      // Create image bitmap
      const img = await createImageBitmap(file);

      // ✅ Determine canvas dimensions based on rotation
      let canvasWidth, canvasHeight;
      if (
        rotationAngle === 90 ||
        rotationAngle === 270 ||
        rotationAngle === -90 ||
        rotationAngle === -270
      ) {
        // Swap dimensions for 90/270 degree rotations
        canvasWidth = img.height;
        canvasHeight = img.width;
      } else {
        canvasWidth = img.width;
        canvasHeight = img.height;
      }

      // Create canvas
      const canvas = document.createElement("canvas");
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      const ctx = canvas.getContext("2d");

      // ✅ Apply rotation
      ctx.save();

      // Move to center of canvas
      ctx.translate(canvasWidth / 2, canvasHeight / 2);

      // Rotate
      ctx.rotate((rotationAngle * Math.PI) / 180);

      // Draw image centered
      ctx.drawImage(img, -img.width / 2, -img.height / 2);

      ctx.restore();

      // Convert to blob
      const blob = await new Promise((resolve) => {
        canvas.toBlob(resolve, file.type, 0.95);
      });

      // ✅ Add to zip with rotated suffix
      const newName = file.name.replace(
        /(\.[^.]+)$/,
        `_rotated${rotationAngle}$1`
      );
      zip.file(newName, blob);
    } catch (error) {
      showError(`Failed to rotate ${file.name}: ${error.message}`, "warning");
      zip.file(file.name, file); // Include original on error
    }

    // ✅ Update progress with timing
    updateProgress(
      ((i + 1) / filesToProcess.length) * 100,
      `Rotating ${i + 1}/${filesToProcess.length}`,
      i + 1,
      filesToProcess.length
    );
  }

  // ✅ Download zip
  const content = await zip.generateAsync({ type: "blob" });
  const url = createTrackedURL(content);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rotated_${rotationAngle}deg_${Date.now()}.zip`;
  a.click();

  showSuccess(`Images rotated ${rotationAngle}° successfully!`);
}

// ✅ Delete files with confirmation
async function deleteFiles(filesToProcess) {
  // ✅ Create confirmation modal
  const modal = document.createElement("div");
  modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        animation: fadeIn 0.2s ease;
    `;

  const modalContent = document.createElement("div");
  modalContent.style.cssText = `
        background: white;
        padding: 30px;
        border-radius: 12px;
        max-width: 500px;
        width: 90%;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        animation: slideUp 0.3s ease;
    `;

  modalContent.innerHTML = `
        <h3 style="margin:0 0 15px 0;color:#ef4444;font-size:24px;">⚠️ Confirm Deletion</h3>
        <p style="margin:0 0 20px 0;color:#666;line-height:1.6;">
            Are you sure you want to delete <strong>${
              filesToProcess.length
            } file${filesToProcess.length !== 1 ? "s" : ""}</strong>?<br>
            <small style="color:#999;">This action cannot be undone.</small>
        </p>
        <div style="background:#f3f4f6;padding:15px;border-radius:8px;margin-bottom:20px;max-height:200px;overflow-y:auto;">
            <strong style="display:block;margin-bottom:10px;color:#374151;">Files to delete:</strong>
            <ul style="margin:0;padding-left:20px;color:#6b7280;font-size:14px;">
                ${filesToProcess
                  .slice(0, 10)
                  .map((f) => `<li>${f.name}</li>`)
                  .join("")}
                ${
                  filesToProcess.length > 10
                    ? `<li style="color:#999;font-style:italic;">... and ${
                        filesToProcess.length - 10
                      } more</li>`
                    : ""
                }
            </ul>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
            <button id="cancelDelete" style="padding:10px 20px;border:2px solid #d1d5db;background:white;color:#374151;border-radius:8px;cursor:pointer;font-weight:600;transition:all 0.2s;">
                Cancel
            </button>
            <button id="confirmDelete" style="padding:10px 20px;border:none;background:#ef4444;color:white;border-radius:8px;cursor:pointer;font-weight:600;transition:all 0.2s;">
                Delete Files
            </button>
        </div>
    `;

  modal.appendChild(modalContent);
  document.body.appendChild(modal);

  // ✅ Add CSS animations
  const style = document.createElement("style");
  style.textContent = `
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        @keyframes slideUp {
            from { transform: translateY(20px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
        #confirmDelete:hover {
            background: #dc2626 !important;
            transform: scale(1.05);
        }
        #cancelDelete:hover {
            background: #f3f4f6 !important;
            border-color: #9ca3af !important;
        }
    `;
  document.head.appendChild(style);

  // ✅ Wait for user decision
  return new Promise((resolve) => {
    // Inside deleteFiles(), after successful deletion:

    document.getElementById("confirmDelete").onclick = () => {
      document.body.removeChild(modal);
      document.head.removeChild(style);

      // ✅ Save selection BEFORE deletion
      saveSelectionState();

      // ✅ Perform deletion
      const indicesToDelete = [];
      filesToProcess.forEach((fileToDelete) => {
        const index = files.indexOf(fileToDelete);
        if (index !== -1) {
          indicesToDelete.push(index);
        }
      });

      // Sort in reverse to delete from end first
      indicesToDelete.sort((a, b) => b - a);

      // Delete files
      indicesToDelete.forEach((index) => {
        revokeFileURLs(index);
        cleanupPDFPreview(index);
        files.splice(index, 1);
        selectedIndices.delete(index);
      });

      // Update UI
      showPreview();
      updateFileCount();

      if (files.length === 0) {
        document.getElementById("thumbnailControls").style.display = "none";
        document.getElementById("batchControls").style.display = "none";
        clearSelectionHistory(); // ✅ Clear history when no files left
      }

      showSuccess(
        `${indicesToDelete.length} file${
          indicesToDelete.length !== 1 ? "s" : ""
        } deleted successfully!`
      );
      resolve();
    };

    document.getElementById("cancelDelete").onclick = () => {
      document.body.removeChild(modal);
      document.head.removeChild(style);
      showError("Deletion cancelled", "info");
      resolve();
    };

    // Close on background click
    modal.onclick = (e) => {
      if (e.target === modal) {
        document.getElementById("cancelDelete").click();
      }
    };
  });
}

// ✅ Image filters
const IMAGE_FILTERS = {
  grayscale: (imageData) => {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
      data[i] = avg; // R
      data[i + 1] = avg; // G
      data[i + 2] = avg; // B
    }
    return imageData;
  },

  sepia: (imageData) => {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      data[i] = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189);
      data[i + 1] = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168);
      data[i + 2] = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131);
    }
    return imageData;
  },

  invert: (imageData) => {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255 - data[i]; // R
      data[i + 1] = 255 - data[i + 1]; // G
      data[i + 2] = 255 - data[i + 2]; // B
    }
    return imageData;
  },

  brightness: (imageData, value = 50) => {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.min(255, Math.max(0, data[i] + value));
      data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + value));
      data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + value));
    }
    return imageData;
  },

  contrast: (imageData, value = 50) => {
    const data = imageData.data;
    const factor = (259 * (value + 255)) / (255 * (259 - value));

    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.min(255, Math.max(0, factor * (data[i] - 128) + 128));
      data[i + 1] = Math.min(
        255,
        Math.max(0, factor * (data[i + 1] - 128) + 128)
      );
      data[i + 2] = Math.min(
        255,
        Math.max(0, factor * (data[i + 2] - 128) + 128)
      );
    }
    return imageData;
  },

  vintage: (imageData) => {
    // Combine sepia + slight blur + vignette effect
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      data[i] = Math.min(255, r * 0.4 + g * 0.8 + b * 0.2);
      data[i + 1] = Math.min(255, r * 0.35 + g * 0.7 + b * 0.15);
      data[i + 2] = Math.min(255, r * 0.3 + g * 0.5 + b * 0.1);
    }
    return imageData;
  },

  blur: (imageData) => {
    // Simple box blur
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    const tempData = new Uint8ClampedArray(data);

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4;

        for (let c = 0; c < 3; c++) {
          let sum = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const i = ((y + dy) * width + (x + dx)) * 4 + c;
              sum += tempData[i];
            }
          }
          data[idx + c] = sum / 9;
        }
      }
    }
    return imageData;
  },
};

async function applyFilters(filesToProcess) {
  // ✅ Ask user for filter type
  const filterChoice = prompt(
    "Choose a filter:\n" +
      "1 = Grayscale\n" +
      "2 = Sepia\n" +
      "3 = Invert\n" +
      "4 = Brightness (+50)\n" +
      "5 = Contrast (+50)\n" +
      "6 = Vintage\n" +
      "7 = Blur\n\n" +
      "Enter number (1-7):",
    "1"
  );

  if (filterChoice === null) {
    showError("Filter cancelled");
    return;
  }

  const filterMap = {
    1: "grayscale",
    2: "sepia",
    3: "invert",
    4: "brightness",
    5: "contrast",
    6: "vintage",
    7: "blur",
  };

  const filterName = filterMap[filterChoice];
  if (!filterName) {
    showError("Invalid filter choice!");
    return;
  }

  const zip = new JSZip();
  startProgressTiming(filesToProcess.length);

  for (let i = 0; i < filesToProcess.length; i++) {
    const file = filesToProcess[i];

    // ✅ Only filter images
    if (!VALID_IMAGE_TYPES.includes(file.type)) {
      zip.file(file.name, file);
      continue;
    }

    try {
      const img = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");

      ctx.drawImage(img, 0, 0);

      // ✅ Apply filter
      let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      imageData = IMAGE_FILTERS[filterName](imageData);
      ctx.putImageData(imageData, 0, 0);

      // Convert to blob
      const blob = await new Promise((resolve) => {
        canvas.toBlob(resolve, "image/jpeg", 0.95);
      });

      const newName = file.name.replace(/(\.[^.]+)$/, `_${filterName}$1`);
      zip.file(newName, blob);
    } catch (error) {
      showError(`Failed to filter ${file.name}: ${error.message}`, "warning");
      zip.file(file.name, file);
    }

    updateProgress(
      ((i + 1) / filesToProcess.length) * 100,
      `Applying ${filterName} filter ${i + 1}/${filesToProcess.length}`,
      i + 1,
      filesToProcess.length
    );
  }

  const content = await zip.generateAsync({ type: "blob" });
  const url = createTrackedURL(content);
  const a = document.createElement("a");
  a.href = url;
  a.download = `filtered_${filterName}_${Date.now()}.zip`;
  a.click();

  showSuccess(`${filterName} filter applied successfully!`);
}

// Add sanitization function
function sanitizeText(text) {
  if (!text || typeof text !== "string") return "";
  // Escape HTML special characters
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;");
}

async function performOCR(filesToProcess) {
  let fullText = "";

  for (let i = 0; i < filesToProcess.length; i++) {
    updateProgress(
      (i / filesToProcess.length) * 100,
      `Extracting text ${i + 1}/${filesToProcess.length}`
    );

    const file = filesToProcess[i];
    const {
      data: { text },
    } = await Tesseract.recognize(file, "eng");

    // Sanitize filename before using
    const safeFilename = sanitizeText(file.name);
    fullText += `\n\n--- ${safeFilename} ---\n${text}`;
  }

  const blob = new Blob([fullText], { type: "text/plain" });
  const url = createTrackedURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = sanitizeFileName(`extracted_text_${Date.now()}.txt`);
  a.click();

  showSuccess("Text extracted successfully!");
}

// Also update sanitizeFileName to be more secure
function sanitizeFileName(name) {
  if (!name || typeof name !== "string") return "file";
  // Remove any path traversal attempts and dangerous chars
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/^\.+/, "")
    .substring(0, 255); // Limit length
}

function showProgress() {
  document.getElementById("progressContainer").style.display = "block";
  document.getElementById("convertBtn").disabled = true;
}

function hideProgress() {
  document.getElementById("progressContainer").style.display = "none";
  document.getElementById("convertBtn").disabled = false;
}

function updateProgress(
  percent,
  label,
  currentIndex = null,
  totalCount = null
) {
  const progressBar = document.getElementById("progressBar");
  const progressPercent = progressBar.querySelector(".progress-percent");
  const progressLabel = document.getElementById("progressLabel");

  progressBar.style.width = percent + "%";
  progressPercent.textContent = Math.round(percent) + "%";

  // ✅ Add timing info
  if (currentIndex !== null && totalCount !== null) {
    const timing = updateProgressTiming(currentIndex);
    if (timing) {
      progressLabel.innerHTML = `
                ${label}<br>
                <small style="opacity:0.8;">
                    ⏱️ ${timing.remaining} remaining • 
                    🚀 ${timing.speed} files/sec • 
                    ⏳ ${timing.elapsed} elapsed
                </small>
            `;
      return;
    }
  }

  progressLabel.textContent = label;
}

function showError(message) {
  const errorDiv = document.getElementById("errorMessage");
  errorDiv.textContent = message;
  errorDiv.style.display = "block";
}

function hideError() {
  document.getElementById("errorMessage").style.display = "none";
}

// ✅ Add timer tracking
let successTimer = null;
// ✅ Error queue system
let errorQueue = [];
let errorTimers = [];
let isShowingError = false;

function showError(message, priority = "error") {
  // Add to queue
  errorQueue.push({
    message: message,
    priority: priority, // 'error', 'warning', 'info'
    timestamp: Date.now(),
  });

  // If not currently showing error, start showing
  if (!isShowingError) {
    showNextError();
  }
}

function showNextError() {
  if (errorQueue.length === 0) {
    isShowingError = false;
    return;
  }

  isShowingError = true;
  const error = errorQueue.shift();

  const errorDiv = document.getElementById("errorMessage");

  // ✅ Add priority styling
  errorDiv.className = "message error-message"; // Reset classes
  if (error.priority === "warning") {
    errorDiv.style.background = "#f59e0b";
  } else if (error.priority === "info") {
    errorDiv.style.background = "#3b82f6";
  } else {
    errorDiv.style.background = "#ef4444";
  }

  // ✅ Show queue count if more than 1
  const queueCount = errorQueue.length;
  const queueBadge =
    queueCount > 0
      ? ` <span style="background:rgba(0,0,0,0.2);padding:2px 8px;border-radius:10px;font-size:12px;margin-left:8px;">${
          queueCount + 1
        } errors</span>`
      : "";

  errorDiv.innerHTML = `
        ${error.message}
        ${queueBadge}
        <button onclick="clearErrorQueue()" style="margin-left:10px;background:rgba(255,255,255,0.2);border:none;padding:4px 12px;border-radius:4px;cursor:pointer;color:white;font-size:12px;">
            Dismiss All
        </button>
    `;
  errorDiv.style.display = "block";

  // ✅ Auto-hide after 4 seconds, then show next
  const timer = setTimeout(() => {
    hideError();
    setTimeout(() => {
      showNextError();
    }, 300); // Small delay before next
  }, 4000);

  errorTimers.push(timer);
}

function clearErrorQueue() {
  errorQueue = [];
  errorTimers.forEach((timer) => clearTimeout(timer));
  errorTimers = [];
  hideError();
  isShowingError = false;
}

function hideError() {
  const errorDiv = document.getElementById("errorMessage");
  errorDiv.style.display = "none";
  errorDiv.style.background = "#ef4444"; // Reset to default
}

let successTimerPaused = false;

function showSuccess(message, duration = 5000) {
  const successDiv = document.getElementById("successMessage");
  successDiv.textContent = message;
  successDiv.style.display = "block";

  // ✅ Clear previous timer
  if (successTimer) {
    clearTimeout(successTimer);
  }

  // ✅ Auto-hide after duration
  successTimerPaused = false;
  successTimer = setTimeout(() => {
    if (!successTimerPaused) {
      hideSuccess();
    }
  }, duration);

  // ✅ Pause on hover
  successDiv.onmouseenter = () => {
    successTimerPaused = true;
  };

  successDiv.onmouseleave = () => {
    successTimerPaused = false;
    successTimer = setTimeout(() => {
      hideSuccess();
    }, 2000); // Continue after 2s
  };
}

function hideSuccess() {
  const successDiv = document.getElementById("successMessage");
  successDiv.style.display = "none";

  // ✅ Clear timer
  if (successTimer) {
    clearTimeout(successTimer);
    successTimer = null;
  }

  // ✅ Remove event listeners
  successDiv.onmouseenter = null;
  successDiv.onmouseleave = null;
}

function showInfo(message) {
  const infoDiv = document.getElementById("infoMessage");
  infoDiv.textContent = message;
  infoDiv.style.display = "block";
}

function hideInfo() {
  document.getElementById("infoMessage").style.display = "none";
}
