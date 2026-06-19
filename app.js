// =========================================================
// CONFIG
// =========================================================
// The real n8n webhook URL is NOT here. The browser talks only to our
// own same-origin serverless proxy, which holds WEBHOOK_URL server-side.
import { getSession } from "./auth.js";

const ENDPOINT = "/api/generate";

// Client-side guards (mirrored & enforced again on the server).
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per image

// =========================================================
// STATE
// =========================================================
let file1 = null;
let file2 = null;
let resultObjectUrl = null; // track blob URL so we can revoke it
let isSubmitting = false;

// =========================================================
// ELEMENT REFS
// =========================================================
const input1 = document.getElementById("image1");
const input2 = document.getElementById("image2");
const generateBtn = document.getElementById("generateBtn");

const stateEmpty = document.getElementById("stateEmpty");
const stateLoading = document.getElementById("stateLoading");
const stateSuccess = document.getElementById("stateSuccess");
const resultImg = document.getElementById("resultImg");

// =========================================================
// VALIDATION
// =========================================================
function validateFile(file) {
  if (!file) return "No file selected.";
  if (!ALLOWED_TYPES.includes(file.type)) {
    return "Unsupported file type. Use JPG, PNG or WEBP.";
  }
  if (file.size === 0) return "The selected file is empty.";
  if (file.size > MAX_FILE_BYTES) {
    return "File is too large. Maximum size is 10 MB.";
  }
  return null; // valid
}

// =========================================================
// UPLOAD HANDLING + PREVIEW
// =========================================================
function clearSlot(slot) {
  if (slot === 1) file1 = null;
  else file2 = null;

  const previewWrap = document.getElementById("preview" + slot);
  const thumb = document.getElementById("thumb" + slot);
  const filenameEl = document.getElementById("filename" + slot);

  previewWrap.classList.remove("is-visible");
  thumb.removeAttribute("src");
  filenameEl.textContent = "Nije odabrana datoteka";
}

function handleFileSelect(input, slot) {
  const file = input.files && input.files[0];

  if (!file) {
    clearSlot(slot);
    updateButtonState();
    return;
  }

  // Reject anything that fails validation BEFORE storing/previewing it.
  const error = validateFile(file);
  if (error) {
    alert(error);
    input.value = ""; // reset the native input
    clearSlot(slot);
    updateButtonState();
    return;
  }

  if (slot === 1) file1 = file;
  else file2 = file;

  const previewWrap = document.getElementById("preview" + slot);
  const thumb = document.getElementById("thumb" + slot);
  const filenameEl = document.getElementById("filename" + slot);

  // Build a thumbnail preview
  const reader = new FileReader();
  reader.onload = (e) => {
    thumb.src = e.target.result;
    filenameEl.textContent = file.name;
    previewWrap.classList.add("is-visible");
  };
  reader.onerror = () => {
    alert("Could not read the selected file.");
    input.value = "";
    clearSlot(slot);
    updateButtonState();
  };
  reader.readAsDataURL(file);

  updateButtonState();
}

input1.addEventListener("change", () => handleFileSelect(input1, 1));
input2.addEventListener("change", () => handleFileSelect(input2, 2));

// Enable the button only when BOTH valid files are selected (and not mid-request)
function updateButtonState() {
  generateBtn.disabled = !(file1 && file2) || isSubmitting;
}

// =========================================================
// OUTPUT STATE SWITCHING
// =========================================================
function setOutputState(state) {
  stateEmpty.classList.toggle("is-active", state === "empty");
  stateLoading.classList.toggle("is-active", state === "loading");
  stateSuccess.classList.toggle("is-active", state === "success");
}

// =========================================================
// GENERATE: build FormData, POST to proxy, render Blob response
// =========================================================
async function generate() {
  if (!file1 || !file2 || isSubmitting) return;

  // Re-validate at submit time (defence in depth).
  const error = validateFile(file1) || validateFile(file2);
  if (error) {
    alert(error);
    return;
  }

  // 1. Construct payload
  const formData = new FormData();
  formData.append("image1", file1);
  formData.append("image2", file2);

  // Loading state + lock button
  isSubmitting = true;
  generateBtn.disabled = true;
  setOutputState("loading");

  // Abort the request if it hangs too long.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000); // 2 min

  try {
    // The proxy requires a paying user — attach the Supabase access token.
    const session = await getSession();
    if (!session) {
      window.location.replace("login.html");
      return;
    }

    // 2. Make the request — do NOT set Content-Type manually,
    //    the browser sets the multipart boundary automatically.
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: "Bearer " + session.access_token },
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error("Server returned status " + response.status);
    }

    // 3a. Verify we actually got an image before trusting the bytes.
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      throw new Error("Unexpected response type: " + contentType);
    }

    // 3b. Handle binary image response as a Blob
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) {
      throw new Error("Unexpected blob type: " + blob.type);
    }

    // Revoke any previous object URL to avoid memory leaks
    if (resultObjectUrl) {
      URL.revokeObjectURL(resultObjectUrl);
    }
    resultObjectUrl = URL.createObjectURL(blob);

    resultImg.src = resultObjectUrl;
    setOutputState("success");
  } catch (err) {
    // 4. Error handling — never surface internal details to the user.
    console.error(err);
    alert("Failed to generate image. Please try again.");
    setOutputState("empty");
  } finally {
    // Always reset loading state / re-enable the button
    clearTimeout(timeout);
    isSubmitting = false;
    updateButtonState();
  }
}

generateBtn.addEventListener("click", generate);

// Clean up the last object URL on unload
window.addEventListener("beforeunload", () => {
  if (resultObjectUrl) URL.revokeObjectURL(resultObjectUrl);
});
