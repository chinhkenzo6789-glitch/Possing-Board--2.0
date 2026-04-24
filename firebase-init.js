(function initFirebaseBoard() {
  const firebaseConfig = window.POSINGBOARD_CONFIG && window.POSINGBOARD_CONFIG.firebase;
  const requiredFields = ["apiKey", "databaseURL", "projectId", "appId"];

  function exposeNotReady(error) {
    window.PosingBoardFirebase = {
      ready: false,
      error,
      app: null,
      db: null,
      boardRef: null,
      boardPath: "",
    };
  }

  if (!window.firebase) {
    exposeNotReady("Firebase SDK chưa được tải.");
    return;
  }

  if (!firebaseConfig || typeof firebaseConfig !== "object") {
    exposeNotReady("Chưa cấu hình Firebase trong config.js");
    return;
  }

  const missing = requiredFields.filter((field) => !String(firebaseConfig[field] || "").trim());
  if (missing.length) {
    exposeNotReady(`Thiếu cấu hình Firebase: ${missing.join(", ")}`);
    return;
  }

  const boardPath = String(firebaseConfig.boardPath || "projects/sharedBoard")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

  try {
    const app = window.firebase.apps && window.firebase.apps.length
      ? window.firebase.app()
      : window.firebase.initializeApp({
          apiKey: firebaseConfig.apiKey,
          authDomain: firebaseConfig.authDomain || undefined,
          databaseURL: firebaseConfig.databaseURL,
          projectId: firebaseConfig.projectId,
          appId: firebaseConfig.appId,
          storageBucket: firebaseConfig.storageBucket || undefined,
          messagingSenderId: firebaseConfig.messagingSenderId || undefined,
        });

    const db = app.database();
    const boardRef = db.ref(boardPath);

    window.PosingBoardFirebase = {
      ready: true,
      error: "",
      app,
      db,
      boardRef,
      boardPath,
    };
  } catch (error) {
    exposeNotReady(error instanceof Error ? error.message : "Khởi tạo Firebase thất bại.");
  }
})();
