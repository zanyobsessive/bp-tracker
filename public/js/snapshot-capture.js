// Snapshot Capture JavaScript
const API_BASE_URL = 'https://mkou7ep3mh.execute-api.us-east-1.amazonaws.com/prod';
const SNAPSHOT_PASSWORD = 'business school';

let currentStream = null;
let autoCaptureInterval = null;
let nextCaptureTime = null;

// DOM Elements
const authSection = document.getElementById('authSection');
const captureSection = document.getElementById('captureSection');
const authPassword = document.getElementById('authPassword');
const authBtn = document.getElementById('authBtn');
const cameraSelect = document.getElementById('cameraSelect');
const videoPreview = document.getElementById('videoPreview');
const videoContainer = document.getElementById('videoContainer');
const videoOverlay = document.getElementById('videoOverlay');
const noCameraMessage = document.getElementById('noCameraMessage');
const captureBtn = document.getElementById('captureBtn');
const autoCapture = document.getElementById('autoCapture');
const intervalInput = document.getElementById('intervalInput');
const deleteBtn = document.getElementById('deleteBtn');
const cameraStatus = document.getElementById('cameraStatus');
const lastCaptureTime = document.getElementById('lastCaptureTime');
const uploadStatus = document.getElementById('uploadStatus');
const autoCaptureStatus = document.getElementById('autoCaptureStatus');
const nextCaptureInfo = document.getElementById('nextCaptureInfo');
const currentSnapshot = document.getElementById('currentSnapshot');
const noSnapshotMessage = document.getElementById('noSnapshotMessage');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  checkExistingAuth();
});

function setupEventListeners() {
  authBtn.addEventListener('click', authenticate);
  authPassword.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') authenticate();
  });

  cameraSelect.addEventListener('change', switchCamera);
  captureBtn.addEventListener('click', captureSnapshot);
  autoCapture.addEventListener('change', toggleAutoCapture);
  deleteBtn.addEventListener('click', deleteSnapshot);
}

function checkExistingAuth() {
  // Check if already authenticated in this session
  if (sessionStorage.getItem('snapshot_auth') === 'true') {
    showCaptureInterface();
  }
}

function authenticate() {
  if (authPassword.value === SNAPSHOT_PASSWORD) {
    sessionStorage.setItem('snapshot_auth', 'true');
    showCaptureInterface();
  } else {
    authPassword.classList.add('error');
    authPassword.value = '';
    authPassword.placeholder = 'Incorrect password';
    setTimeout(() => {
      authPassword.classList.remove('error');
      authPassword.placeholder = 'Enter password';
    }, 2000);
  }
}

async function showCaptureInterface() {
  authSection.style.display = 'none';
  captureSection.classList.add('active');

  await loadCameras();
  await loadCurrentSnapshot();
}

async function loadCameras() {
  try {
    // Request permission first to get labels
    const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
    tempStream.getTracks().forEach(track => track.stop());

    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(device => device.kind === 'videoinput');

    cameraSelect.innerHTML = '<option value="">Select a camera...</option>';

    videoDevices.forEach((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `Camera ${index + 1}`;
      cameraSelect.appendChild(option);
    });

    // Auto-select if only one camera or restore previous selection
    const savedCamera = localStorage.getItem('bp_snapshot_camera');
    if (savedCamera && videoDevices.some(d => d.deviceId === savedCamera)) {
      cameraSelect.value = savedCamera;
      await switchCamera();
    } else if (videoDevices.length === 1) {
      cameraSelect.value = videoDevices[0].deviceId;
      await switchCamera();
    }

    cameraStatus.textContent = `${videoDevices.length} camera(s) found`;
    cameraStatus.className = 'status-value success';
  } catch (error) {
    console.error('Error loading cameras:', error);
    cameraStatus.textContent = 'Camera access denied';
    cameraStatus.className = 'status-value error';
    noCameraMessage.style.display = 'block';
    videoContainer.style.display = 'none';
  }
}

async function switchCamera() {
  const deviceId = cameraSelect.value;

  // Stop existing stream
  if (currentStream) {
    currentStream.getTracks().forEach(track => track.stop());
    currentStream = null;
  }

  if (!deviceId) {
    videoContainer.style.display = 'none';
    noCameraMessage.style.display = 'block';
    cameraStatus.textContent = 'No camera selected';
    cameraStatus.className = 'status-value warning';
    return;
  }

  try {
    currentStream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: { exact: deviceId },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });

    videoPreview.srcObject = currentStream;
    videoContainer.style.display = 'block';
    noCameraMessage.style.display = 'none';

    // Save preference
    localStorage.setItem('bp_snapshot_camera', deviceId);

    cameraStatus.textContent = 'Connected';
    cameraStatus.className = 'status-value success';
  } catch (error) {
    console.error('Error switching camera:', error);
    cameraStatus.textContent = 'Connection failed';
    cameraStatus.className = 'status-value error';
    videoContainer.style.display = 'none';
    noCameraMessage.style.display = 'block';
  }
}

async function captureSnapshot() {
  if (!currentStream) {
    uploadStatus.textContent = 'No camera connected';
    uploadStatus.className = 'status-value error';
    return;
  }

  captureBtn.disabled = true;
  captureBtn.textContent = 'Capturing...';
  uploadStatus.textContent = 'Capturing...';
  uploadStatus.className = 'status-value warning';

  try {
    // Create canvas and capture frame
    const canvas = document.createElement('canvas');
    const video = videoPreview;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    // Convert to blob
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));

    // Get presigned URL
    uploadStatus.textContent = 'Getting upload URL...';
    const urlResponse = await fetch(`${API_BASE_URL}/snapshot/upload-url`);
    if (!urlResponse.ok) throw new Error('Failed to get upload URL');

    const { uploadUrl } = await urlResponse.json();

    // Upload to S3
    uploadStatus.textContent = 'Uploading...';
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      body: blob,
      headers: {
        'Content-Type': 'image/jpeg',
      },
    });

    if (!uploadResponse.ok) throw new Error('Upload failed');

    // Success
    const now = new Date();
    lastCaptureTime.textContent = formatTime(now);
    uploadStatus.textContent = 'Uploaded successfully';
    uploadStatus.className = 'status-value success';

    // Flash effect
    videoOverlay.textContent = 'Captured!';
    videoOverlay.classList.add('recording');
    setTimeout(() => {
      videoOverlay.textContent = autoCapture.checked ? 'Auto-capturing' : 'Preview';
      videoOverlay.classList.remove('recording');
    }, 1000);

    // Refresh the current snapshot preview
    await loadCurrentSnapshot();

  } catch (error) {
    console.error('Capture error:', error);
    uploadStatus.textContent = 'Upload failed';
    uploadStatus.className = 'status-value error';
  } finally {
    captureBtn.disabled = false;
    captureBtn.textContent = 'Capture Now';
  }
}

function toggleAutoCapture() {
  if (autoCapture.checked) {
    const interval = parseInt(intervalInput.value, 10) || 60;
    startAutoCapture(interval);
  } else {
    stopAutoCapture();
  }
}

function startAutoCapture(intervalSeconds) {
  stopAutoCapture(); // Clear any existing interval

  autoCaptureStatus.textContent = `Every ${intervalSeconds}s`;
  autoCaptureStatus.className = 'status-value success';
  videoOverlay.textContent = 'Auto-capturing';
  videoOverlay.classList.add('recording');

  // Capture immediately
  captureSnapshot();

  // Set up interval
  autoCaptureInterval = setInterval(() => {
    captureSnapshot();
  }, intervalSeconds * 1000);

  // Update countdown
  updateNextCaptureTime(intervalSeconds);
}

function stopAutoCapture() {
  if (autoCaptureInterval) {
    clearInterval(autoCaptureInterval);
    autoCaptureInterval = null;
  }

  autoCaptureStatus.textContent = 'Disabled';
  autoCaptureStatus.className = 'status-value';
  videoOverlay.textContent = 'Preview';
  videoOverlay.classList.remove('recording');
  nextCaptureInfo.textContent = '';
}

function updateNextCaptureTime(intervalSeconds) {
  if (!autoCapture.checked) return;

  let secondsLeft = intervalSeconds;

  const updateCountdown = () => {
    if (!autoCapture.checked) return;

    nextCaptureInfo.textContent = `Next capture in ${secondsLeft}s`;
    secondsLeft--;

    if (secondsLeft < 0) {
      secondsLeft = intervalSeconds;
    }
  };

  updateCountdown();
  setInterval(updateCountdown, 1000);
}

async function deleteSnapshot() {
  if (!confirm('Are you sure you want to delete the current snapshot? This will remove it from the public site.')) {
    return;
  }

  deleteBtn.disabled = true;
  deleteBtn.textContent = 'Deleting...';

  try {
    const response = await fetch(`${API_BASE_URL}/snapshot`, {
      method: 'DELETE',
    });

    if (!response.ok) throw new Error('Delete failed');

    deleteBtn.textContent = 'Deleted!';
    currentSnapshot.style.display = 'none';
    noSnapshotMessage.style.display = 'block';
    noSnapshotMessage.textContent = 'Snapshot deleted';

    setTimeout(() => {
      deleteBtn.textContent = 'Delete Current Snapshot';
      deleteBtn.disabled = false;
    }, 2000);

  } catch (error) {
    console.error('Delete error:', error);
    deleteBtn.textContent = 'Delete failed';
    setTimeout(() => {
      deleteBtn.textContent = 'Delete Current Snapshot';
      deleteBtn.disabled = false;
    }, 2000);
  }
}

async function loadCurrentSnapshot() {
  try {
    const response = await fetch(`${API_BASE_URL}/snapshot/meta`);
    if (!response.ok) throw new Error('Failed to load metadata');

    const meta = await response.json();

    if (meta.exists) {
      // Add cache-busting parameter
      currentSnapshot.src = `${meta.url}?t=${Date.now()}`;
      currentSnapshot.style.display = 'block';
      noSnapshotMessage.style.display = 'none';
    } else {
      currentSnapshot.style.display = 'none';
      noSnapshotMessage.style.display = 'block';
      noSnapshotMessage.textContent = 'No snapshot uploaded yet';
    }
  } catch (error) {
    console.error('Error loading snapshot:', error);
  }
}

function formatTime(date) {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
}

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  if (currentStream) {
    currentStream.getTracks().forEach(track => track.stop());
  }
  stopAutoCapture();
});
