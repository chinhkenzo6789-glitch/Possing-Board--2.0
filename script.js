const STYLES = ["Đứng", "Chạm", "Đi", "Tựa", "Ngồi", "Groom", "Bride", "PSC"];
const API_KEY_STORAGE = "posingboard_openai_api_key";
const AUTH_STORAGE_KEY = "posingboard_auth_v2";
const APPS_SCRIPT_URL = resolveAppsScriptUrl();
const CLOUDINARY_CONFIG = resolveCloudinaryConfig();
const REMOTE_SAVE_DEBOUNCE = 450;
const BOARD_OFFSET = 6000;
const MIN_WIDTH = 120;
const HISTORY_LIMIT = 80;
const DUPLICATE_OFFSET = 40;

const styleData = {};
let poseDetector = null;
let poseDetectorPromise = null;

function createEmptyStyleState() {
  return {
    nodes: [],
    connections: [],
    pan: { x: BOARD_OFFSET, y: BOARD_OFFSET },
    zoom: 1,
    shotChecks: {},
  };
}

STYLES.forEach((style) => {
  styleData[style] = createEmptyStyleState();
});

let currentStyle = "Đứng";

const state = {
  nextId: 1,
  mode: "pan",
  pendingImages: [],
  selectedIds: new Set(),
  clipboard: null,
  saveTimer: null,
  saveInFlight: null,
  pendingSnapshot: null,
  history: { undo: [], redo: [] },
  isRestoringHistory: false,
  drag: null,
  resize: null,
  pan: null,
  marquee: null,
  skipCanvasClickClear: false,
  boardPinch: null,
  connect: null,
  tempLine: null,
  contextNodeId: null,
  editNodeId: null,
  canvasContextPos: { x: 0, y: 0 },
  viewer: {
    open: false,
    list: [],
    index: -1,
    touchStartX: 0,
    touchDeltaX: 0,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    pan: null,
    pinch: null,
  },
  presenter: { open: false, list: [], index: -1 },
  shotListOpen: false,
  aiLoadingNodeId: null,
  lastRemoteSnapshot: "",
  auth: {
    token: "",
    username: "",
    password: "",
    remember: false,
    user: null,
    bootstrapped: false,
    syncTimer: null,
  },
  firebaseBoardListener: null,
};

const canvasWrapper = document.getElementById("canvas-wrapper");
const canvas = document.getElementById("canvas");
const selectionMarquee = document.getElementById("selection-marquee");
const svg = document.getElementById("connections-svg");
const zoomLabel = document.getElementById("zoom-label");
const styleBadge = document.getElementById("current-style-badge");
const authOverlay = document.getElementById("auth-overlay");
const authForm = document.getElementById("auth-form");
const authUsername = document.getElementById("auth-username");
const authPassword = document.getElementById("auth-password");
const authRemember = document.getElementById("auth-remember");
const authError = document.getElementById("auth-error");
const authSubmit = document.getElementById("auth-submit");
const authProgress = document.getElementById("auth-progress");
const authProgressTitle = document.getElementById("auth-progress-title");
const authProgressFill = document.getElementById("auth-progress-fill");
const authProgressNote = document.getElementById("auth-progress-note");
const authUserBadge = document.getElementById("auth-user");
const logoutButton = document.getElementById("btn-logout");

const modalOverlay = document.getElementById("modal-overlay");
const previewArea = document.getElementById("preview-area");
const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const urlInput = document.getElementById("url-input");
const nodeTitleInp = document.getElementById("node-title");
const nodeNoteInp = document.getElementById("node-note");
const uploadProgress = document.getElementById("upload-progress");
const uploadProgressFill = document.getElementById("upload-progress-fill");
const uploadProgressText = document.getElementById("upload-progress-text");

const editOverlay = document.getElementById("edit-modal-overlay");
const editTitle = document.getElementById("edit-title");
const editOrder = document.getElementById("edit-order");
const editNote = document.getElementById("edit-note");
const editAiNote = document.getElementById("edit-ai-note");

const layoutMenu = document.getElementById("layout-menu");
const styleDropBtn = document.getElementById("style-dropdown-btn");
const styleDropMenu = document.getElementById("style-dropdown-menu");
const nodeCtxMenu = document.getElementById("context-menu");
const canvasCtxMenu = document.getElementById("canvas-context-menu");

const selectionToolbar = document.getElementById("selection-toolbar");
const selectionCountEl = document.getElementById("selection-count");

const shotListPanel = document.getElementById("shot-list-panel");
const shotListBody = document.getElementById("shot-list-body");
const shotListSubtitle = document.getElementById("shot-list-subtitle");

const viewer = document.getElementById("image-viewer");
const viewerStage = document.getElementById("viewer-stage");
const viewerImage = document.getElementById("viewer-image");
const viewerOrder = document.getElementById("viewer-order");
const viewerStyle = document.getElementById("viewer-style");
const viewerTitle = document.getElementById("viewer-title");
const viewerNote = document.getElementById("viewer-note");

const presenter = document.getElementById("presenter-overlay");
const presenterImage = document.getElementById("presenter-image");
const presenterOrder = document.getElementById("presenter-order");
const presenterStyle = document.getElementById("presenter-style");
const presenterTitle = document.getElementById("presenter-title");
const presenterNote = document.getElementById("presenter-note");

function ensureMultiSelectTool() {
  let button = document.getElementById("tool-multi-select");
  if (button) return button;

  const sidebar = document.querySelector(".left-sidebar");
  if (!sidebar) return null;

  button = document.createElement("button");
  button.className = "sidebar-tool";
  button.id = "tool-multi-select";
  button.type = "button";
  button.title = "Chon nhieu (M)";
  button.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2.5" y="4" width="6" height="6" rx="1.6" stroke="currentColor" stroke-width="1.4" />
      <rect x="11.5" y="4" width="6" height="6" rx="1.6" stroke="currentColor" stroke-width="1.4" />
      <rect x="7" y="11" width="6" height="6" rx="1.6" stroke="currentColor" stroke-width="1.4" />
    </svg>
    <span class="sidebar-label">Multi</span>
    <span class="sidebar-key">M</span>
  `;

  const divider = sidebar.querySelector(".sidebar-divider");
  if (divider) sidebar.insertBefore(button, divider);
  else sidebar.appendChild(button);
  return button;
}

function cs() {
  return styleData[currentStyle];
}

function uid() {
  state.nextId += 1;
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return `n${window.crypto.randomUUID()}`;
  }
  return `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function cuid() {
  return `c${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function resolveCloudinaryConfig() {
  const config = window.POSINGBOARD_CONFIG && window.POSINGBOARD_CONFIG.cloudinary;
  return {
    cloudName: normalizeText(config && config.cloudName),
    uploadPreset: normalizeText(config && config.uploadPreset),
    folder: normalizeText(config && config.folder),
  };
}

function resolveAppsScriptUrl() {
  const configured = normalizeText(window.POSINGBOARD_CONFIG && window.POSINGBOARD_CONFIG.appsScriptUrl);
  return configured;
}

function getFirebaseBoardBridge() {
  return window.PosingBoardFirebase || null;
}

function getFirebaseBoardRef() {
  const bridge = getFirebaseBoardBridge();
  return bridge && bridge.ready ? bridge.boardRef : null;
}

function assertFirebaseBoardReady() {
  const bridge = getFirebaseBoardBridge();
  if (!bridge || !bridge.ready || !bridge.boardRef) {
    throw new Error(bridge?.error || "Chưa cấu hình Firebase Realtime Database trong config.js");
  }
  return bridge.boardRef;
}

function clearLegacyBoardStorage() {
  ["posingboard_v4_cache", "posingboard_v4", "posingboard_v3", "posingboard_v2"].forEach((key) => {
    localStorage.removeItem(key);
  });
}

function readStoredAuth() {
  const raw = localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      username: normalizeText(parsed.username),
      password: String(parsed.password || ""),
      remember: !!parsed.remember,
      user: parsed.user && typeof parsed.user === "object" ? parsed.user : null,
    };
  } catch (error) {
    console.warn("Auth cache load failed", error);
    return null;
  }
}

function persistAuth() {
  if (!state.auth.user) {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    return;
  }

  localStorage.setItem(
    AUTH_STORAGE_KEY,
    JSON.stringify({
      username: state.auth.username || "",
      password: state.auth.remember ? state.auth.password || "" : "",
      remember: !!state.auth.remember,
      user: state.auth.user,
    })
  );
}

function setAuthError(message = "") {
  if (!authError) return;
  authError.hidden = !message;
  authError.textContent = message;
}

function setAuthProgress(phase = "idle", note = "") {
  if (!authProgress || !authProgressTitle || !authProgressFill || !authProgressNote) return;

  const phases = {
    idle: { visible: false, title: "Dang dang nhap...", note: "", progress: 0 },
    signing_in: { visible: true, title: "Dang dang nhap...", note: note || "Dang ket noi Google Sheet", progress: 22 },
    signed_in: { visible: true, title: "Dang nhap thanh cong", note: note || "Thong tin hop le, dang tiep tuc", progress: 48 },
    checking: { visible: true, title: "Dang kiem tra tai khoan...", note: note || "Dang xac nhan quyen truy cap", progress: 68 },
    opening: { visible: true, title: "Dang mo du an...", note: note || "Dang tai du lieu du an", progress: 88 },
    complete: { visible: true, title: "Dang mo du an...", note: note || "San sang", progress: 100 },
  };

  const current = phases[phase] || phases.idle;
  authProgress.hidden = !current.visible;
  authProgressTitle.textContent = current.title;
  authProgressNote.textContent = current.note;
  authProgressFill.style.width = `${current.progress}%`;
}

function setAuthSubmitting(isSubmitting, label = "") {
  if (!authSubmit) return;
  authSubmit.disabled = isSubmitting;
  authSubmit.textContent = isSubmitting ? "Đang đăng nhập, vui lòng chờ..." : "Đăng nhập";
}

function setAuthSubmitting(isSubmitting, label = "") {
  if (!authSubmit) return;
  authSubmit.disabled = isSubmitting;
  authSubmit.textContent = isSubmitting ? (label || "Dang dang nhap...") : "Dang nhap";
}

function updateAuthUI() {
  const user = state.auth.user;
  if (authUserBadge) {
    authUserBadge.hidden = !user;
    authUserBadge.textContent = user?.displayName || user?.username || "";
  }
  if (logoutButton) {
    logoutButton.hidden = !user;
  }
  if (authOverlay) {
    authOverlay.classList.toggle("open", !user);
    authOverlay.setAttribute("aria-hidden", user ? "true" : "false");
  }
}

function setAuthState(token, user) {
  state.auth.token = normalizeText(token);
  state.auth.user = user || null;
  persistAuth();
  updateAuthUI();
}

function clearAuthState() {
  if (state.firebaseBoardListener) {
    state.firebaseBoardListener();
    state.firebaseBoardListener = null;
  }
  if (state.auth.syncTimer) {
    window.clearInterval(state.auth.syncTimer);
    state.auth.syncTimer = null;
  }
  state.auth.token = "";
  state.auth.user = null;
  state.auth.username = "";
  state.auth.password = "";
  state.auth.remember = false;
  persistAuth();
  updateAuthUI();
  state.auth.bootstrapped = false;
  state.lastRemoteSnapshot = "";
  setAuthError("");
  setAuthSubmitting(false);
  setAuthProgress("idle");
}

function getAuthHeaders(initHeaders) {
  const headers = new Headers(initHeaders || {});
  if (state.auth.token) headers.set("Authorization", `Bearer ${state.auth.token}`);
  return headers;
}

function restoreSavedUsername() {
  const stored = readStoredAuth();
  state.auth.token = "";
  state.auth.user = null;
  state.auth.username = "";
  state.auth.password = "";
  state.auth.remember = false;
  state.auth.bootstrapped = false;
  state.lastRemoteSnapshot = "";
  setAuthError("");
  setAuthSubmitting(false);
  setAuthProgress("idle");
  updateAuthUI();
  if (!stored) return;
  state.auth.username = stored.username || "";
  state.auth.password = stored.remember ? stored.password || "" : "";
  state.auth.remember = !!stored.remember;
  if (authUsername) authUsername.value = state.auth.username;
  if (authPassword) authPassword.value = state.auth.password;
  if (authRemember) authRemember.checked = state.auth.remember;
}

async function loginWithSheet(username, password) {
  if (!APPS_SCRIPT_URL) {
    throw new Error("Chưa cấu hình appsScriptUrl trong config.js");
  }

  const body = new URLSearchParams({
    action: "login",
    username: normalizeText(username),
    password: String(password ?? ""),
    device: /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? "mobile" : "desktop",
  });

  let response;
  try {
    response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body,
      redirect: "follow",
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Failed to fetch") {
      throw new Error("Không kết nối được Apps Script. Kiểm tra lại deploy Web App và quyền truy cập public.");
    }
    throw error;
  }

  const rawText = await response.text().catch(() => "");
  let data = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch (error) {
    console.warn("Apps Script returned non-JSON response", rawText);
  }

  if (!response.ok) {
    throw new Error((data && data.error) || rawText || "Đăng nhập thất bại.");
  }

  if (!data || typeof data !== "object") {
    throw new Error("Apps Script không trả về JSON hợp lệ.");
  }

  return data;
}

async function logoutAuth() {
  clearAuthState();
  if (authForm) authForm.reset();
  releasePendingImages();
  previewArea.innerHTML = "";
  closeModal();
  closeEditModal();
  closeViewer();
  closePresenter();
  closeShotList();
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setUploadProgress(progress = 0, label = "") {
  if (!uploadProgress || !uploadProgressFill || !uploadProgressText) return;
  const safeProgress = clamp(Number(progress) || 0, 0, 100);
  uploadProgress.hidden = safeProgress <= 0 && !label;
  uploadProgressFill.style.width = `${safeProgress}%`;
  uploadProgressText.textContent = label || `Dang tai anh ${Math.round(safeProgress)}%`;
}

function resetUploadProgress() {
  setUploadProgress(0, "");
}

function setAiToolbarStatus(status, detail = "") {
  const button = document.getElementById("btn-ai-settings");
  if (!button) return;

  if (status === "loading") {
    button.textContent = "Đang tải AI...";
    button.disabled = true;
    button.classList.remove("active");
    button.title = detail || "Đang tải TensorFlow.js pose model";
    return;
  }

  button.disabled = false;
  if (status === "ready") {
    button.textContent = "AI sẵn";
    button.classList.add("active");
    button.title = detail || "TensorFlow.js pose model đã sẵn sàng";
    return;
  }

  if (status === "error") {
    button.textContent = "AI lỗi";
    button.classList.remove("active");
    button.title = detail || "Không tải được TensorFlow.js pose model";
    return;
  }

  button.textContent = "AI pose";
  button.classList.remove("active");
  button.title = detail || "Tải AI pose local";
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function toDegrees(value) {
  return (value * 180) / Math.PI;
}

function getDistance(pointA, pointB) {
  if (!pointA || !pointB) return null;
  return Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y);
}

function getMidpoint(pointA, pointB) {
  if (!pointA || !pointB) return null;
  return {
    x: (pointA.x + pointB.x) / 2,
    y: (pointA.y + pointB.y) / 2,
  };
}

function getAngle(pointA, pointB, pointC) {
  if (!pointA || !pointB || !pointC) return null;
  const abx = pointA.x - pointB.x;
  const aby = pointA.y - pointB.y;
  const cbx = pointC.x - pointB.x;
  const cby = pointC.y - pointB.y;
  const denominator = Math.hypot(abx, aby) * Math.hypot(cbx, cby);
  if (!denominator) return null;
  const cosine = clamp((abx * cbx + aby * cby) / denominator, -1, 1);
  return toDegrees(Math.acos(cosine));
}

function getNamedPoint(keypoints, name) {
  return keypoints[name] || null;
}

function getNamedPointFromList(keypoints, names) {
  for (const name of names) {
    if (keypoints[name]) return keypoints[name];
  }
  return null;
}

function buildKeypointMap(pose) {
  const keypoints = {};
  (pose.keypoints || []).forEach((point) => {
    if (!point.name) return;
    if ((point.score ?? 1) < 0.18) return;
    keypoints[point.name] = point;
  });
  return keypoints;
}

async function ensurePoseDetector() {
  if (poseDetector) return poseDetector;
  if (!window.tf || !window.poseDetection) {
    throw new Error("Thiếu TensorFlow.js hoặc pose-detection script");
  }

  if (!poseDetectorPromise) {
    poseDetectorPromise = (async () => {
      setAiToolbarStatus("loading");
      await tf.ready();
      try {
        await tf.setBackend("webgl");
        await tf.ready();
      } catch (error) {
        console.warn("WebGL backend unavailable, fallback to default backend", error);
      }

      poseDetector = await poseDetection.createDetector(
        poseDetection.SupportedModels.BlazePose,
        {
          runtime: "tfjs",
          modelType: "heavy",
          enableSmoothing: false,
        }
      );
      setAiToolbarStatus("ready");
      return poseDetector;
    })().catch((error) => {
      poseDetectorPromise = null;
      setAiToolbarStatus("error", error.message || "Không tải được AI pose");
      throw error;
    });
  }

  return poseDetectorPromise;
}

function loadImageForPose(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Không tải được ảnh để phân tích pose"));
    image.src = src;
  });
}

function inferOverallPose(metrics) {
  const parts = [];
  if (metrics.isSeated) parts.push("ngồi");
  else if (metrics.hasStep) parts.push("bước nhẹ");
  else parts.push("đứng");

  if (metrics.isLeaning) {
    parts.push(`nghiêng ${metrics.leanSide}`);
  }

  return parts.join(", ");
}

function inferLegs(metrics) {
  const parts = [];
  if (metrics.weightSide) parts.push(`dồn trọng tâm về chân ${metrics.weightSide}`);
  if (metrics.isCrossed) parts.push("hai chân có xu hướng bắt chéo");
  if (metrics.hasStep) parts.push("một chân đặt trước tạo nhịp bước nhẹ");
  if (metrics.leftKneeBent || metrics.rightKneeBent) {
    const bentSides = [
      metrics.leftKneeBent ? "trái" : "",
      metrics.rightKneeBent ? "phải" : "",
    ].filter(Boolean);
    parts.push(`đầu gối ${bentSides.join(" / ")} thả lỏng`);
  }
  if (!parts.length) parts.push("hai chân trụ khá cân bằng và gọn");
  return parts.join("; ");
}

function describeHand(sideLabel, wrist, elbow, shoulder, hip, nose, shoulderWidth) {
  if (!wrist || !shoulder || !hip) return `${sideLabel} khó xác định rõ`;
  const elbowAngle = getAngle(wrist, elbow, shoulder);

  if (nose && getDistance(wrist, nose) && getDistance(wrist, nose) < shoulderWidth * 0.85) {
    return `${sideLabel} chạm gần mặt`;
  }
  if (getDistance(wrist, hip) && getDistance(wrist, hip) < shoulderWidth * 0.62) {
    return `${sideLabel} đặt gần hông`;
  }
  if (wrist.y < shoulder.y - shoulderWidth * 0.08) {
    return `${sideLabel} nâng cao tạo điểm nhấn`;
  }
  if (wrist.y > hip.y && elbowAngle != null && elbowAngle > 145) {
    return `${sideLabel} buông thả tự nhiên`;
  }
  if (wrist.y > shoulder.y && wrist.y < hip.y && elbowAngle != null && elbowAngle < 120) {
    return `${sideLabel} gập trước thân`;
  }
  return `${sideLabel} giữ nhịp nhẹ theo thân`;
}

function inferHands(metrics, points) {
  const left = describeHand(
    "tay trái",
    points.leftWrist,
    points.leftElbow,
    points.leftShoulder,
    points.leftHip,
    points.nose,
    metrics.shoulderWidth
  );
  const right = describeHand(
    "tay phải",
    points.rightWrist,
    points.rightElbow,
    points.rightShoulder,
    points.rightHip,
    points.nose,
    metrics.shoulderWidth
  );
  return `${left}; ${right}`;
}

function inferBody(metrics) {
  const rotationText =
    metrics.rotationDegrees <= 10
      ? "xoay rất ít, gần chính diện"
      : metrics.rotationDegrees <= 25
        ? `xoay khoảng ${metrics.rotationDegrees}°`
        : `xoay khoảng ${metrics.rotationDegrees}° theo hướng ${metrics.faceDirection}`;

  const curveText = metrics.hasSCurve ? "form có đường cong chữ S nhẹ" : "form thân khá thẳng và gọn";
  return `${rotationText}; ${curveText}`;
}

function inferFace(metrics) {
  const gaze = metrics.faceDirection === "thẳng"
    ? "nhìn gần như thẳng"
    : `nhìn ${metrics.faceDirection}`;
  return `${gaze}; biểu cảm chỉ suy ra tương đối từ pose, tổng thể thiên về ${metrics.expressionHint}`;
}

function inferAccessories(metrics, points) {
  const nearHip =
    (points.leftWrist && points.leftHip && getDistance(points.leftWrist, points.leftHip) < metrics.shoulderWidth * 0.62) ||
    (points.rightWrist && points.rightHip && getDistance(points.rightWrist, points.rightHip) < metrics.shoulderWidth * 0.62);
  if (nearHip) {
    return "có khả năng tay đang tương tác với phụ kiện/đạo cụ ở vùng hông, nên kiểm tra ảnh gốc để chốt chính xác";
  }
  return "không thấy phụ kiện tham gia pose một cách thật rõ từ dữ liệu dáng";
}

function analyzePoseFromKeypoints(pose) {
  const keypoints = buildKeypointMap(pose);
  const points = {
    nose: getNamedPoint(keypoints, "nose"),
    leftEye: getNamedPointFromList(keypoints, ["left_eye", "left_eye_inner"]),
    rightEye: getNamedPointFromList(keypoints, ["right_eye", "right_eye_inner"]),
    leftShoulder: getNamedPoint(keypoints, "left_shoulder"),
    rightShoulder: getNamedPoint(keypoints, "right_shoulder"),
    leftElbow: getNamedPoint(keypoints, "left_elbow"),
    rightElbow: getNamedPoint(keypoints, "right_elbow"),
    leftWrist: getNamedPoint(keypoints, "left_wrist"),
    rightWrist: getNamedPoint(keypoints, "right_wrist"),
    leftHip: getNamedPoint(keypoints, "left_hip"),
    rightHip: getNamedPoint(keypoints, "right_hip"),
    leftKnee: getNamedPoint(keypoints, "left_knee"),
    rightKnee: getNamedPoint(keypoints, "right_knee"),
    leftAnkle: getNamedPoint(keypoints, "left_ankle"),
    rightAnkle: getNamedPoint(keypoints, "right_ankle"),
  };

  const shoulderCenter = getMidpoint(points.leftShoulder, points.rightShoulder);
  const hipCenter = getMidpoint(points.leftHip, points.rightHip);
  const kneeCenter = getMidpoint(points.leftKnee, points.rightKnee);
  const ankleCenter = getMidpoint(points.leftAnkle, points.rightAnkle);
  const eyeCenter = getMidpoint(points.leftEye, points.rightEye);

  if (!shoulderCenter || !hipCenter) {
    throw new Error("AI chưa bắt được đủ vai và hông. Nên dùng ảnh thấy rõ người hơn.");
  }

  const shoulderWidth = getDistance(points.leftShoulder, points.rightShoulder) || 120;
  const hipWidth = getDistance(points.leftHip, points.rightHip) || shoulderWidth * 0.9;
  const torsoLength = getDistance(shoulderCenter, hipCenter) || shoulderWidth;
  const leftKneeAngle = getAngle(points.leftHip, points.leftKnee, points.leftAnkle);
  const rightKneeAngle = getAngle(points.rightHip, points.rightKnee, points.rightAnkle);
  const avgKneeAngle = [leftKneeAngle, rightKneeAngle].filter((value) => value != null).reduce((sum, value, _, list) => sum + value / list.length, 0);
  const shoulderTiltSigned = points.leftShoulder && points.rightShoulder
    ? toDegrees(Math.atan2(points.rightShoulder.y - points.leftShoulder.y, points.rightShoulder.x - points.leftShoulder.x))
    : 0;
  const hipTiltSigned = points.leftHip && points.rightHip
    ? toDegrees(Math.atan2(points.rightHip.y - points.leftHip.y, points.rightHip.x - points.leftHip.x))
    : 0;
  const torsoLeanSigned = toDegrees(Math.atan2(shoulderCenter.x - hipCenter.x, hipCenter.y - shoulderCenter.y));
  const shoulderToHipOffset = shoulderCenter.x - hipCenter.x;
  const ankleSpread = points.leftAnkle && points.rightAnkle ? Math.abs(points.leftAnkle.x - points.rightAnkle.x) : 0;
  const kneeSpread = points.leftKnee && points.rightKnee ? Math.abs(points.leftKnee.x - points.rightKnee.x) : 0;
  const hipKneeLevelGap = kneeCenter ? Math.abs(kneeCenter.y - hipCenter.y) : Infinity;
  const noseOffset = points.nose && shoulderCenter ? points.nose.x - shoulderCenter.x : 0;
  const rotationDegrees = Math.round(
    clamp(Math.abs(noseOffset) / Math.max(shoulderWidth, 1), 0, 1) * 45
  );

  const metrics = {
    shoulderWidth,
    hipWidth,
    torsoLength,
    leftKneeAngle,
    rightKneeAngle,
    rotationDegrees,
    isSeated: hipKneeLevelGap < torsoLength * 0.45 && avgKneeAngle > 0 && avgKneeAngle < 140,
    hasStep: ankleSpread > shoulderWidth * 0.72 || kneeSpread > shoulderWidth * 0.56,
    isLeaning: Math.abs(torsoLeanSigned) > 10 || Math.abs(shoulderTiltSigned) > 8,
    leanSide: torsoLeanSigned > 0 ? "phải khung hình" : "trái khung hình",
    leftKneeBent: leftKneeAngle != null && leftKneeAngle < 158,
    rightKneeBent: rightKneeAngle != null && rightKneeAngle < 158,
    isCrossed:
      points.leftAnkle &&
      points.rightAnkle &&
      points.leftHip &&
      points.rightHip &&
      Math.sign(points.leftAnkle.x - points.rightAnkle.x) !== Math.sign(points.leftHip.x - points.rightHip.x),
    weightSide:
      ankleCenter && hipCenter && Math.abs(hipCenter.x - ankleCenter.x) > shoulderWidth * 0.08
        ? hipCenter.x > ankleCenter.x
          ? "phải"
          : "trái"
        : "",
    hasSCurve:
      Math.abs(shoulderToHipOffset) > shoulderWidth * 0.12 &&
      Math.sign(shoulderTiltSigned || 1) !== Math.sign(hipTiltSigned || -1),
    faceDirection:
      rotationDegrees < 10
        ? "thẳng"
        : noseOffset > 0
          ? "sang phải khung hình"
          : "sang trái khung hình",
    expressionHint:
      Math.abs(torsoLeanSigned) < 7 && !points.leftWrist && !points.rightWrist
        ? "trung tính"
        : Math.abs(torsoLeanSigned) < 7 && (points.leftWrist || points.rightWrist)
          ? "lạnh / thời trang"
          : "mềm và nhẹ",
  };

  if (!points.nose && eyeCenter) {
    metrics.faceDirection = "thẳng";
  }

  return [
    `Dáng tổng thể: ${inferOverallPose(metrics)}.`,
    `Chân: ${inferLegs(metrics)}.`,
    `Tay: ${inferHands(metrics, points)}.`,
    `Thân người: ${inferBody(metrics)}.`,
    `Mặt & ánh mắt: ${inferFace(metrics)}.`,
    `Phụ kiện: ${inferAccessories(metrics, points)}.`,
  ].join("\n");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseOrderSegments(order) {
  const normalized = normalizeText(order);
  if (!normalized) return [];
  if (!/^\d+(?:\.\d+)*$/.test(normalized)) return [];
  return normalized.split(".").map((part) => Number(part));
}

function compareOrders(a, b) {
  const segA = parseOrderSegments(a.order);
  const segB = parseOrderSegments(b.order);
  const max = Math.max(segA.length, segB.length);

  for (let index = 0; index < max; index += 1) {
    const valueA = segA[index];
    const valueB = segB[index];
    if (valueA == null && valueB == null) break;
    if (valueA == null) return -1;
    if (valueB == null) return 1;
    if (valueA !== valueB) return valueA - valueB;
  }

  const createdA = Number(a.createdAt || 0);
  const createdB = Number(b.createdAt || 0);
  if (createdA !== createdB) return createdA - createdB;
  return String(a.id).localeCompare(String(b.id));
}

function getTopLevelValue(order) {
  const segments = parseOrderSegments(order);
  return segments.length ? segments[0] : null;
}

function getNextIntegerOrder(nodes = cs().nodes) {
  const reserved = new Set();
  nodes.forEach((node) => {
    const top = getTopLevelValue(node.order);
    if (top != null) reserved.add(top);
  });
  let candidate = 1;
  while (reserved.has(candidate)) candidate += 1;
  return String(candidate);
}

function normalizeNode(node, index = 0, nodes = []) {
  return {
    id: node.id || uid(),
    x: Number.isFinite(node.x) ? node.x : 120 + index * 30,
    y: Number.isFinite(node.y) ? node.y : 140 + index * 30,
    w: Number.isFinite(node.w) ? Math.max(MIN_WIDTH, node.w) : 220,
    src: node.src || "",
    title: normalizeText(node.title),
    tag: normalizeText(node.tag) || currentStyle,
    note: normalizeText(node.note),
    aiNote: normalizeText(node.aiNote),
    order: normalizeText(node.order) || getNextIntegerOrder(nodes),
    aspectRatio: Number(node.aspectRatio) > 0 ? Number(node.aspectRatio) : 1,
    createdAt: Number(node.createdAt) || Date.now() + index,
  };
}

function cloneData(data) {
  return JSON.parse(JSON.stringify(data));
}

function normalizeBoardPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const normalized = cloneData(payload);
  delete normalized.updatedAt;
  return normalized;
}

function mergeStyleState(remoteStyle, localStyle) {
  const base = createEmptyStyleState();
  const remote = remoteStyle || base;
  const local = localStyle || base;

  const nodeMap = new Map();
  (Array.isArray(remote.nodes) ? remote.nodes : []).forEach((node) => nodeMap.set(node.id, cloneData(node)));
  (Array.isArray(local.nodes) ? local.nodes : []).forEach((node) => nodeMap.set(node.id, cloneData(node)));

  const connectionMap = new Map();
  (Array.isArray(remote.connections) ? remote.connections : []).forEach((connection) => {
    connectionMap.set(connection.id, cloneData(connection));
  });
  (Array.isArray(local.connections) ? local.connections : []).forEach((connection) => {
    connectionMap.set(connection.id, cloneData(connection));
  });

  return {
    nodes: Array.from(nodeMap.values()),
    connections: Array.from(connectionMap.values()),
    pan: cloneData(local.pan || remote.pan || base.pan),
    zoom: Number(local.zoom) || Number(remote.zoom) || 1,
    shotChecks: {
      ...(remote.shotChecks || {}),
      ...(local.shotChecks || {}),
    },
  };
}

function mergePayloads(remotePayload, localPayload) {
  const mergedStyleData = {};
  STYLES.forEach((style) => {
    mergedStyleData[style] = mergeStyleState(
      remotePayload?.styleData?.[style],
      localPayload?.styleData?.[style]
    );
  });

  return {
    styleData: mergedStyleData,
    currentStyle:
      localPayload?.currentStyle && STYLES.includes(localPayload.currentStyle)
        ? localPayload.currentStyle
        : remotePayload?.currentStyle && STYLES.includes(remotePayload.currentStyle)
          ? remotePayload.currentStyle
          : "Đứng",
    nextId: Math.max(
      Number(remotePayload?.nextId) || 1,
      Number(localPayload?.nextId) || 1,
      1
    ),
    boardOffsetApplied: true,
  };
}

function buildPayload() {
  return {
    styleData,
    currentStyle,
    nextId: state.nextId,
    boardOffsetApplied: true,
  };
}

function snapshotState() {
  return JSON.stringify(buildPayload());
}

function applyLoadedPayload(payload) {
  const hasBoardOffset = !!payload.boardOffsetApplied;
  STYLES.forEach((style) => {
    const source = payload.styleData?.[style];
    const base = createEmptyStyleState();
    if (!source) {
      styleData[style] = base;
      return;
    }

    const workingNodes = [];
    const nodes = Array.isArray(source.nodes)
      ? source.nodes.map((node, index) => {
          const normalized = normalizeNode({ ...node, tag: style }, index, workingNodes);
          workingNodes.push(normalized);
          return normalized;
        })
      : [];

    const connections = Array.isArray(source.connections)
      ? source.connections
          .map((connection) => ({
            id: connection.id || cuid(),
            fromId: connection.fromId,
            fromSide: connection.fromSide || null,
            toId: connection.toId,
            toSide: connection.toSide || null,
          }))
          .filter((connection) => connection.fromId && connection.toId && connection.fromId !== connection.toId)
      : [];

    styleData[style] = {
      nodes,
      connections,
      pan: {
        x: Number(source.pan?.x) || 0,
        y: Number(source.pan?.y) || 0,
      },
      zoom: Number(source.zoom) || 1,
      shotChecks: source.shotChecks || {},
    };

    if (!hasBoardOffset) {
      styleData[style].pan.x += BOARD_OFFSET;
      styleData[style].pan.y += BOARD_OFFSET;
    }
  });

  currentStyle = payload.currentStyle && STYLES.includes(payload.currentStyle) ? payload.currentStyle : "Đứng";
  state.nextId = Number.isFinite(payload.nextId) ? payload.nextId : computeNextId();
}

function computeNextId() {
  return (
    STYLES.flatMap((style) => styleData[style].nodes)
      .map((node) => Number(String(node.id).replace(/[^\d]/g, "")))
      .filter((value) => Number.isFinite(value))
      .reduce((max, value) => Math.max(max, value), 0) + 1
  );
}

async function apiRequest(path, options = {}) {
  if (!API_BASE) {
    throw new Error(
      "Chưa cấu hình API cloud. Nếu đang mở file HTML trực tiếp, hãy deploy Cloudflare Pages hoặc điền domain API vào config.js"
    );
  }

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: getAuthHeaders(options.headers),
    });
    if (response.status === 401) {
      clearAuthState();
      throw new Error("Phiên đăng nhập đã hết hạn hoặc tài khoản không còn hợp lệ.");
    }
    if (!response.ok) {
      const message = await response.text().catch(() => "");
      throw new Error(message || `Request failed: ${response.status}`);
    }
    return response;
  } catch (error) {
    if (error instanceof Error && error.message === "Failed to fetch") {
      throw new Error(`Không kết nối được API cloud tại ${API_BASE}. Kiểm tra deploy Pages/Functions hoặc config.js`);
    }
    throw error;
  }
}

async function refreshFromRemote(options = {}) {
  const boardRef = getFirebaseBoardRef();
  if (!boardRef) return false;
  if (!options.force && (state.pendingSnapshot || state.saveInFlight || state.saveTimer)) return false;

  try {
    const snapshot = await boardRef.once("value");
    const payload = normalizeBoardPayload(snapshot.val());
    if (!payload || typeof payload !== "object") return false;

    const remoteSnapshot = JSON.stringify(payload);
    const localSnapshot = snapshotState();
    if (remoteSnapshot === localSnapshot) {
      state.lastRemoteSnapshot = remoteSnapshot;
      return false;
    }

    applyLoadedPayload(payload);
    state.lastRemoteSnapshot = remoteSnapshot;
    state.selectedIds.clear();
    renderAll();
    applyTransform();
    updateHistoryButtons();
    return true;
  } catch (error) {
    console.warn("Remote refresh failed", error);
    return false;
  }
}

async function loadAll() {
  try {
    const boardRef = assertFirebaseBoardReady();
    const snapshot = await boardRef.once("value");
    const payload = normalizeBoardPayload(snapshot.val());
    if (payload && typeof payload === "object") {
      applyLoadedPayload(payload);
      state.lastRemoteSnapshot = JSON.stringify(payload);
      return;
    }
    state.lastRemoteSnapshot = snapshotState();
    await boardRef.set(buildPayload());
  } catch (error) {
    console.warn("Firebase load failed", error);
    throw new Error(error instanceof Error ? error.message : "Không tải được project từ Firebase.");
  }
}

async function bootBoardApp() {
  if (state.auth.bootstrapped) return;
  await loadAll();
  if (!state.firebaseBoardListener) {
    const boardRef = assertFirebaseBoardReady();
    const handleBoardValue = (snapshot) => {
      const payload = normalizeBoardPayload(snapshot.val());
      if (!payload || typeof payload !== "object") return;
      if (state.pendingSnapshot || state.saveInFlight || state.saveTimer) return;

      const remoteSnapshot = JSON.stringify(payload);
      const localSnapshot = snapshotState();
      if (remoteSnapshot === localSnapshot) {
        state.lastRemoteSnapshot = remoteSnapshot;
        return;
      }

      applyLoadedPayload(payload);
      state.lastRemoteSnapshot = remoteSnapshot;
      state.selectedIds.clear();
      renderAll();
      applyTransform();
      updateHistoryButtons();
    };

    boardRef.on("value", handleBoardValue, (error) => {
      console.warn("Firebase realtime listener failed", error);
    });
    state.firebaseBoardListener = () => {
      boardRef.off("value", handleBoardValue);
      state.firebaseBoardListener = null;
    };
  }
  setAiToolbarStatus("idle");
  styleBadge.textContent = currentStyle;
  document.querySelectorAll(".style-option").forEach((button) => {
    button.classList.toggle("active", button.dataset.style === currentStyle);
  });
  renderAll();
  applyTransform();
  setMode("pan");
  updateHistoryButtons();
  state.auth.bootstrapped = true;
}

async function flushRemoteSave(options = {}) {
  let snapshot = state.pendingSnapshot;
  if (!snapshot) return;
  if (state.saveInFlight) return state.saveInFlight;

  const boardRef = assertFirebaseBoardReady();
  const payloadToSave = JSON.parse(snapshot);

  state.pendingSnapshot = null;
  state.saveInFlight = boardRef
    .set({
      ...payloadToSave,
      updatedAt: window.firebase?.database?.ServerValue?.TIMESTAMP || Date.now(),
    })
    .catch((error) => {
      console.warn("Firebase save failed", error);
    })
    .then(() => {
      state.lastRemoteSnapshot = snapshot;
    })
    .finally(() => {
      state.saveInFlight = null;
      if (state.pendingSnapshot && !options.keepalive) {
        void flushRemoteSave();
      }
    });

  return state.saveInFlight;
}

function scheduleRemoteSave(snapshot) {
  if (!getFirebaseBoardRef()) return;
  state.pendingSnapshot = snapshot;
  if (state.saveTimer) clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    state.saveTimer = null;
    void flushRemoteSave();
  }, REMOTE_SAVE_DEBOUNCE);
}

function saveAll() {
  const snapshot = snapshotState();
  scheduleRemoteSave(snapshot);
}

function flushPendingSaveOnExit() {
  if (!state.pendingSnapshot) return;
  if (state.saveTimer) {
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
  }
  void flushRemoteSave({ keepalive: true });
}

function pushHistorySnapshot(snapshot) {
  if (state.isRestoringHistory) return;
  state.history.undo.push(snapshot);
  if (state.history.undo.length > HISTORY_LIMIT) state.history.undo.shift();
  state.history.redo = [];
}

function recordHistory() {
  pushHistorySnapshot(snapshotState());
  updateHistoryButtons();
}

function restoreSnapshot(snapshot, destinationStack) {
  if (!snapshot) return;
  state.isRestoringHistory = true;
  destinationStack.push(snapshotState());
  try {
    const payload = JSON.parse(snapshot);
    applyLoadedPayload(payload);
    state.selectedIds.clear();
    closeViewer();
    closePresenter();
    renderAll();
    applyTransform();
    saveAll();
  } finally {
    state.isRestoringHistory = false;
    updateHistoryButtons();
  }
}

function undo() {
  if (!state.history.undo.length) return;
  const snapshot = state.history.undo.pop();
  restoreSnapshot(snapshot, state.history.redo);
}

function redo() {
  if (!state.history.redo.length) return;
  const snapshot = state.history.redo.pop();
  restoreSnapshot(snapshot, state.history.undo);
}

function commitMutation(mutator, options = {}) {
  const { rerender = true, save = true, history = true } = options;
  if (history) recordHistory();
  mutator();
  if (rerender) renderAll();
  else {
    redrawConnections();
    renderShotList();
    updateSelectionUI();
  }
  if (save) saveAll();
}

function getSortedNodes() {
  return [...cs().nodes].sort(compareOrders);
}

function screenToCanvas(screenX, screenY) {
  const { pan, zoom } = cs();
  return {
    x: (screenX + BOARD_OFFSET - pan.x) / zoom,
    y: (screenY + BOARD_OFFSET - pan.y) / zoom,
  };
}

function canvasToScreen(canvasX, canvasY) {
  const { pan, zoom } = cs();
  return {
    x: canvasX * zoom + pan.x - BOARD_OFFSET,
    y: canvasY * zoom + pan.y - BOARD_OFFSET,
  };
}

function getNodeById(nodeId) {
  return cs().nodes.find((node) => node.id === nodeId);
}

function getTouchDistance(firstTouch, secondTouch) {
  return Math.hypot(secondTouch.clientX - firstTouch.clientX, secondTouch.clientY - firstTouch.clientY);
}

function getTouchMidpoint(firstTouch, secondTouch, rect) {
  return {
    x: (firstTouch.clientX + secondTouch.clientX) / 2 - rect.left,
    y: (firstTouch.clientY + secondTouch.clientY) / 2 - rect.top,
  };
}

function getNodeHeight(nodeId) {
  const el = document.getElementById(`node-${nodeId}`);
  return el ? el.offsetHeight : 290;
}

function getNodeBox(nodeId) {
  const node = getNodeById(nodeId);
  if (!node) return null;
  return {
    x: node.x,
    y: node.y,
    w: node.w || 220,
    h: getNodeHeight(node.id),
  };
}

function getAnchorPos(nodeId, side) {
  const box = getNodeBox(nodeId);
  if (!box) return { x: 0, y: 0, side: "r" };
  if (side === "l") return { x: box.x, y: box.y + box.h / 2, side };
  if (side === "r") return { x: box.x + box.w, y: box.y + box.h / 2, side };
  if (side === "t") return { x: box.x + box.w / 2, y: box.y, side };
  if (side === "b") return { x: box.x + box.w / 2, y: box.y + box.h, side };
  return { x: box.x + box.w / 2, y: box.y + box.h / 2, side: "r" };
}

function sideOffset(point, side, distance) {
  if (side === "r") return { x: point.x + distance, y: point.y };
  if (side === "l") return { x: point.x - distance, y: point.y };
  if (side === "t") return { x: point.x, y: point.y - distance };
  if (side === "b") return { x: point.x, y: point.y + distance };
  return { x: point.x + distance, y: point.y };
}

function getNearestSideFromPoint(nodeId, point) {
  const box = getNodeBox(nodeId);
  if (!box) return "r";
  const distances = [
    { side: "l", value: Math.abs(point.x - box.x) },
    { side: "r", value: Math.abs(point.x - (box.x + box.w)) },
    { side: "t", value: Math.abs(point.y - box.y) },
    { side: "b", value: Math.abs(point.y - (box.y + box.h)) },
  ];
  distances.sort((a, b) => a.value - b.value);
  return distances[0].side;
}

function resolveConnectionPoints(connection) {
  const fromSide = connection.fromSide || "r";
  const toSide = connection.toSide || "l";
  return {
    from: getAnchorPos(connection.fromId, fromSide),
    to: getAnchorPos(connection.toId, toSide),
  };
}

function makeCurve(start, end) {
  const distance = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y)) * 0.42 + 36;
  const cp1 = sideOffset(start, start.side, distance);
  const cp2 = sideOffset(end, end.side, distance);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", `M ${start.x} ${start.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${end.x} ${end.y}`);
  return path;
}

function applyTransform() {
  const { pan, zoom } = cs();
  const transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  canvas.style.transform = transform;
  svg.style.transform = transform;
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}

function updateEmptyHint() {
  let hint = document.querySelector(".empty-hint");
  if (cs().nodes.length === 0) {
    if (!hint) {
      hint = document.createElement("div");
      hint.className = "empty-hint";
      document.body.appendChild(hint);
    }
    hint.textContent = `Tab ${currentStyle} trống - nhấn + hoặc chuột phải để thêm node`;
  } else if (hint) {
    hint.remove();
  }
}

function updateHistoryButtons() {
  document.getElementById("btn-undo").disabled = state.history.undo.length === 0;
  document.getElementById("btn-redo").disabled = state.history.redo.length === 0;
}

function updateSelectionUI() {
  selectionCountEl.textContent = `${state.selectedIds.size} node`;
  selectionToolbar.classList.toggle("open", state.selectedIds.size > 1);
}

function setSelected(nodeIds) {
  state.selectedIds = new Set(nodeIds);
  document.querySelectorAll(".node").forEach((el) => {
    const nodeId = el.id.replace("node-", "");
    el.classList.toggle("selected", state.selectedIds.has(nodeId));
  });
  updateSelectionUI();
}

function toggleSelected(nodeId) {
  const next = new Set(state.selectedIds);
  if (next.has(nodeId)) next.delete(nodeId);
  else next.add(nodeId);
  setSelected(next);
}

function clearSelection() {
  setSelected([]);
}

function drawConnection(connection) {
  if (!getNodeById(connection.fromId) || !getNodeById(connection.toId)) return;
  const points = resolveConnectionPoints(connection);
  const path = makeCurve(points.from, points.to);
  path.classList.add("conn-line");
  path.dataset.connId = connection.id;
  path.addEventListener("click", (event) => {
    if (state.mode !== "delete-conn") return;
    event.stopPropagation();
    commitMutation(() => {
      cs().connections = cs().connections.filter((item) => item.id !== connection.id);
    });
  });
  svg.insertBefore(path, svg.firstChild);
}

function redrawConnections() {
  svg.innerHTML = "";
  cs().connections.forEach((connection) => drawConnection(connection));
  updateTempConnectionLine();
}

function formatAiNote(note) {
  if (!note) return "";
  return note
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(":");
      if (parts.length > 1) {
        const label = escapeHtml(parts.shift());
        const value = escapeHtml(parts.join(":").trim());
        return `<div><strong>${label}:</strong> ${value}</div>`;
      }
      return `<div>${escapeHtml(line)}</div>`;
    })
    .join("");
}

function createNodeEl(node) {
  const el = document.createElement("div");
  el.className = "node";
  el.id = `node-${node.id}`;
  el.style.left = `${node.x}px`;
  el.style.top = `${node.y}px`;
  el.style.width = `${node.w}px`;
  if (state.selectedIds.has(node.id)) el.classList.add("selected");

  el.innerHTML = `
    <div class="node-order-badge">${escapeHtml(node.order || "-")}</div>
    <button class="node-view-btn" type="button" title="Xem lớn">↗</button>
    <button class="node-delete" type="button" title="Xóa node">✕</button>
    <div class="node-img-wrap">
      <img class="node-img" src="${escapeHtml(node.src)}" alt="${escapeHtml(node.title || "Pose image")}" draggable="false" />
    </div>
    <div class="node-info">
      <div class="node-meta">
        <span class="node-tag">${escapeHtml(node.tag || currentStyle)}</span>
        <button class="node-ai-btn ${state.aiLoadingNodeId === node.id ? "is-busy" : ""}" type="button">
          ${state.aiLoadingNodeId === node.id ? "Đang AI..." : "AI note"}
        </button>
      </div>
      <div class="node-title">${escapeHtml(node.title || "Untitled")}</div>
      <div class="node-note-text">${escapeHtml(node.note || "")}</div>
      ${node.aiNote ? `<div class="node-ai-note">${formatAiNote(node.aiNote)}</div>` : ""}
    </div>
    <div class="anchor anchor-l" data-side="l"></div>
    <div class="anchor anchor-r" data-side="r"></div>
    <div class="anchor anchor-t" data-side="t"></div>
    <div class="anchor anchor-b" data-side="b"></div>
    <div class="resize-handle rh-e" data-dir="e"></div>
    <div class="resize-handle rh-w" data-dir="w"></div>
    <div class="resize-handle rh-ne" data-dir="ne"></div>
    <div class="resize-handle rh-nw" data-dir="nw"></div>
    <div class="resize-handle rh-se" data-dir="se"></div>
    <div class="resize-handle rh-sw" data-dir="sw"></div>
  `;

  const imageWrap = el.querySelector(".node-img-wrap");
  imageWrap.style.aspectRatio = String(node.aspectRatio || 1);
  imageWrap.addEventListener("dblclick", (event) => {
    event.stopPropagation();
    openViewerByNodeId(node.id);
  });

  const imageEl = el.querySelector(".node-img");
  imageEl.addEventListener("load", () => {
    if (!imageEl.naturalWidth || !imageEl.naturalHeight) return;
    const ratio = imageEl.naturalWidth / imageEl.naturalHeight;
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    const target = getNodeById(node.id);
    if (!target) return;
    if (Math.abs(target.aspectRatio - ratio) < 0.001) return;
    target.aspectRatio = ratio;
    imageWrap.style.aspectRatio = String(ratio);
    saveAll();
    redrawConnections();
  });
  if (imageEl.complete) {
    imageEl.dispatchEvent(new Event("load"));
  }

  const viewButton = el.querySelector(".node-view-btn");
  viewButton.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
  viewButton.addEventListener("click", (event) => {
    event.stopPropagation();
    openViewerByNodeId(node.id);
  });

  const deleteButton = el.querySelector(".node-delete");
  const handleDeleteNode = (event) => {
    event.preventDefault();
    event.stopPropagation();
    deleteNode(node.id);
  };
  deleteButton.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
  deleteButton.addEventListener("pointerup", handleDeleteNode);

  el.querySelector(".node-ai-btn").addEventListener("click", async (event) => {
    event.stopPropagation();
    await generateAiNoteForNode(node.id);
  });

  const titleEl = el.querySelector(".node-title");
  titleEl.addEventListener("dblclick", (event) => {
    event.stopPropagation();
    startInlineEdit(titleEl, node.id, "title");
  });

  const noteEl = el.querySelector(".node-note-text");
  noteEl.addEventListener("dblclick", (event) => {
    event.stopPropagation();
    startInlineEdit(noteEl, node.id, "note");
  });

  el.querySelectorAll(".anchor").forEach((anchor) => {
    anchor.addEventListener("pointerdown", (event) => {
      startConnectionFromNode(event, node.id, anchor.dataset.side);
    });
  });

  el.querySelectorAll(".resize-handle").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => onResizePointerDown(event, node.id, handle.dataset.dir));
  });

  el.addEventListener("pointerdown", onNodePointerDown);
  el.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    state.contextNodeId = node.id;
    hideCanvasCtxMenu();
    showNodeCtxMenu(event.clientX, event.clientY);
  });

  canvas.appendChild(el);
}

function renderNodes() {
  canvas.innerHTML = "";
  cs().nodes.forEach((node) => createNodeEl(node));
}

function renderAll() {
  renderNodes();
  redrawConnections();
  renderShotList();
  updateEmptyHint();
  updateSelectionUI();
}

function renderShotList() {
  const nodes = getSortedNodes();
  shotListSubtitle.textContent = `${nodes.length} pose`;
  shotListPanel.classList.toggle("open", state.shotListOpen);
  shotListBody.innerHTML = "";

  nodes.forEach((node) => {
    const done = !!cs().shotChecks[node.id];
    const item = document.createElement("div");
    item.className = `shot-item${done ? " done" : ""}`;
    item.innerHTML = `
      <input class="shot-item-check" type="checkbox" ${done ? "checked" : ""} />
      <img src="${escapeHtml(node.src)}" alt="${escapeHtml(node.title || "Pose")}" />
      <div class="shot-item-meta">
        <div class="shot-item-title">${escapeHtml(node.order || "-")} · ${escapeHtml(node.title || "Untitled")}</div>
        <div class="shot-item-note">${escapeHtml(node.note || node.aiNote || "")}</div>
      </div>
      <button class="shot-item-view" type="button">Xem</button>
    `;

    item.querySelector(".shot-item-check").addEventListener("change", (event) => {
      commitMutation(() => {
        cs().shotChecks[node.id] = event.target.checked;
      }, { rerender: false });
      renderShotList();
    });

    item.querySelector(".shot-item-view").addEventListener("click", () => {
      openViewerByNodeId(node.id);
    });

    item.addEventListener("dblclick", () => {
      openPresenterByNodeId(node.id);
    });

    shotListBody.appendChild(item);
  });
}

function showCanvasCtxMenu(x, y) {
  canvasCtxMenu.style.left = `${x}px`;
  canvasCtxMenu.style.top = `${y}px`;
  canvasCtxMenu.classList.add("open");
}

function hideCanvasCtxMenu() {
  canvasCtxMenu.classList.remove("open");
}

function showNodeCtxMenu(x, y) {
  nodeCtxMenu.style.left = `${x}px`;
  nodeCtxMenu.style.top = `${y}px`;
  nodeCtxMenu.classList.add("open");
}

function hideNodeCtxMenu() {
  nodeCtxMenu.classList.remove("open");
}

function closeMenus() {
  hideCanvasCtxMenu();
  hideNodeCtxMenu();
  layoutMenu.classList.remove("open");
  styleDropMenu.classList.remove("open");
  styleDropBtn.classList.remove("open");
}

function startInlineEdit(el, nodeId, field) {
  el.contentEditable = "true";
  el.focus();

  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  let initialValue = el.textContent;
  const onBlur = () => finish(true);
  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      finish(false);
      return;
    }
    if (field === "title" && event.key === "Enter") {
      event.preventDefault();
      finish(true);
    }
    event.stopPropagation();
  };

  function finish(shouldSave) {
    el.contentEditable = "false";
    el.removeEventListener("blur", onBlur);
    el.removeEventListener("keydown", onKeyDown);
    if (!shouldSave) {
      el.textContent = initialValue;
      return;
    }
    const nextValue = el.textContent.trim();
    if (nextValue === initialValue.trim()) return;
    commitMutation(() => {
      const node = getNodeById(nodeId);
      if (!node) return;
      node[field] = nextValue;
    });
  }

  el.addEventListener("blur", onBlur);
  el.addEventListener("keydown", onKeyDown);
}

function deleteNode(nodeId) {
  commitMutation(() => {
    cs().nodes = cs().nodes.filter((node) => node.id !== nodeId);
    cs().connections = cs().connections.filter((connection) => connection.fromId !== nodeId && connection.toId !== nodeId);
    delete cs().shotChecks[nodeId];
    state.selectedIds.delete(nodeId);
  });
}

function releasePendingImages() {
  state.pendingImages.forEach((item) => {
    if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
  });
  state.pendingImages = [];
}

function openModal() {
  releasePendingImages();
  previewArea.innerHTML = "";
  nodeTitleInp.value = "";
  nodeNoteInp.value = "";
  urlInput.value = "";
  resetUploadProgress();
  modalOverlay.classList.add("open");
}

function closeModal() {
  modalOverlay.classList.remove("open");
  releasePendingImages();
  previewArea.innerHTML = "";
  resetUploadProgress();
}

function renderPendingImages() {
  previewArea.innerHTML = "";
  state.pendingImages.forEach((item, index) => {
    if (!item.order) item.order = getNextIntegerOrder([...cs().nodes, ...state.pendingImages.slice(0, index)]);
    const row = document.createElement("div");
    row.className = "preview-item";
    row.innerHTML = `
      <img class="preview-thumb" src="${escapeHtml(item.previewSrc || item.src)}" alt="Preview" />
      <div class="preview-controls">
        <div class="preview-order-label">Số thứ tự ảnh</div>
        <input class="preview-order-input" type="text" value="${escapeHtml(item.order)}" />
      </div>
      <button class="preview-remove" type="button" aria-label="Xóa ảnh">✕</button>
    `;

    row.querySelector(".preview-order-input").addEventListener("input", (event) => {
      item.order = event.target.value.trim();
    });

    row.querySelector(".preview-remove").addEventListener("click", () => {
      if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
      state.pendingImages = state.pendingImages.filter((pending) => pending.id !== item.id);
      renderPendingImages();
    });

    previewArea.appendChild(row);
  });
}

function addPreviewImage(src) {
  state.pendingImages.push({
    id: cuid(),
    src,
    previewSrc: src,
    order: "",
    source: "url",
  });
  renderPendingImages();
}

function handleFiles(fileList) {
  Array.from(fileList).forEach((file) => {
    if (!file.type.startsWith("image/")) return;
    const objectUrl = URL.createObjectURL(file);
    state.pendingImages.push({
      id: cuid(),
      src: "",
      previewSrc: objectUrl,
      order: "",
      source: "upload",
      file,
      objectUrl,
      uploadedUrl: "",
    });
  });
  renderPendingImages();
}

function getSpawnPos(index) {
  const wrapperRect = canvasWrapper.getBoundingClientRect();
  return screenToCanvas(wrapperRect.width / 2 - 120 + index * 236, wrapperRect.height / 2 - 140);
}

async function uploadPendingImage(item) {
  if (item.source !== "upload") return item.src;
  if (item.uploadedUrl) return item.uploadedUrl;

  if (!CLOUDINARY_CONFIG.cloudName || !CLOUDINARY_CONFIG.uploadPreset) {
    throw new Error("Chưa cấu hình Cloudinary. Điền cloudName và uploadPreset trong config.js");
  }

  const formData = new FormData();
  formData.append("file", item.file, item.file?.name || "posing-image");
  formData.append("upload_preset", CLOUDINARY_CONFIG.uploadPreset);
  if (CLOUDINARY_CONFIG.folder) {
    formData.append("folder", CLOUDINARY_CONFIG.folder);
  }

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(CLOUDINARY_CONFIG.cloudName)}/image/upload`,
    {
      method: "POST",
      body: formData,
    }
  );

  if (!response.ok) {
    let message = `Cloudinary upload failed: ${response.status}`;
    try {
      const errorData = await response.json();
      if (errorData.error && errorData.error.message) {
        message = errorData.error.message;
      }
    } catch {
      // ignore parse failure
    }
    throw new Error(message);
  }

  const data = await response.json();
  item.uploadedUrl = data.secure_url || data.url || "";
  if (!item.uploadedUrl) {
    throw new Error("Cloudinary không trả về secure_url");
  }

  return item.uploadedUrl;
}

function uploadPendingImageWithProgress(item, onProgress) {
  if (item.source !== "upload") return Promise.resolve(item.src);
  if (item.uploadedUrl) return Promise.resolve(item.uploadedUrl);

  if (!CLOUDINARY_CONFIG.cloudName || !CLOUDINARY_CONFIG.uploadPreset) {
    throw new Error("ChÆ°a cáº¥u hÃ¬nh Cloudinary. Äiá»n cloudName vÃ  uploadPreset trong config.js");
  }

  const formData = new FormData();
  formData.append("file", item.file, item.file?.name || "posing-image");
  formData.append("upload_preset", CLOUDINARY_CONFIG.uploadPreset);
  if (CLOUDINARY_CONFIG.folder) {
    formData.append("folder", CLOUDINARY_CONFIG.folder);
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `https://api.cloudinary.com/v1_1/${encodeURIComponent(CLOUDINARY_CONFIG.cloudName)}/image/upload`);

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable || typeof onProgress !== "function") return;
      onProgress(event.loaded / event.total);
    });

    xhr.addEventListener("load", () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText || "{}");
      } catch (error) {
        reject(new Error("Cloudinary tra ve du lieu khong hop le"));
        return;
      }

      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(data?.error?.message || `Cloudinary upload failed: ${xhr.status}`));
        return;
      }

      item.uploadedUrl = data.secure_url || data.url || "";
      if (!item.uploadedUrl) {
        reject(new Error("Cloudinary khong tra ve secure_url"));
        return;
      }

      if (typeof onProgress === "function") onProgress(1);
      resolve(item.uploadedUrl);
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Khong tai duoc anh len Cloudinary"));
    });

    xhr.send(formData);
  });
}

async function createNodesFromPendingImages() {
  if (!state.pendingImages.length) {
    alert("Vui lòng chọn ít nhất một ảnh.");
    return;
  }

  const confirmBtn = document.getElementById("btn-confirm");
  const initialLabel = confirmBtn.textContent;
  confirmBtn.disabled = true;
  setUploadProgress(0, "Dang tai anh 0%");
  confirmBtn.textContent = "Đang tải ảnh...";

  try {
    const uploadItems = state.pendingImages.filter((item) => item.source === "upload");
    const totalUploads = uploadItems.length || 1;
    let completedUploads = 0;
    const resolvedItems = [];

    for (const item of state.pendingImages) {
      let finalSrc = item.src;
      if (item.source === "upload") {
        finalSrc = await uploadPendingImageWithProgress(item, (fraction) => {
          const overall = ((completedUploads + fraction) / totalUploads) * 100;
          setUploadProgress(overall, `Dang tai anh ${Math.round(overall)}%`);
        });
        completedUploads += 1;
        const overall = (completedUploads / totalUploads) * 100;
        setUploadProgress(overall, `Dang tai anh ${Math.round(overall)}%`);
      }

      resolvedItems.push({
        ...item,
        finalSrc,
      });
    }

    commitMutation(() => {
      resolvedItems.forEach((item, index) => {
        const position = getSpawnPos(index);
        const node = normalizeNode({
          id: uid(),
          x: position.x,
          y: position.y,
          w: 220,
          src: item.finalSrc,
          title: normalizeText(nodeTitleInp.value) || `Posing ${item.order || getNextIntegerOrder()}`,
          tag: currentStyle,
          note: normalizeText(nodeNoteInp.value),
          aiNote: "",
          order: normalizeText(item.order) || getNextIntegerOrder([...cs().nodes, ...resolvedItems]),
          createdAt: Date.now() + index,
        }, index, cs().nodes);
        cs().nodes.push(node);
      });
    });

    closeModal();
  } catch (error) {
    console.error(error);
    alert(`Không tải được ảnh lên cloud.\n${error.message}`);
  } finally {
    resetUploadProgress();
    confirmBtn.disabled = false;
    confirmBtn.textContent = initialLabel;
  }
}

function openEditModal(nodeId) {
  const node = getNodeById(nodeId);
  if (!node) return;
  state.editNodeId = nodeId;
  editTitle.value = node.title || "";
  editOrder.value = node.order || "";
  editNote.value = node.note || "";
  editAiNote.value = node.aiNote || "";
  editOverlay.classList.add("open");
}

function closeEditModal() {
  editOverlay.classList.remove("open");
}

function saveEditModal() {
  const nodeId = state.editNodeId;
  if (!nodeId) return;
  commitMutation(() => {
    const node = getNodeById(nodeId);
    if (!node) return;
    node.title = normalizeText(editTitle.value) || node.title || `Posing ${node.order}`;
    node.order = normalizeText(editOrder.value) || node.order || getNextIntegerOrder();
    node.note = normalizeText(editNote.value);
    node.aiNote = normalizeText(editAiNote.value);
  });
  closeEditModal();
}

function openViewerByNodeId(nodeId) {
  const list = getSortedNodes();
  const index = list.findIndex((node) => node.id === nodeId);
  if (index === -1) return;
  state.viewer.list = list;
  state.viewer.index = index;
  state.viewer.open = true;
  renderViewer();
  viewer.classList.add("open");
  viewer.setAttribute("aria-hidden", "false");
}

function renderViewer() {
  if (!state.viewer.open) return;
  const node = state.viewer.list[state.viewer.index];
  if (!node) return;
  viewerImage.src = node.src;
  viewerOrder.textContent = node.order || "-";
  viewerStyle.textContent = node.tag || currentStyle;
  viewerTitle.textContent = node.title || "Untitled";
  viewerNote.textContent = [node.note, node.aiNote].filter(Boolean).join("\n\n");
  resetViewerTransform();
}

function closeViewer() {
  state.viewer.open = false;
  viewer.classList.remove("open");
  viewer.setAttribute("aria-hidden", "true");
  resetViewerTransform();
}

function moveViewer(step) {
  if (!state.viewer.open || !state.viewer.list.length) return;
  const nextIndex = state.viewer.index + step;
  if (nextIndex < 0 || nextIndex >= state.viewer.list.length) return;
  state.viewer.index = nextIndex;
  renderViewer();
}

function getViewerOffsetBounds(scale = state.viewer.scale) {
  const stageWidth = viewerStage.clientWidth;
  const stageHeight = viewerStage.clientHeight;
  const imageWidth = viewerImage.clientWidth;
  const imageHeight = viewerImage.clientHeight;

  if (!stageWidth || !stageHeight || !imageWidth || !imageHeight) {
    return { maxX: 0, maxY: 0 };
  }

  return {
    maxX: Math.max(0, (imageWidth * scale - stageWidth) / 2),
    maxY: Math.max(0, (imageHeight * scale - stageHeight) / 2),
  };
}

function applyViewerTransform() {
  const scale = clamp(state.viewer.scale || 1, 1, 4);
  const bounds = getViewerOffsetBounds(scale);
  state.viewer.scale = scale;
  state.viewer.offsetX = clamp(state.viewer.offsetX || 0, -bounds.maxX, bounds.maxX);
  state.viewer.offsetY = clamp(state.viewer.offsetY || 0, -bounds.maxY, bounds.maxY);
  viewerImage.style.transform = `translate(${state.viewer.offsetX}px, ${state.viewer.offsetY}px) scale(${state.viewer.scale})`;
}

function resetViewerTransform() {
  state.viewer.scale = 1;
  state.viewer.offsetX = 0;
  state.viewer.offsetY = 0;
  state.viewer.pan = null;
  state.viewer.pinch = null;
  state.viewer.touchStartX = 0;
  state.viewer.touchDeltaX = 0;
  viewerImage.style.transform = "";
}

function openPresenterByNodeId(nodeId) {
  const list = getSortedNodes();
  const index = list.findIndex((node) => node.id === nodeId);
  if (index === -1) return;
  state.presenter.list = list;
  state.presenter.index = index;
  state.presenter.open = true;
  renderPresenter();
  presenter.classList.add("open");
  presenter.setAttribute("aria-hidden", "false");
}

function openPresenter() {
  const list = getSortedNodes();
  if (!list.length) return;
  const selectedId = [...state.selectedIds][0];
  const index = selectedId ? Math.max(0, list.findIndex((node) => node.id === selectedId)) : 0;
  state.presenter.list = list;
  state.presenter.index = index;
  state.presenter.open = true;
  renderPresenter();
  presenter.classList.add("open");
  presenter.setAttribute("aria-hidden", "false");
}

function renderPresenter() {
  if (!state.presenter.open) return;
  const node = state.presenter.list[state.presenter.index];
  if (!node) return;
  presenterImage.src = node.src;
  presenterOrder.textContent = node.order || "-";
  presenterStyle.textContent = node.tag || currentStyle;
  presenterTitle.textContent = node.title || "Untitled";
  presenterNote.textContent = [node.note, node.aiNote].filter(Boolean).join("\n\n");
}

function closePresenter() {
  state.presenter.open = false;
  presenter.classList.remove("open");
  presenter.setAttribute("aria-hidden", "true");
}

function movePresenter(step) {
  if (!state.presenter.open || !state.presenter.list.length) return;
  const nextIndex = state.presenter.index + step;
  if (nextIndex < 0 || nextIndex >= state.presenter.list.length) return;
  state.presenter.index = nextIndex;
  renderPresenter();
}

async function ensureOpenAiKey() {
  let apiKey = localStorage.getItem(API_KEY_STORAGE);
  if (apiKey) return apiKey;
  apiKey = prompt("Nhập OpenAI API key để bật AI note:");
  if (!apiKey) return null;
  apiKey = apiKey.trim();
  if (!apiKey) return null;
  localStorage.setItem(API_KEY_STORAGE, apiKey);
  return apiKey;
}

function extractResponseText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const output = Array.isArray(data.output) ? data.output : [];
  const collected = [];
  output.forEach((item) => {
    if (item.type !== "message" || !Array.isArray(item.content)) return;
    item.content.forEach((content) => {
      if (content.type === "output_text" && content.text) collected.push(content.text);
    });
  });
  return collected.join("\n").trim();
}

async function requestAiNoteForImage(src) {
  const apiKey = await ensureOpenAiKey();
  if (!apiKey) throw new Error("Thiếu OpenAI API key.");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "Hãy phân tích ảnh posing này và viết note AI bằng tiếng Việt. " +
                "Trả về đúng 5 dòng theo mẫu: Dáng đứng: ... | Chân tay: ... | Hướng nhìn: ... | Biểu cảm: ... | Kiểu chụp: ...",
            },
            {
              type: "input_image",
              image_url: src,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Không gọi được OpenAI API.");
  }

  const data = await response.json();
  const text = extractResponseText(data);
  if (!text) throw new Error("OpenAI không trả về note AI.");
  return text;
}

async function generateAiNoteForNode(nodeId) {
  const node = getNodeById(nodeId);
  if (!node || !node.src) return;

  try {
    state.aiLoadingNodeId = nodeId;
    renderNodes();
    redrawConnections();
    const note = await requestAiNoteForImage(node.src);
    commitMutation(() => {
      const target = getNodeById(nodeId);
      if (!target) return;
      target.aiNote = note;
      if (state.editNodeId === nodeId) editAiNote.value = note;
    });
  } catch (error) {
    console.error(error);
    alert(`Không tạo được note AI.\n${error.message || "Lỗi không xác định."}`);
  } finally {
    state.aiLoadingNodeId = null;
    renderNodes();
    redrawConnections();
    updateSelectionUI();
  }
}

function averageNumbers(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function countPresent(values) {
  return values.filter(Boolean).length;
}

function buildKeypoint3DMap(pose) {
  const keypoints = {};
  (pose.keypoints3D || []).forEach((point) => {
    if (!point.name) return;
    if ((point.score ?? 1) < 0.12) return;
    keypoints[point.name] = point;
  });
  return keypoints;
}

function getPoseQualityScore(pose) {
  const visible = (pose.keypoints || []).filter((point) => point.name && (point.score ?? 0) >= 0.22);
  if (!visible.length) return -Infinity;

  const avgScore = averageNumbers(visible.map((point) => point.score ?? 0)) || 0;
  const minX = Math.min(...visible.map((point) => point.x));
  const maxX = Math.max(...visible.map((point) => point.x));
  const minY = Math.min(...visible.map((point) => point.y));
  const maxY = Math.max(...visible.map((point) => point.y));
  const area = Math.max(1, (maxX - minX) * (maxY - minY));

  return avgScore * 100 + visible.length * 2 + Math.log(area);
}

function pickBestPose(poses) {
  if (!Array.isArray(poses) || !poses.length) return null;
  return [...poses].sort((poseA, poseB) => getPoseQualityScore(poseB) - getPoseQualityScore(poseA))[0] || null;
}

function describeVisibleCrop(points) {
  const ankleCount = countPresent([points.leftAnkle, points.rightAnkle]);
  const kneeCount = countPresent([points.leftKnee, points.rightKnee]);
  if (ankleCount >= 1) return "khung hình thấy gần như toàn thân";
  if (kneeCount >= 1) return "khung hình thiên về 3/4 người";
  return "khung hình cắt khá cao, chủ yếu thấy nửa trên cơ thể";
}

function inferOverallPose(metrics) {
  const parts = [];

  if (metrics.isSeated) {
    parts.push("ngồi làm dáng");
  } else if (metrics.hasStep) {
    parts.push("đứng chuyển trọng tâm như đang bước");
  } else {
    parts.push("đứng tạo dáng");
  }

  if (metrics.leanStrength >= 14) {
    parts.push(`nghiêng khá rõ về ${metrics.leanSide}`);
  } else if (metrics.leanStrength >= 8) {
    parts.push(`nghiêng nhẹ về ${metrics.leanSide}`);
  }

  parts.push(metrics.cropText);
  return parts.join(", ");
}

function inferLegs(metrics, points) {
  const parts = [];

  if (!points.leftHip && !points.rightHip) {
    return "phần chân không đủ dữ liệu để kết luận chắc chắn";
  }

  if (!points.leftKnee && !points.rightKnee && !points.leftAnkle && !points.rightAnkle) {
    return "ảnh bị cắt nhiều ở phần dưới nên chỉ đọc được rất ít thông tin về chân";
  }

  if (metrics.weightSide) {
    parts.push(`trọng tâm dồn nhiều vào chân ${metrics.weightSide}`);
  }

  if (metrics.hasStep) {
    parts.push(
      metrics.activeLeg
        ? `chân ${metrics.activeLeg} là chân tạo nhịp, tách khỏi chân trụ rõ hơn`
        : "hai chân tách nhịp tạo cảm giác đang bước"
    );
  }

  if (metrics.isCrossed) {
    parts.push("hai chân có xu hướng bắt chéo");
  }

  if (metrics.leftKneeBent || metrics.rightKneeBent) {
    const bentSides = [
      metrics.leftKneeBent ? "trái" : "",
      metrics.rightKneeBent ? "phải" : "",
    ].filter(Boolean);
    parts.push(`gối ${bentSides.join(" / ")} thả mềm`);
  }

  if (!parts.length) {
    parts.push("hai chân giữ thế khá ổn định và cân bằng");
  }

  return parts.join("; ");
}

function describeHand(sideLabel, wrist, elbow, shoulder, hip, nose, shoulderCenter, shoulderWidth) {
  if (!wrist || !shoulder || !hip) return `${sideLabel} bị khuất hoặc nằm ngoài khung`;

  const elbowAngle = getAngle(wrist, elbow, shoulder);
  const nearFace = nose && getDistance(wrist, nose) != null && getDistance(wrist, nose) < shoulderWidth * 0.75;
  const nearHip = getDistance(wrist, hip) != null && getDistance(wrist, hip) < shoulderWidth * 0.62;
  const nearChest =
    shoulderCenter &&
    getDistance(wrist, shoulderCenter) != null &&
    getDistance(wrist, shoulderCenter) < shoulderWidth * 0.72 &&
    wrist.y > shoulder.y - shoulderWidth * 0.12;
  const raised = wrist.y < shoulder.y - shoulderWidth * 0.08;
  const extended = Math.abs(wrist.x - shoulder.x) > shoulderWidth * 0.78;
  const acrossBody =
    shoulderCenter &&
    Math.sign(wrist.x - shoulderCenter.x) !== Math.sign(shoulder.x - shoulderCenter.x);

  if (nearFace) return `${sideLabel} đưa lên gần mặt`;
  if (nearHip) return `${sideLabel} đặt gần hông/eo`;
  if (raised) return `${sideLabel} nâng cao hơn vai`;
  if (extended) return `${sideLabel} mở sang ngang`;
  if (nearChest) return `${sideLabel} gập nhẹ trước ngực`;
  if (acrossBody) return `${sideLabel} vắt chéo trước thân`;
  if (wrist.y > hip.y && elbowAngle != null && elbowAngle > 145) return `${sideLabel} buông dọc theo thân`;
  return `${sideLabel} gập nhẹ theo thân người`;
}

function inferHands(metrics, points) {
  return [
    describeHand(
      "tay trái",
      points.leftWrist,
      points.leftElbow,
      points.leftShoulder,
      points.leftHip,
      points.nose,
      metrics.shoulderCenter,
      metrics.shoulderWidth
    ),
    describeHand(
      "tay phải",
      points.rightWrist,
      points.rightElbow,
      points.rightShoulder,
      points.rightHip,
      points.nose,
      metrics.shoulderCenter,
      metrics.shoulderWidth
    ),
  ].join("; ");
}

function inferBody(metrics) {
  const rotationText =
    metrics.rotationDegrees < 8
      ? "thân gần chính diện"
      : metrics.rotationDegrees < 18
        ? `thân xoay nhẹ khoảng ${metrics.rotationDegrees}°`
        : metrics.rotationDegrees < 32
          ? `thân xoay rõ khoảng ${metrics.rotationDegrees}°`
          : `thân xoay 3/4 khá rõ khoảng ${metrics.rotationDegrees}°`;

  const leanText =
    metrics.leanStrength < 6
      ? "trục thân khá thẳng"
      : metrics.leanStrength < 14
        ? `trục thân nghiêng nhẹ về ${metrics.leanSide}`
        : `trục thân nghiêng rõ về ${metrics.leanSide}`;

  const curveText = metrics.hasSCurve
    ? "eo và hông tạo đường cong chữ S nhẹ"
    : "form thân thiên về đường thẳng gọn";

  return `${rotationText}; ${leanText}; ${curveText}`;
}

function inferFace(metrics, points) {
  const gaze =
    metrics.faceDirection === "gần chính diện"
      ? "mặt gần chính diện"
      : `mặt hướng ${metrics.faceDirection}`;

  const headTiltText =
    metrics.headTiltAbs < 6
      ? "đầu giữ khá thẳng"
      : `đầu nghiêng nhẹ về ${metrics.headTiltSide}`;

  let mood = "thần thái trung tính";
  if (metrics.hasSCurve || metrics.leanStrength >= 8) mood = "thần thái mềm và thời trang";
  if (metrics.hasStep) mood = "thần thái có chuyển động nhẹ";
  if (points.leftWrist && points.rightWrist && metrics.rotationDegrees >= 18) mood = "thần thái tạo dáng rõ";

  return `${gaze}; ${headTiltText}; ${mood}`;
}

function inferAccessories(metrics, points) {
  const interactingNearHip =
    (points.leftWrist && points.leftHip && getDistance(points.leftWrist, points.leftHip) < metrics.shoulderWidth * 0.55) ||
    (points.rightWrist && points.rightHip && getDistance(points.rightWrist, points.rightHip) < metrics.shoulderWidth * 0.55);
  const interactingNearChest =
    metrics.shoulderCenter &&
    ((points.leftWrist && getDistance(points.leftWrist, metrics.shoulderCenter) < metrics.shoulderWidth * 0.7) ||
      (points.rightWrist && getDistance(points.rightWrist, metrics.shoulderCenter) < metrics.shoulderWidth * 0.7));

  if (interactingNearHip || interactingNearChest) {
    return "tay đang tương tác với một điểm nhấn gần thân người, nhưng pose model không xác định chắc chắn đó là túi/hoa/đạo cụ gì";
  }

  return "không suy ra chắc chắn phụ kiện chỉ từ pose; nếu ảnh có túi, kính hoặc đạo cụ thì cần nhìn trực tiếp trên ảnh";
}

function analyzePoseFromKeypoints(pose, image) {
  const keypoints = buildKeypointMap(pose);
  const keypoints3D = buildKeypoint3DMap(pose);
  const points = {
    nose: getNamedPoint(keypoints, "nose"),
    leftEye: getNamedPointFromList(keypoints, ["left_eye", "left_eye_inner"]),
    rightEye: getNamedPointFromList(keypoints, ["right_eye", "right_eye_inner"]),
    leftShoulder: getNamedPoint(keypoints, "left_shoulder"),
    rightShoulder: getNamedPoint(keypoints, "right_shoulder"),
    leftElbow: getNamedPoint(keypoints, "left_elbow"),
    rightElbow: getNamedPoint(keypoints, "right_elbow"),
    leftWrist: getNamedPoint(keypoints, "left_wrist"),
    rightWrist: getNamedPoint(keypoints, "right_wrist"),
    leftHip: getNamedPoint(keypoints, "left_hip"),
    rightHip: getNamedPoint(keypoints, "right_hip"),
    leftKnee: getNamedPoint(keypoints, "left_knee"),
    rightKnee: getNamedPoint(keypoints, "right_knee"),
    leftAnkle: getNamedPoint(keypoints, "left_ankle"),
    rightAnkle: getNamedPoint(keypoints, "right_ankle"),
  };

  const shoulderCenter = getMidpoint(points.leftShoulder, points.rightShoulder);
  const hipCenter = getMidpoint(points.leftHip, points.rightHip);
  const kneeCenter = getMidpoint(points.leftKnee, points.rightKnee);
  const ankleCenter = getMidpoint(points.leftAnkle, points.rightAnkle);
  const eyeCenter = getMidpoint(points.leftEye, points.rightEye);

  const visibleCoreCount = countPresent([
    points.leftShoulder,
    points.rightShoulder,
    points.leftHip,
    points.rightHip,
    points.leftKnee,
    points.rightKnee,
    points.leftAnkle,
    points.rightAnkle,
  ]);

  if (!shoulderCenter || !hipCenter || visibleCoreCount < 4) {
    throw new Error("AI chưa thấy đủ vai, hông và chân để mô tả dáng ổn định. Nên dùng ảnh rõ người hơn.");
  }

  const shoulderWidth = getDistance(points.leftShoulder, points.rightShoulder) || 120;
  const torsoLength = getDistance(shoulderCenter, hipCenter) || shoulderWidth;
  const leftKneeAngle = getAngle(points.leftHip, points.leftKnee, points.leftAnkle);
  const rightKneeAngle = getAngle(points.rightHip, points.rightKnee, points.rightAnkle);
  const avgKneeAngle = averageNumbers([leftKneeAngle, rightKneeAngle]);
  const shoulderTiltSigned = points.leftShoulder && points.rightShoulder
    ? toDegrees(Math.atan2(points.rightShoulder.y - points.leftShoulder.y, points.rightShoulder.x - points.leftShoulder.x))
    : 0;
  const hipTiltSigned = points.leftHip && points.rightHip
    ? toDegrees(Math.atan2(points.rightHip.y - points.leftHip.y, points.rightHip.x - points.leftHip.x))
    : 0;
  const torsoLeanSigned = toDegrees(Math.atan2(shoulderCenter.x - hipCenter.x, hipCenter.y - shoulderCenter.y));
  const eyeTiltSigned = points.leftEye && points.rightEye
    ? toDegrees(Math.atan2(points.rightEye.y - points.leftEye.y, points.rightEye.x - points.leftEye.x))
    : 0;
  const noseOffset = points.nose ? points.nose.x - shoulderCenter.x : eyeCenter ? eyeCenter.x - shoulderCenter.x : 0;
  const rotation2D = clamp(Math.abs(noseOffset) / Math.max(shoulderWidth, 1), 0, 1) * 42;

  const leftShoulder3D = getNamedPoint(keypoints3D, "left_shoulder");
  const rightShoulder3D = getNamedPoint(keypoints3D, "right_shoulder");
  const rotation3D =
    leftShoulder3D && rightShoulder3D
      ? clamp(Math.abs((leftShoulder3D.z ?? 0) - (rightShoulder3D.z ?? 0)) / 0.35, 0, 1) * 45
      : 0;
  const rotationDegrees = Math.round(Math.max(rotation2D, rotation3D));

  const ankleSpread = points.leftAnkle && points.rightAnkle ? Math.abs(points.leftAnkle.x - points.rightAnkle.x) : 0;
  const hipToKneeVertical = kneeCenter ? Math.abs(kneeCenter.y - hipCenter.y) : null;
  const ankleLevelDiff = points.leftAnkle && points.rightAnkle ? Math.abs(points.leftAnkle.y - points.rightAnkle.y) : 0;
  const leftKneeBent = leftKneeAngle != null && leftKneeAngle < 158;
  const rightKneeBent = rightKneeAngle != null && rightKneeAngle < 158;
  const isSeated =
    hipToKneeVertical != null &&
    hipToKneeVertical < torsoLength * 0.62 &&
    avgKneeAngle != null &&
    avgKneeAngle < 150;
  const hasStep =
    !isSeated &&
    (
      ankleSpread > shoulderWidth * 0.82 ||
      (ankleSpread > shoulderWidth * 0.58 && (leftKneeBent !== rightKneeBent || ankleLevelDiff > torsoLength * 0.08))
    );
  const isCrossed =
    points.leftAnkle &&
    points.rightAnkle &&
    points.leftHip &&
    points.rightHip &&
    Math.sign(points.leftAnkle.x - points.rightAnkle.x) !== Math.sign(points.leftHip.x - points.rightHip.x);

  const leftSupportBias =
    (leftKneeBent ? 0 : 1) +
    (points.leftAnkle && Math.abs(hipCenter.x - points.leftAnkle.x) < shoulderWidth * 0.5 ? 1 : 0);
  const rightSupportBias =
    (rightKneeBent ? 0 : 1) +
    (points.rightAnkle && Math.abs(hipCenter.x - points.rightAnkle.x) < shoulderWidth * 0.5 ? 1 : 0);

  const weightSide =
    leftSupportBias === rightSupportBias
      ? ""
      : leftSupportBias > rightSupportBias
        ? "trái"
        : "phải";

  let activeLeg = "";
  if (leftKneeBent !== rightKneeBent) {
    activeLeg = leftKneeBent ? "trái" : "phải";
  } else if (points.leftAnkle && points.rightAnkle && points.leftHip && points.rightHip) {
    const leftReach = Math.abs(points.leftAnkle.x - points.leftHip.x);
    const rightReach = Math.abs(points.rightAnkle.x - points.rightHip.x);
    if (Math.abs(leftReach - rightReach) > shoulderWidth * 0.12) {
      activeLeg = leftReach > rightReach ? "trái" : "phải";
    }
  }

  const hasSCurve =
    (Math.sign(shoulderTiltSigned || 0.001) !== Math.sign(hipTiltSigned || -0.001) && Math.abs(shoulderTiltSigned - hipTiltSigned) > 8) ||
    ((leftKneeBent !== rightKneeBent) && Math.abs(torsoLeanSigned) > 4);

  const metrics = {
    imageWidth: image && image.naturalWidth ? image.naturalWidth : 0,
    imageHeight: image && image.naturalHeight ? image.naturalHeight : 0,
    shoulderCenter,
    shoulderWidth,
    rotationDegrees,
    leanStrength: Math.abs(torsoLeanSigned),
    leanSide: torsoLeanSigned > 0 ? "phải khung hình" : "trái khung hình",
    headTiltAbs: Math.abs(eyeTiltSigned),
    headTiltSide: eyeTiltSigned > 0 ? "phải khung hình" : "trái khung hình",
    faceDirection:
      rotationDegrees < 8
        ? "gần chính diện"
        : noseOffset > 0
          ? "sang phải khung hình"
          : "sang trái khung hình",
    cropText: describeVisibleCrop(points),
    leftKneeBent,
    rightKneeBent,
    isSeated,
    hasStep,
    isCrossed,
    weightSide,
    activeLeg,
    hasSCurve,
  };

  return [
    `Dáng tổng thể: ${inferOverallPose(metrics)}.`,
    `Chân: ${inferLegs(metrics, points)}.`,
    `Tay: ${inferHands(metrics, points)}.`,
    `Thân người: ${inferBody(metrics)}.`,
    `Mặt & ánh mắt: ${inferFace(metrics, points)}.`,
    `Phụ kiện: ${inferAccessories(metrics, points)}.`,
  ].join("\n");
}

async function requestAiNoteForImage(src) {
  const detector = await ensurePoseDetector();
  const image = await loadImageForPose(src);
  const poses = await detector.estimatePoses(image, {
    flipHorizontal: false,
  });
  const pose = pickBestPose(poses);
  if (!pose || !Array.isArray(pose.keypoints) || !pose.keypoints.length) {
    throw new Error("AI chưa nhận ra dáng người trong ảnh.");
  }
  return analyzePoseFromKeypoints(pose, image);
}

function setMode(mode) {
  state.mode = mode;
  document.getElementById("tool-hand").classList.toggle("active", mode === "pan");
  ensureMultiSelectTool()?.classList.toggle("active", mode === "multi-select");
  document.getElementById("tool-connect").classList.toggle("active", mode === "connect");
  document.getElementById("tool-delete-conn").classList.toggle("active", mode === "delete-conn");
  canvasWrapper.classList.toggle("connecting", mode === "connect");
  canvasWrapper.classList.toggle("multi-selecting", mode === "multi-select");
  svg.classList.toggle("allow-pointer", mode === "delete-conn");
}

function updateSelectionMarqueeBox(startX, startY, currentX, currentY) {
  if (!selectionMarquee) return;
  const left = Math.min(startX, currentX);
  const top = Math.min(startY, currentY);
  const width = Math.abs(currentX - startX);
  const height = Math.abs(currentY - startY);
  selectionMarquee.style.left = `${left}px`;
  selectionMarquee.style.top = `${top}px`;
  selectionMarquee.style.width = `${width}px`;
  selectionMarquee.style.height = `${height}px`;
  selectionMarquee.hidden = width < 2 && height < 2;
}

function hideSelectionMarquee() {
  if (!selectionMarquee) return;
  selectionMarquee.hidden = true;
  selectionMarquee.style.width = "0px";
  selectionMarquee.style.height = "0px";
}

function getNodeScreenBox(node) {
  const position = canvasToScreen(node.x, node.y);
  return {
    left: position.x,
    top: position.y,
    right: position.x + node.w * cs().zoom,
    bottom: position.y + getNodeHeight(node.id) * cs().zoom,
  };
}

function getNodesInsideMarquee(rect) {
  return cs().nodes
    .filter((node) => {
      const box = getNodeScreenBox(node);
      return !(
        box.right < rect.left ||
        box.left > rect.right ||
        box.bottom < rect.top ||
        box.top > rect.bottom
      );
    })
    .map((node) => node.id);
}

function deleteCurrentStyle() {
  if (!confirm(`Xóa toàn bộ tab ${currentStyle}? Không thể hoàn tác.`)) return;
  commitMutation(() => {
    styleData[currentStyle] = createEmptyStyleState();
    clearSelection();
  });
}

function startConnectionFromNode(event, nodeId, side) {
  event.stopPropagation();
  event.preventDefault();
  state.connect = {
    pointerId: event.pointerId,
    fromId: nodeId,
    fromSide: side,
  };
  if (state.tempLine) state.tempLine.remove();
  state.tempLine = document.createElementNS("http://www.w3.org/2000/svg", "path");
  state.tempLine.classList.add("conn-line", "temp");
  svg.appendChild(state.tempLine);
  updateTempConnectionLine(getAnchorPos(nodeId, side));
}

function updateTempConnectionLine(point = null) {
  if (!state.connect || !state.tempLine) return;
  const start = getAnchorPos(state.connect.fromId, state.connect.fromSide);
  const end = point || start;
  const distance = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y)) * 0.42 + 36;
  const cp1 = sideOffset(start, start.side, distance);
  const cp2 = sideOffset(end, end.side || "l", distance);
  state.tempLine.setAttribute("d", `M ${start.x} ${start.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${end.x} ${end.y}`);
}

function finishConnection(event) {
  if (!state.connect || state.connect.pointerId !== event.pointerId) return;
  const rect = canvasWrapper.getBoundingClientRect();
  const point = screenToCanvas(event.clientX - rect.left, event.clientY - rect.top);
  const element = document.elementFromPoint(event.clientX, event.clientY);
  const targetAnchor = element?.classList?.contains("anchor") ? element : element?.closest?.(".anchor");
  const targetNodeEl = element?.classList?.contains("node") ? element : element?.closest?.(".node");

  let toId = null;
  let toSide = null;

  if (targetAnchor) {
    toId = targetAnchor.closest(".node").id.replace("node-", "");
    toSide = targetAnchor.dataset.side;
  } else if (targetNodeEl) {
    toId = targetNodeEl.id.replace("node-", "");
    toSide = getNearestSideFromPoint(toId, point);
  }

  if (toId && toId !== state.connect.fromId) {
    const fromId = state.connect.fromId;
    const fromSide = state.connect.fromSide;
    const exists = cs().connections.some((connection) => {
      return (
        (connection.fromId === fromId &&
          connection.fromSide === fromSide &&
          connection.toId === toId &&
          connection.toSide === toSide) ||
        (connection.fromId === toId &&
          connection.fromSide === toSide &&
          connection.toId === fromId &&
          connection.toSide === fromSide)
      );
    });

    if (!exists) {
      commitMutation(() => {
        cs().connections.push({
          id: cuid(),
          fromId,
          fromSide,
          toId,
          toSide,
        });
      });
    }
  }

  if (state.tempLine) {
    state.tempLine.remove();
    state.tempLine = null;
  }
  state.connect = null;
}

function onNodePointerDown(event) {
  if (event.button !== 0 && event.pointerType !== "touch") return;
  const target = event.target;
  if (
    target.closest(".node-delete") ||
    target.closest(".node-view-btn") ||
    target.closest(".node-ai-btn") ||
    target.closest(".resize-handle") ||
    target.closest(".anchor") ||
    target.contentEditable === "true"
  ) {
    return;
  }

  const nodeEl = event.currentTarget;
  const nodeId = nodeEl.id.replace("node-", "");
  const node = getNodeById(nodeId);
  if (!node) return;

  const isToggle = event.shiftKey || event.metaKey || event.ctrlKey;
  const isMultiSelectMode = state.mode === "multi-select";
  if (isToggle) {
    toggleSelected(nodeId);
  } else if (isMultiSelectMode) {
    if (!state.selectedIds.has(nodeId)) {
      setSelected([...state.selectedIds, nodeId]);
    }
  } else if (!state.selectedIds.has(nodeId)) {
    setSelected([nodeId]);
  }

  if (state.mode === "connect") {
    const rect = canvasWrapper.getBoundingClientRect();
    const point = screenToCanvas(event.clientX - rect.left, event.clientY - rect.top);
    startConnectionFromNode(event, nodeId, getNearestSideFromPoint(nodeId, point));
    return;
  }

  const idsToDrag = state.selectedIds.has(nodeId) ? [...state.selectedIds] : [nodeId];
  const rect = canvasWrapper.getBoundingClientRect();
  const point = screenToCanvas(event.clientX - rect.left, event.clientY - rect.top);
  const origins = idsToDrag.map((id) => {
    const item = getNodeById(id);
    return { id, x: item.x, y: item.y };
  });

  state.drag = {
    pointerId: event.pointerId,
    anchorNodeId: nodeId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startPoint: point,
    origins,
    moved: false,
    historyRecorded: false,
  };

  nodeEl.setPointerCapture?.(event.pointerId);
  event.stopPropagation();
  event.preventDefault();
}

function onResizePointerDown(event, nodeId, dir) {
  if (state.mode === "connect") return;
  event.stopPropagation();
  event.preventDefault();

  const node = getNodeById(nodeId);
  if (!node) return;

  state.resize = {
    pointerId: event.pointerId,
    nodeId,
    dir,
    startMouseX: event.clientX,
    startMouseY: event.clientY,
    startWidth: node.w,
    startX: node.x,
    startY: node.y,
    aspectRatio: node.aspectRatio || 1,
    historyRecorded: false,
  };

  document.getElementById(`node-${nodeId}`)?.setPointerCapture?.(event.pointerId);
}

function onCanvasPointerDown(event) {
  if (event.target !== canvasWrapper && event.target !== canvas) return;
  closeMenus();
  if (state.mode === "multi-select") {
    const rect = canvasWrapper.getBoundingClientRect();
    const startX = event.clientX - rect.left;
    const startY = event.clientY - rect.top;
    state.marquee = {
      pointerId: event.pointerId,
      startX,
      startY,
      currentX: startX,
      currentY: startY,
      additive: event.shiftKey || event.metaKey || event.ctrlKey,
      baseSelection: new Set(event.shiftKey || event.metaKey || event.ctrlKey ? state.selectedIds : []),
      historyRecorded: false,
    };
    updateSelectionMarqueeBox(startX, startY, startX, startY);
    canvasWrapper.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    return;
  }
  if (!event.shiftKey && !event.metaKey && !event.ctrlKey && state.mode !== "multi-select") clearSelection();
  state.pan = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originX: cs().pan.x,
    originY: cs().pan.y,
  };
  canvasWrapper.classList.add("grabbing");
  canvasWrapper.setPointerCapture?.(event.pointerId);
}

function cancelBoardInteractionState() {
  state.pan = null;
  state.drag = null;
  state.marquee = null;
  state.resize = null;
  if (state.connect && state.tempLine) {
    state.tempLine.remove();
    state.tempLine = null;
  }
  state.connect = null;
  canvasWrapper.classList.remove("grabbing");
  hideSelectionMarquee();
}

function startBoardPinch(touches) {
  if (touches.length < 2) return;
  const rect = canvasWrapper.getBoundingClientRect();
  const midpoint = getTouchMidpoint(touches[0], touches[1], rect);
  state.boardPinch = {
    startDistance: getTouchDistance(touches[0], touches[1]),
    startZoom: cs().zoom,
    anchor: screenToCanvas(midpoint.x, midpoint.y),
  };
}

function onGlobalPointerMove(event) {
  if (state.pan && state.pan.pointerId === event.pointerId) {
    cs().pan.x = state.pan.originX + (event.clientX - state.pan.startX);
    cs().pan.y = state.pan.originY + (event.clientY - state.pan.startY);
    applyTransform();
  }

  if (state.marquee && state.marquee.pointerId === event.pointerId) {
    const rect = canvasWrapper.getBoundingClientRect();
    state.marquee.currentX = event.clientX - rect.left;
    state.marquee.currentY = event.clientY - rect.top;
    updateSelectionMarqueeBox(
      state.marquee.startX,
      state.marquee.startY,
      state.marquee.currentX,
      state.marquee.currentY
    );

    const selectionRect = {
      left: Math.min(state.marquee.startX, state.marquee.currentX),
      top: Math.min(state.marquee.startY, state.marquee.currentY),
      right: Math.max(state.marquee.startX, state.marquee.currentX),
      bottom: Math.max(state.marquee.startY, state.marquee.currentY),
    };
    const next = new Set(state.marquee.baseSelection);
    getNodesInsideMarquee(selectionRect).forEach((nodeId) => next.add(nodeId));
    setSelected(next);
  }

  if (state.drag && state.drag.pointerId === event.pointerId) {
    const pointerTravel = Math.hypot(
      event.clientX - state.drag.startClientX,
      event.clientY - state.drag.startClientY
    );
    if (!state.drag.moved && pointerTravel < 4) {
      return;
    }
    state.drag.moved = true;
    if (!state.drag.historyRecorded) {
      pushHistorySnapshot(snapshotState());
      state.drag.historyRecorded = true;
      updateHistoryButtons();
    }
    const rect = canvasWrapper.getBoundingClientRect();
    const point = screenToCanvas(event.clientX - rect.left, event.clientY - rect.top);
    const dx = point.x - state.drag.startPoint.x;
    const dy = point.y - state.drag.startPoint.y;
    state.drag.origins.forEach((origin) => {
      const node = getNodeById(origin.id);
      if (!node) return;
      node.x = origin.x + dx;
      node.y = origin.y + dy;
      const el = document.getElementById(`node-${origin.id}`);
      if (el) {
        el.style.left = `${node.x}px`;
        el.style.top = `${node.y}px`;
      }
    });
    redrawConnections();
  }

  if (state.resize && state.resize.pointerId === event.pointerId) {
    if (!state.resize.historyRecorded) {
      pushHistorySnapshot(snapshotState());
      state.resize.historyRecorded = true;
      updateHistoryButtons();
    }

    const info = state.resize;
    const node = getNodeById(info.nodeId);
    if (!node) return;
    const dx = (event.clientX - info.startMouseX) / cs().zoom;
    const dir = info.dir;
    let width = info.startWidth;
    let x = info.startX;

    if (dir.includes("e")) width = Math.max(MIN_WIDTH, info.startWidth + dx);
    if (dir.includes("w")) {
      width = Math.max(MIN_WIDTH, info.startWidth - dx);
      x = info.startX + (info.startWidth - width);
    }

    node.w = width;
    node.x = x;
    const el = document.getElementById(`node-${node.id}`);
    if (el) {
      el.style.width = `${width}px`;
      el.style.left = `${x}px`;
      const imageWrap = el.querySelector(".node-img-wrap");
      if (imageWrap) imageWrap.style.aspectRatio = String(node.aspectRatio || info.aspectRatio || 1);
    }
    redrawConnections();
  }

  if (state.connect && state.connect.pointerId === event.pointerId) {
    const rect = canvasWrapper.getBoundingClientRect();
    const point = screenToCanvas(event.clientX - rect.left, event.clientY - rect.top);
    updateTempConnectionLine({ x: point.x, y: point.y, side: "l" });
  }
}

function onGlobalPointerUp(event) {
  if (state.pan && state.pan.pointerId === event.pointerId) {
    state.pan = null;
    canvasWrapper.classList.remove("grabbing");
    saveAll();
  }

  if (state.marquee && state.marquee.pointerId === event.pointerId) {
    const width = Math.abs(state.marquee.currentX - state.marquee.startX);
    const height = Math.abs(state.marquee.currentY - state.marquee.startY);
    if (width < 4 && height < 4 && !state.marquee.additive) {
      state.skipCanvasClickClear = false;
    }
    state.marquee = null;
    hideSelectionMarquee();
  }

  if (state.drag && state.drag.pointerId === event.pointerId) {
    const shouldSaveDrag = state.drag.moved;
    state.drag = null;
    if (shouldSaveDrag) saveAll();
  }

  if (state.resize && state.resize.pointerId === event.pointerId) {
    state.resize = null;
    saveAll();
  }

  if (state.connect && state.connect.pointerId === event.pointerId) {
    finishConnection(event);
    saveAll();
  }
}

function fitAllNodes() {
  const nodes = cs().nodes;
  if (!nodes.length) return;
  const rect = canvasWrapper.getBoundingClientRect();
  const pad = 60;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  nodes.forEach((node) => {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.w);
    maxY = Math.max(maxY, node.y + getNodeHeight(node.id));
  });

  const zoom = Math.min((rect.width - pad * 2) / Math.max(1, maxX - minX), (rect.height - pad * 2) / Math.max(1, maxY - minY), 3);
  cs().zoom = zoom;
  cs().pan.x = BOARD_OFFSET + (rect.width - (maxX - minX) * zoom) / 2 - minX * zoom;
  cs().pan.y = BOARD_OFFSET + (rect.height - (maxY - minY) * zoom) / 2 - minY * zoom;
  applyTransform();
  saveAll();
}

function centerCanvasAt(x, y) {
  const rect = canvasWrapper.getBoundingClientRect();
  cs().pan.x = BOARD_OFFSET + rect.width / 2 - x * cs().zoom;
  cs().pan.y = BOARD_OFFSET + rect.height / 2 - y * cs().zoom;
  applyTransform();
  saveAll();
}

function switchStyle(styleName) {
  currentStyle = styleName;
  styleBadge.textContent = styleName;
  document.querySelectorAll(".style-option").forEach((option) => {
    option.classList.toggle("active", option.dataset.style === styleName);
  });
  clearSelection();
  closeMenus();
  renderAll();
  applyTransform();
  saveAll();
}

function layoutNodes(type) {
  const nodes = getSortedNodes();
  if (!nodes.length) return;

  commitMutation(() => {
    const startX = 180;
    const startY = 120;
    const gapX = 260;
    const gapY = 260;

    if (type === "grid") {
      const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
      nodes.forEach((node, index) => {
        node.x = startX + (index % columns) * gapX;
        node.y = startY + Math.floor(index / columns) * gapY;
      });
    }

    if (type === "row") {
      nodes.forEach((node, index) => {
        node.x = startX + index * gapX;
        node.y = startY;
      });
    }

    if (type === "column") {
      nodes.forEach((node, index) => {
        node.x = startX;
        node.y = startY + index * gapY;
      });
    }

    if (type === "mindmap") {
      const root = nodes[0];
      root.x = startX + 420;
      root.y = startY + gapY;
      nodes.slice(1).forEach((node, index) => {
        const isLeft = index % 2 === 0;
        const column = Math.floor(index / 2);
        node.x = root.x + (isLeft ? -gapX : gapX);
        node.y = root.y + (column - Math.floor((nodes.length - 1) / 4)) * 220;
      });
    }
  });

  fitAllNodes();
}

function alignSelected(direction) {
  const selected = [...state.selectedIds].map(getNodeById).filter(Boolean);
  if (selected.length < 2) return;
  commitMutation(() => {
    if (direction === "left") {
      const left = Math.min(...selected.map((node) => node.x));
      selected.forEach((node) => { node.x = left; });
    }
    if (direction === "top") {
      const top = Math.min(...selected.map((node) => node.y));
      selected.forEach((node) => { node.y = top; });
    }
  });
}

function distributeSelected(axis) {
  const selected = [...state.selectedIds].map(getNodeById).filter(Boolean);
  if (selected.length < 3) return;
  const sorted = [...selected].sort((a, b) => (axis === "x" ? a.x - b.x : a.y - b.y));
  commitMutation(() => {
    const first = axis === "x" ? sorted[0].x : sorted[0].y;
    const last = axis === "x" ? sorted[sorted.length - 1].x : sorted[sorted.length - 1].y;
    const step = (last - first) / (sorted.length - 1);
    sorted.forEach((node, index) => {
      if (axis === "x") node.x = first + step * index;
      else node.y = first + step * index;
    });
  });
}

function duplicateSelection() {
  const selected = [...state.selectedIds].map(getNodeById).filter(Boolean);
  if (!selected.length) return;
  const selectedIds = new Set(selected.map((node) => node.id));

  commitMutation(() => {
    const idMap = new Map();
    const newIds = [];
    selected.forEach((node, index) => {
      const cloned = cloneData(node);
      cloned.id = uid();
      cloned.x += DUPLICATE_OFFSET;
      cloned.y += DUPLICATE_OFFSET;
      cloned.createdAt = Date.now() + index;
      idMap.set(node.id, cloned.id);
      cs().nodes.push(cloned);
      newIds.push(cloned.id);
    });

    cs().connections
      .filter((connection) => selectedIds.has(connection.fromId) && selectedIds.has(connection.toId))
      .forEach((connection) => {
        cs().connections.push({
          id: cuid(),
          fromId: idMap.get(connection.fromId),
          fromSide: connection.fromSide,
          toId: idMap.get(connection.toId),
          toSide: connection.toSide,
        });
      });

    setSelected(newIds);
  });
}

function copySelection() {
  const selected = [...state.selectedIds].map(getNodeById).filter(Boolean);
  if (!selected.length) return;
  const ids = new Set(selected.map((node) => node.id));
  state.clipboard = {
    nodes: cloneData(selected),
    connections: cloneData(cs().connections.filter((connection) => ids.has(connection.fromId) && ids.has(connection.toId))),
  };
}

function pasteClipboard() {
  if (!state.clipboard?.nodes?.length) return;
  commitMutation(() => {
    const idMap = new Map();
    const newIds = [];
    state.clipboard.nodes.forEach((node, index) => {
      const cloned = cloneData(node);
      cloned.id = uid();
      cloned.x += DUPLICATE_OFFSET;
      cloned.y += DUPLICATE_OFFSET;
      cloned.createdAt = Date.now() + index;
      idMap.set(node.id, cloned.id);
      cs().nodes.push(cloned);
      newIds.push(cloned.id);
    });

    state.clipboard.connections.forEach((connection) => {
      cs().connections.push({
        id: cuid(),
        fromId: idMap.get(connection.fromId),
        fromSide: connection.fromSide,
        toId: idMap.get(connection.toId),
        toSide: connection.toSide,
      });
    });

    setSelected(newIds);
  });
}

function openShotList() {
  state.shotListOpen = true;
  renderShotList();
}

function closeShotList() {
  state.shotListOpen = false;
  renderShotList();
}

function toggleShotList() {
  state.shotListOpen = !state.shotListOpen;
  renderShotList();
}

function onBoardTouchStart(event) {
  if (event.touches.length < 2) return;
  cancelBoardInteractionState();
  startBoardPinch(event.touches);
  event.preventDefault();
}

function onBoardTouchMove(event) {
  if (!state.boardPinch || event.touches.length < 2) return;
  const rect = canvasWrapper.getBoundingClientRect();
  const midpoint = getTouchMidpoint(event.touches[0], event.touches[1], rect);
  const distance = getTouchDistance(event.touches[0], event.touches[1]);
  const nextZoom = clamp((state.boardPinch.startZoom * distance) / Math.max(state.boardPinch.startDistance, 1), 0.12, 4.5);
  cs().zoom = nextZoom;
  cs().pan.x = BOARD_OFFSET + midpoint.x - state.boardPinch.anchor.x * nextZoom;
  cs().pan.y = BOARD_OFFSET + midpoint.y - state.boardPinch.anchor.y * nextZoom;
  applyTransform();
  event.preventDefault();
}

function onBoardTouchEnd(event) {
  if (!state.boardPinch) return;
  if (event.touches.length >= 2) {
    startBoardPinch(event.touches);
    return;
  }
  state.boardPinch = null;
  saveAll();
}

function startViewerPinch(touches) {
  if (touches.length < 2) return;
  state.viewer.touchStartX = 0;
  state.viewer.touchDeltaX = 0;
  state.viewer.pan = null;
  state.viewer.pinch = {
    startDistance: getTouchDistance(touches[0], touches[1]),
    startScale: state.viewer.scale,
    startOffsetX: state.viewer.offsetX,
    startOffsetY: state.viewer.offsetY,
    startMidX: (touches[0].clientX + touches[1].clientX) / 2,
    startMidY: (touches[0].clientY + touches[1].clientY) / 2,
  };
}

function onViewerTouchStart(event) {
  if (event.touches.length >= 2) {
    startViewerPinch(event.touches);
    event.preventDefault();
    return;
  }

  if (event.touches.length !== 1) return;

  if (state.viewer.scale > 1.01) {
    state.viewer.pan = {
      startX: event.touches[0].clientX,
      startY: event.touches[0].clientY,
      originX: state.viewer.offsetX,
      originY: state.viewer.offsetY,
    };
    state.viewer.touchStartX = 0;
    state.viewer.touchDeltaX = 0;
    return;
  }

  state.viewer.touchStartX = event.touches[0].clientX;
  state.viewer.touchDeltaX = 0;
}

function onViewerTouchMove(event) {
  if (event.touches.length >= 2) {
    if (!state.viewer.pinch) startViewerPinch(event.touches);
    const distance = getTouchDistance(event.touches[0], event.touches[1]);
    const midpointX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
    const midpointY = (event.touches[0].clientY + event.touches[1].clientY) / 2;
    state.viewer.scale = clamp(
      (state.viewer.pinch.startScale * distance) / Math.max(state.viewer.pinch.startDistance, 1),
      1,
      4
    );
    state.viewer.offsetX = state.viewer.pinch.startOffsetX + (midpointX - state.viewer.pinch.startMidX);
    state.viewer.offsetY = state.viewer.pinch.startOffsetY + (midpointY - state.viewer.pinch.startMidY);
    applyViewerTransform();
    event.preventDefault();
    return;
  }

  if (event.touches.length !== 1) return;

  if (state.viewer.scale > 1.01 && state.viewer.pan) {
    state.viewer.offsetX = state.viewer.pan.originX + (event.touches[0].clientX - state.viewer.pan.startX);
    state.viewer.offsetY = state.viewer.pan.originY + (event.touches[0].clientY - state.viewer.pan.startY);
    applyViewerTransform();
    event.preventDefault();
    return;
  }

  state.viewer.touchDeltaX = event.touches[0].clientX - state.viewer.touchStartX;
}

function onViewerTouchEnd(event) {
  if (event.touches.length >= 2) {
    startViewerPinch(event.touches);
    return;
  }

  if (state.viewer.pinch && event.touches.length < 2) {
    state.viewer.pinch = null;
  }

  if (event.touches.length === 1 && state.viewer.scale > 1.01) {
    state.viewer.pan = {
      startX: event.touches[0].clientX,
      startY: event.touches[0].clientY,
      originX: state.viewer.offsetX,
      originY: state.viewer.offsetY,
    };
    return;
  }

  if (!event.touches.length && state.viewer.scale <= 1.01) {
    if (state.viewer.touchDeltaX <= -48) moveViewer(1);
    if (state.viewer.touchDeltaX >= 48) moveViewer(-1);
    resetViewerTransform();
    return;
  }

  state.viewer.pan = null;
  state.viewer.touchStartX = 0;
  state.viewer.touchDeltaX = 0;
  applyViewerTransform();
}

function bindEvents() {
  const multiSelectTool = ensureMultiSelectTool();

  if (authForm) {
    authForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      setAuthError("");
      setAuthSubmitting(true, "Dang dang nhap...");
      setAuthProgress("signing_in", "Dang ket noi");

      try {
        const username = normalizeText(authUsername?.value);
        const password = String(authPassword?.value || "");
        const remember = !!authRemember?.checked;
        const data = await loginWithSheet(username, password);
        setAuthSubmitting(true, "Dang nhap thanh cong");
        setAuthProgress("signed_in", "Tai khoan hop le");
        await wait(220);
        setAuthSubmitting(true, "Dang kiem tra tai khoan...");
        setAuthProgress("checking", "Dang xac nhan thong tin");
        if (!data.ok) throw new Error("Sai tài khoản hoặc mật khẩu.");

        state.auth.username = username;
        state.auth.password = remember ? password : "";
        state.auth.remember = remember;
        state.auth.user = data.user || {
          username,
          displayName: username,
        };
        persistAuth();
        updateAuthUI();
        setAuthSubmitting(true, "Dang mo du an...");
        setAuthProgress("opening", "Dang tai du lieu du an");
        await bootBoardApp();
        setAuthProgress("complete", "Du an da san sang");
      } catch (error) {
        console.error(error);
        const message = error?.message || "";
        if (/tài khoản|mật khẩu|dang nhap|đăng nhập/i.test(message)) {
          setAuthError("Sai tài khoản hoặc mật khẩu.");
        } else {
          setAuthError(message || "Đăng nhập thất bại.");
        }
      } finally {
        setAuthSubmitting(false);
        setAuthProgress("idle");
      }
    });
  }

  if (logoutButton) {
    logoutButton.addEventListener("click", logoutAuth);
  }

  document.getElementById("btn-add-node").addEventListener("click", openModal);
  document.getElementById("btn-undo").addEventListener("click", undo);
  document.getElementById("btn-redo").addEventListener("click", redo);
  document.getElementById("btn-fit-view").addEventListener("click", fitAllNodes);
  document.getElementById("btn-shot-list").addEventListener("click", toggleShotList);
  document.getElementById("btn-presenter").addEventListener("click", openPresenter);
  document.getElementById("btn-layout-menu").addEventListener("click", (event) => {
    event.stopPropagation();
    layoutMenu.classList.toggle("open");
  });
  document.querySelectorAll("[data-layout]").forEach((button) => {
    button.addEventListener("click", () => {
      layoutMenu.classList.remove("open");
      layoutNodes(button.dataset.layout);
    });
  });

  document.getElementById("btn-ai-settings").addEventListener("click", async () => {
    try {
      await ensurePoseDetector();
      alert("AI pose local đã sẵn sàng. Bấm 'AI note' trên ảnh để tự phân tích dáng.");
    } catch (error) {
      console.error(error);
      alert(`Không tải được AI pose local.\n${error.message || "Lỗi không xác định."}`);
    }
  });

  document.getElementById("btn-clear-all").addEventListener("click", deleteCurrentStyle);
  document.getElementById("tool-hand").addEventListener("click", () => setMode("pan"));
  document.getElementById("tool-add").addEventListener("click", openModal);
  multiSelectTool?.addEventListener("click", () => setMode(state.mode === "multi-select" ? "pan" : "multi-select"));
  document.getElementById("tool-connect").addEventListener("click", () => setMode(state.mode === "connect" ? "pan" : "connect"));
  document.getElementById("tool-delete-conn").addEventListener("click", () => setMode(state.mode === "delete-conn" ? "pan" : "delete-conn"));

  styleDropBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    styleDropBtn.classList.toggle("open");
    styleDropMenu.classList.toggle("open");
  });
  document.querySelectorAll(".style-option").forEach((button) => {
    button.addEventListener("click", () => switchStyle(button.dataset.style));
  });

  document.getElementById("btn-align-left").addEventListener("click", () => alignSelected("left"));
  document.getElementById("btn-align-top").addEventListener("click", () => alignSelected("top"));
  document.getElementById("btn-distribute-x").addEventListener("click", () => distributeSelected("x"));
  document.getElementById("btn-distribute-y").addEventListener("click", () => distributeSelected("y"));
  document.getElementById("btn-duplicate-selection").addEventListener("click", duplicateSelection);

  canvasWrapper.addEventListener("pointerdown", onCanvasPointerDown);
  window.addEventListener("pointermove", onGlobalPointerMove);
  window.addEventListener("pointerup", onGlobalPointerUp);
  window.addEventListener("pointercancel", onGlobalPointerUp);
  canvasWrapper.addEventListener("touchstart", onBoardTouchStart, { passive: false });
  canvasWrapper.addEventListener("touchmove", onBoardTouchMove, { passive: false });
  canvasWrapper.addEventListener("touchend", onBoardTouchEnd, { passive: false });
  canvasWrapper.addEventListener("touchcancel", onBoardTouchEnd, { passive: false });

  canvasWrapper.addEventListener("wheel", (event) => {
    event.preventDefault();
    const rect = canvasWrapper.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const anchor = screenToCanvas(mouseX, mouseY);
    const delta = event.deltaY > 0 ? 0.92 : 1.08;
    const nextZoom = Math.min(Math.max(cs().zoom * delta, 0.12), 4.5);
    cs().zoom = nextZoom;
    cs().pan.x = BOARD_OFFSET + mouseX - anchor.x * nextZoom;
    cs().pan.y = BOARD_OFFSET + mouseY - anchor.y * nextZoom;
    applyTransform();
    saveAll();
  }, { passive: false });

  canvasWrapper.addEventListener("click", (event) => {
    if (event.target === canvasWrapper || event.target === canvas) {
      closeMenus();
      if (state.skipCanvasClickClear) {
        state.skipCanvasClickClear = false;
        return;
      }
      if (!event.shiftKey && !event.metaKey && !event.ctrlKey && state.mode !== "multi-select") clearSelection();
    }
  });

  canvasWrapper.addEventListener("contextmenu", (event) => {
    if (event.target !== canvasWrapper && event.target !== canvas) return;
    event.preventDefault();
    const rect = canvasWrapper.getBoundingClientRect();
    state.canvasContextPos = screenToCanvas(event.clientX - rect.left, event.clientY - rect.top);
    hideNodeCtxMenu();
    showCanvasCtxMenu(event.clientX, event.clientY);
  });

  document.addEventListener("click", () => closeMenus());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void refreshFromRemote();
    } else {
      flushPendingSaveOnExit();
    }
  });
  window.addEventListener("focus", () => {
    void refreshFromRemote();
  });
  window.addEventListener("pagehide", flushPendingSaveOnExit);
  window.addEventListener("beforeunload", flushPendingSaveOnExit);

  document.getElementById("ctx-canvas-add").addEventListener("click", () => {
    hideCanvasCtxMenu();
    openModal();
  });
  document.getElementById("ctx-canvas-fullview").addEventListener("click", () => {
    hideCanvasCtxMenu();
    fitAllNodes();
  });

  document.getElementById("ctx-view").addEventListener("click", () => {
    if (!state.contextNodeId) return;
    openViewerByNodeId(state.contextNodeId);
    hideNodeCtxMenu();
  });
  document.getElementById("ctx-edit").addEventListener("click", () => {
    if (!state.contextNodeId) return;
    openEditModal(state.contextNodeId);
    hideNodeCtxMenu();
  });
  document.getElementById("ctx-ai-note").addEventListener("click", async () => {
    if (!state.contextNodeId) return;
    hideNodeCtxMenu();
    await generateAiNoteForNode(state.contextNodeId);
  });
  document.getElementById("ctx-delete").addEventListener("click", () => {
    if (!state.contextNodeId) return;
    deleteNode(state.contextNodeId);
    hideNodeCtxMenu();
  });

  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("btn-cancel").addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", (event) => {
    if (event.target === modalOverlay) closeModal();
  });
  dropZone.addEventListener("click", () => fileInput.click());
  document.getElementById("btn-browse").addEventListener("click", (event) => {
    event.stopPropagation();
    fileInput.click();
  });
  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("dragover");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragover");
    handleFiles(event.dataTransfer.files);
  });
  fileInput.addEventListener("change", () => handleFiles(fileInput.files));
  document.getElementById("btn-url-add").addEventListener("click", () => {
    const url = normalizeText(urlInput.value);
    if (!url) return;
    addPreviewImage(url);
    urlInput.value = "";
  });
  urlInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      document.getElementById("btn-url-add").click();
    }
  });
  document.getElementById("btn-confirm").addEventListener("click", createNodesFromPendingImages);

  document.getElementById("edit-modal-close").addEventListener("click", closeEditModal);
  document.getElementById("edit-cancel").addEventListener("click", closeEditModal);
  editOverlay.addEventListener("click", (event) => {
    if (event.target === editOverlay) closeEditModal();
  });
  document.getElementById("edit-confirm").addEventListener("click", saveEditModal);
  document.getElementById("edit-ai-generate").addEventListener("click", async () => {
    if (!state.editNodeId) return;
    await generateAiNoteForNode(state.editNodeId);
  });

  document.getElementById("shot-list-close").addEventListener("click", closeShotList);

  document.getElementById("viewer-close").addEventListener("click", closeViewer);
  document.getElementById("viewer-prev").addEventListener("click", () => moveViewer(-1));
  document.getElementById("viewer-next").addEventListener("click", () => moveViewer(1));
  viewer.addEventListener("click", (event) => {
    if (event.target === viewer) closeViewer();
  });

  document.getElementById("presenter-close").addEventListener("click", closePresenter);
  document.getElementById("presenter-prev").addEventListener("click", () => movePresenter(-1));
  document.getElementById("presenter-next").addEventListener("click", () => movePresenter(1));
  presenter.addEventListener("click", (event) => {
    if (event.target === presenter) closePresenter();
  });

  viewerImage.addEventListener("load", applyViewerTransform);
  viewerStage.addEventListener("touchstart", onViewerTouchStart, { passive: false });
  viewerStage.addEventListener("touchmove", onViewerTouchMove, { passive: false });
  viewerStage.addEventListener("touchend", onViewerTouchEnd, { passive: false });
  viewerStage.addEventListener("touchcancel", onViewerTouchEnd, { passive: false });

  document.addEventListener("keydown", (event) => {
    const active = document.activeElement;
    const typing = active && (
      active.tagName === "INPUT" ||
      active.tagName === "TEXTAREA" ||
      active.contentEditable === "true"
    );
    if (typing) return;

    const isMeta = event.ctrlKey || event.metaKey;

    if (isMeta && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }

    if (isMeta && event.key.toLowerCase() === "c") {
      event.preventDefault();
      copySelection();
      return;
    }

    if (isMeta && event.key.toLowerCase() === "v") {
      event.preventDefault();
      pasteClipboard();
      return;
    }

    if (state.viewer.open) {
      if (event.key === "ArrowLeft") moveViewer(-1);
      if (event.key === "ArrowRight") moveViewer(1);
      if (event.key === "Escape") closeViewer();
      return;
    }

    if (state.presenter.open) {
      if (event.key === "ArrowLeft") movePresenter(-1);
      if (event.key === "ArrowRight") movePresenter(1);
      if (event.key === "Escape") closePresenter();
      return;
    }

    if (event.key === "h" || event.key === "H") setMode("pan");
    if (event.key === "m" || event.key === "M") setMode("multi-select");
    if (event.key === "c" || event.key === "C") setMode(state.mode === "connect" ? "pan" : "connect");
    if (event.key === "+" || event.key === "=") openModal();
    if (event.key === "-") setMode(state.mode === "delete-conn" ? "pan" : "delete-conn");
    if (event.key === "f" || event.key === "F") fitAllNodes();
    if (event.key === "0") {
      cs().pan = { x: BOARD_OFFSET, y: BOARD_OFFSET };
      cs().zoom = 1;
      applyTransform();
      saveAll();
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      if (!state.selectedIds.size) return;
      commitMutation(() => {
        const ids = new Set(state.selectedIds);
        cs().nodes = cs().nodes.filter((node) => !ids.has(node.id));
        cs().connections = cs().connections.filter((connection) => !ids.has(connection.fromId) && !ids.has(connection.toId));
        ids.forEach((id) => delete cs().shotChecks[id]);
        state.selectedIds.clear();
      });
    }
    if (event.key === "Escape") {
      closeModal();
      closeEditModal();
      closeViewer();
      closePresenter();
      closeShotList();
      clearSelection();
      setMode("pan");
    }
  });

  window.addEventListener("beforeunload", () => {
    if (state.saveTimer) {
      clearTimeout(state.saveTimer);
      state.saveTimer = null;
    }
    if (state.pendingSnapshot) {
      void flushRemoteSave({ keepalive: true });
    }
  });
}

async function initApp() {
  clearLegacyBoardStorage();
  bindEvents();
  updateAuthUI();
  restoreSavedUsername();
}

void initApp();
