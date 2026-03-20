"use strict";

(() => {
  const STORAGE_KEYS = {
    users: "cityvision_users_v2",
    session: "cityvision_session_v2",
    ui: "cityvision_ui_v2",
    cameras: "cityvision_cameras_v1",
  };

  const DB_NAME = "cityvision_media_v1";
  const DB_VERSION = 1;
  const VIDEO_STORE = "violationVideos";
  const DEFAULT_PAGE_SIZE = 8;
  const AI_API_BASE = String(window.CITYVISION_AI_BASE || "http://localhost:8001").replace(/\/$/, "");
  const LIVE_AI_INTERVAL_MS = 1500;

  const ROLE_ADMIN = "Admin";
  const ROLE_STAFF = "Nhan vien";
  const STATUS_ACTIVE = "Hoat dong";
  const STATUS_LOCKED = "Tam khoa";
  const CAMERA_STATUS_ACTIVE = "Hoat dong";
  const CAMERA_STATUS_MAINTENANCE = "Bao tri";
  const CAMERA_STATUS_PAUSED = "Tam dung";

  const MODULE_META = {
    users: {
      title: "Quản lý người dùng",
      subtitle: "Thêm, sửa, xóa và theo dõi trạng thái tài khoản",
      actionLabel: "+ Thêm người dùng",
      action: "openCreate",
    },
    cameras: {
      title: "Quản lý camera",
      subtitle: "Lưu danh sách camera, vị trí và thiết bị được liên kết",
      actionLabel: "+ Thêm camera",
      action: "openCameraCreate",
    },
    monitoring: {
      title: "Live monitoring",
      subtitle: "Xem camera trực tiếp từ webcam được cấp quyền trong trình duyệt",
      actionLabel: "Tải lại camera",
      action: "refreshDevices",
    },
    videos: {
      title: "Video phát",
      subtitle: "Tải lên, xem lại và quản lý video vi phạm",
      actionLabel: "Tải lên video",
      action: "focusVideoUpload",
    },
  };

  function safeNowIso() {
    return new Date().toISOString();
  }

  function safeJsonParse(raw, fallback) {
    if (typeof raw !== "string" || raw.length === 0) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function storageGet(key, fallback) {
    try {
      return safeJsonParse(localStorage.getItem(key), fallback);
    } catch {
      return fallback;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function storageRemove(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  function uid() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  }

  function normalizeText(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDate(isoString) {
    if (!isoString) return "-";
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleDateString("vi-VN", { year: "numeric", month: "2-digit", day: "2-digit" });
  }

  function formatDateTime(isoString) {
    if (!isoString) return "-";
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleString("vi-VN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatBytes(size) {
    const value = Number(size);
    if (!Number.isFinite(value) || value <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let current = value;
    let index = 0;
    while (current >= 1024 && index < units.length - 1) {
      current /= 1024;
      index += 1;
    }
    return `${current.toFixed(current >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
  }

  function getToastEl() {
    return document.getElementById("toast");
  }

  let toastTimer = 0;
  function toast(message) {
    const el = getToastEl();
    if (!el) return;
    el.textContent = String(message ?? "");
    el.hidden = false;

    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      el.hidden = true;
      el.textContent = "";
    }, 2800);
  }

  function loadUsers() {
    const users = storageGet(STORAGE_KEYS.users, []);
    return Array.isArray(users) ? users : [];
  }

  function saveUsers(users) {
    return storageSet(STORAGE_KEYS.users, users);
  }

  function loadCameras() {
    const cameras = storageGet(STORAGE_KEYS.cameras, []);
    return Array.isArray(cameras) ? cameras : [];
  }

  function saveCameras(cameras) {
    return storageSet(STORAGE_KEYS.cameras, cameras);
  }

  function seedUsersIfNeeded() {
    const existing = loadUsers();
    if (existing.length > 0) return existing;

    const seeded = [
      {
        id: uid(),
        username: "admin",
        password: "admin123",
        fullName: "Quản trị viên",
        email: "admin@example.com",
        role: ROLE_ADMIN,
        status: STATUS_ACTIVE,
        createdAt: safeNowIso(),
      },
      {
        id: uid(),
        username: "nhanvien",
        password: "123456",
        fullName: "Nhan vien",
        email: "staff@example.com",
        role: ROLE_STAFF,
        status: STATUS_ACTIVE,
        createdAt: safeNowIso(),
      },
    ];

    saveUsers(seeded);
    return seeded;
  }

  function seedCamerasIfNeeded() {
    const existing = loadCameras();
    if (existing.length > 0) return existing;

    const seeded = [
      {
        id: uid(),
        name: "Camera cổng chính",
        location: "Cổng số 1",
        status: CAMERA_STATUS_ACTIVE,
        deviceId: "",
        notes: "Camera theo dõi lượng xe ra vào",
        createdAt: safeNowIso(),
      },
    ];

    saveCameras(seeded);
    return seeded;
  }

  function getSession() {
    const session = storageGet(STORAGE_KEYS.session, null);
    if (!session || typeof session !== "object") return null;
    if (typeof session.userId !== "string" || typeof session.username !== "string") return null;
    return session;
  }

  function setSession(session) {
    return storageSet(STORAGE_KEYS.session, session);
  }

  function clearSession() {
    return storageRemove(STORAGE_KEYS.session);
  }

  function findUserById(users, id) {
    return users.find((u) => u && u.id === id) ?? null;
  }

  function findUserByUsername(users, username) {
    const target = normalizeText(username);
    if (!target) return null;
    return users.find((u) => normalizeText(u?.username) === target) ?? null;
  }

  function findCameraById(cameras, id) {
    return cameras.find((camera) => camera && camera.id === id) ?? null;
  }

  function countAdmins(users) {
    return users.filter((u) => u?.role === ROLE_ADMIN).length;
  }

  function statusPillHtml(status) {
    const cls = status === STATUS_ACTIVE ? "pill pill--success" : "pill pill--danger";
    return `<span class="${cls}">${escapeHtml(status || "-")}</span>`;
  }

  function cameraStatusPillHtml(status) {
    if (status === CAMERA_STATUS_ACTIVE) {
      return `<span class="pill pill--success">${escapeHtml(status)}</span>`;
    }
    return `<span class="pill pill--warning">${escapeHtml(status || "-")}</span>`;
  }

  function renderSessionChip(el, session) {
    if (!el) return;
    if (!session) {
      el.textContent = "";
      return;
    }
    const role = session.role ? String(session.role) : "";
    el.innerHTML = `
      <div><strong>${escapeHtml(session.username)}</strong></div>
      <div class="muted small">${escapeHtml(role || "-")}</div>
    `;
  }

  function openVideoDb() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("Trinh duyet khong ho tro IndexedDB."));
        return;
      }

      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(VIDEO_STORE)) {
          const store = db.createObjectStore(VIDEO_STORE, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Khong mo duoc kho video."));
    });
  }

  async function getAllVideos() {
    const db = await openVideoDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(VIDEO_STORE, "readonly");
      const store = transaction.objectStore(VIDEO_STORE);
      const request = store.getAll();
      request.onsuccess = () => {
        resolve(
          (request.result || []).sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()),
        );
      };
      request.onerror = () => reject(request.error || new Error("Khong doc duoc danh sach video."));
      transaction.oncomplete = () => db.close();
    });
  }

  async function saveVideoRecord(record) {
    const db = await openVideoDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(VIDEO_STORE, "readwrite");
      const store = transaction.objectStore(VIDEO_STORE);
      const request = store.put(record);
      request.onsuccess = () => resolve(record);
      request.onerror = () => reject(request.error || new Error("Khong luu duoc video."));
      transaction.oncomplete = () => db.close();
    });
  }

  async function deleteVideoRecord(id) {
    const db = await openVideoDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(VIDEO_STORE, "readwrite");
      const store = transaction.objectStore(VIDEO_STORE);
      const request = store.delete(id);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error || new Error("Khong xoa duoc video."));
      transaction.oncomplete = () => db.close();
    });
  }

  function captureVideoFrame(videoEl) {
    if (!(videoEl instanceof HTMLVideoElement) || videoEl.videoWidth === 0 || videoEl.videoHeight === 0) {
      return "";
    }
    const canvas = document.createElement("canvas");
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82);
  }

  async function apiResetLiveNoPark() {
    const response = await fetch(`${AI_API_BASE}/api/no-park/live/reset`, { method: "POST" });
    if (!response.ok) throw new Error("Khong reset duoc live AI.");
    return response.json();
  }

  async function apiAnalyseLiveFrame(frameB64) {
    const response = await fetch(`${AI_API_BASE}/api/no-park/live/frame`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frame_b64: frameB64 }),
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || "Khong phan tich duoc live frame.");
    }
    return response.json();
  }

  async function apiAnalyseVideo(file) {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(`${AI_API_BASE}/api/no-park/video`, {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || "Khong phan tich duoc video.");
    }
    return response.json();
  }

  function initLoginPage() {
    const session = getSession();
    if (session && session.role === ROLE_ADMIN) {
      window.location.href = "dashboard.html";
      return;
    }

    seedUsersIfNeeded();
    seedCamerasIfNeeded();

    const form = document.getElementById("loginForm");
    const usernameEl = document.getElementById("loginUsername");
    const passwordEl = document.getElementById("loginPassword");

    if (!form || !(form instanceof HTMLFormElement) || !(usernameEl instanceof HTMLInputElement)) return;
    if (!(passwordEl instanceof HTMLInputElement)) return;

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const username = usernameEl.value.trim();
      const password = passwordEl.value;

      const users = loadUsers();
      const user = findUserByUsername(users, username);
      if (!user || user.password !== password) {
        toast("Sai tai khoan hoac mat khau.");
        return;
      }
      if (user.status !== STATUS_ACTIVE) {
        toast("Tai khoan dang bi khoa.");
        return;
      }
      if (user.role !== ROLE_ADMIN) {
        toast("Tai khoan khong co quyen Admin.");
        return;
      }

      const ok = setSession({
        userId: user.id,
        username: user.username,
        role: user.role,
        fullName: user.fullName,
        loggedInAt: safeNowIso(),
      });
      if (!ok) {
        toast("Khong the luu phien dang nhap.");
        return;
      }
      window.location.href = "dashboard.html";
    });
  }

  function initDashboardPage() {
    seedUsersIfNeeded();
    seedCamerasIfNeeded();

    const session = getSession();
    if (!session || session.role !== ROLE_ADMIN) {
      clearSession();
      window.location.href = "index.html";
      return;
    }

    const sessionChip = document.getElementById("sessionChip");
    renderSessionChip(sessionChip, session);

    const usersTbody = document.getElementById("usersTbody");
    const statTotal = document.getElementById("statTotal");
    const statActive = document.getElementById("statActive");
    const statAdmin = document.getElementById("statAdmin");
    const tableSummary = document.getElementById("tableSummary");
    const pageInfo = document.getElementById("pageInfo");
    const searchInput = document.getElementById("searchInput");
    const filterRole = document.getElementById("filterRole");
    const filterStatus = document.getElementById("filterStatus");
    const sortBy = document.getElementById("sortBy");

    const userModal = document.getElementById("userModal");
    const userModalTitle = document.getElementById("modalTitle");
    const userForm = document.getElementById("userForm");
    const userIdEl = document.getElementById("userId");
    const usernameEl = document.getElementById("username");
    const fullNameEl = document.getElementById("fullName");
    const emailEl = document.getElementById("email");
    const roleEl = document.getElementById("role");
    const statusEl = document.getElementById("status");
    const passwordEl = document.getElementById("password");
    const passwordHint = document.getElementById("passwordHint");

    const cameraList = document.getElementById("cameraList");
    const cameraStatTotal = document.getElementById("cameraStatTotal");
    const cameraStatActive = document.getElementById("cameraStatActive");
    const cameraStatBound = document.getElementById("cameraStatBound");
    const cameraModal = document.getElementById("cameraModal");
    const cameraModalTitle = document.getElementById("cameraModalTitle");
    const cameraForm = document.getElementById("cameraForm");
    const cameraIdEl = document.getElementById("cameraId");
    const cameraNameEl = document.getElementById("cameraName");
    const cameraLocationEl = document.getElementById("cameraLocation");
    const cameraStatusEl = document.getElementById("cameraStatus");
    const cameraDeviceIdEl = document.getElementById("cameraDeviceId");
    const cameraNotesEl = document.getElementById("cameraNotes");

    const moduleTitle = document.getElementById("moduleTitle");
    const moduleSubtitle = document.getElementById("moduleSubtitle");
    const topbarPrimaryAction = document.getElementById("topbarPrimaryAction");
    const modulePanels = Array.from(document.querySelectorAll("[data-module-panel]"));
    const moduleButtons = Array.from(document.querySelectorAll("[data-module]"));

    const monitorCameraSelect = document.getElementById("monitorCameraSelect");
    const deviceSelect = document.getElementById("deviceSelect");
    const liveVideo = document.getElementById("liveVideo");
    const monitoringStatus = document.getElementById("monitoringStatus");
    const liveAiEnabled = document.getElementById("liveAiEnabled");
    const liveAiSummary = document.getElementById("liveAiSummary");
    const liveAiPreview = document.getElementById("liveAiPreview");

    const videoUploadForm = document.getElementById("videoUploadForm");
    const videoTitleEl = document.getElementById("videoTitle");
    const videoCameraEl = document.getElementById("videoCamera");
    const videoOccurredAtEl = document.getElementById("videoOccurredAt");
    const videoFileEl = document.getElementById("videoFile");
    const videoDescriptionEl = document.getElementById("videoDescription");
    const videoAiEnabled = document.getElementById("videoAiEnabled");
    const videoList = document.getElementById("videoList");
    const videoSummary = document.getElementById("videoSummary");

    if (!(usersTbody instanceof HTMLElement)) return;
    if (!(userModal instanceof HTMLElement)) return;
    if (!(userForm instanceof HTMLFormElement)) return;
    if (!(cameraList instanceof HTMLElement)) return;
    if (!(cameraModal instanceof HTMLElement)) return;
    if (!(cameraForm instanceof HTMLFormElement)) return;
    if (!(liveVideo instanceof HTMLVideoElement)) return;
    if (!(videoUploadForm instanceof HTMLFormElement)) return;

    const uiState = storageGet(STORAGE_KEYS.ui, {});
    const state = {
      users: loadUsers(),
      cameras: loadCameras(),
      query: typeof uiState.query === "string" ? uiState.query : "",
      filterRole: typeof uiState.filterRole === "string" ? uiState.filterRole : "",
      filterStatus: typeof uiState.filterStatus === "string" ? uiState.filterStatus : "",
      sortBy: typeof uiState.sortBy === "string" ? uiState.sortBy : "createdAt_desc",
      page: Number.isFinite(uiState.page) ? Math.max(1, uiState.page) : 1,
      pageSize: DEFAULT_PAGE_SIZE,
      editingId: null,
      editingCameraId: null,
      currentModule:
        typeof uiState.currentModule === "string" && MODULE_META[uiState.currentModule]
          ? uiState.currentModule
          : "users",
      devices: [],
      liveStream: null,
      liveAiTimer: 0,
      liveAiBusy: false,
      videoRecords: [],
      videoObjectUrls: new Map(),
    };

    function persistUiState() {
      storageSet(STORAGE_KEYS.ui, {
        query: state.query,
        filterRole: state.filterRole,
        filterStatus: state.filterStatus,
        sortBy: state.sortBy,
        page: state.page,
        currentModule: state.currentModule,
      });
    }

    function computeVisibleUsers() {
      const query = normalizeText(state.query);
      let list = [...state.users];

      if (query) {
        list = list.filter((u) => {
          const hay = normalizeText(`${u?.username ?? ""} ${u?.fullName ?? ""} ${u?.email ?? ""}`);
          return hay.includes(query);
        });
      }

      if (state.filterRole) list = list.filter((u) => u?.role === state.filterRole);
      if (state.filterStatus) list = list.filter((u) => u?.status === state.filterStatus);

      const [field, dir] = String(state.sortBy).split("_");
      const multiplier = dir === "asc" ? 1 : -1;
      list.sort((a, b) => {
        if (field === "createdAt") {
          const av = new Date(a?.createdAt ?? 0).getTime();
          const bv = new Date(b?.createdAt ?? 0).getTime();
          return (av - bv) * multiplier;
        }
        const av = String(a?.[field] ?? "");
        const bv = String(b?.[field] ?? "");
        return av.localeCompare(bv, "vi", { sensitivity: "base" }) * multiplier;
      });

      return list;
    }

    function clampPage(totalItems) {
      const totalPages = Math.max(1, Math.ceil(totalItems / state.pageSize));
      state.page = Math.min(Math.max(1, state.page), totalPages);
      return totalPages;
    }

    function syncUserStats() {
      if (statTotal) statTotal.textContent = String(state.users.length);
      if (statActive) statActive.textContent = String(state.users.filter((u) => u?.status === STATUS_ACTIVE).length);
      if (statAdmin) statAdmin.textContent = String(countAdmins(state.users));
    }

    function renderUsersTable() {
      const visible = computeVisibleUsers();
      const totalPages = clampPage(visible.length);
      persistUiState();

      const start = (state.page - 1) * state.pageSize;
      const pageItems = visible.slice(start, start + state.pageSize);

      usersTbody.innerHTML =
        pageItems.length === 0
          ? `<tr><td colspan="7" class="muted">Khong co du lieu phu hop.</td></tr>`
          : pageItems
              .map((u) => {
                const created = formatDate(u?.createdAt);
                const fullName = u?.fullName ? escapeHtml(u.fullName) : "-";
                const email = u?.email ? escapeHtml(u.email) : "-";
                return `
                  <tr>
                    <td><strong>${escapeHtml(u?.username ?? "")}</strong></td>
                    <td>${fullName}</td>
                    <td>${email}</td>
                    <td>${escapeHtml(u?.role ?? "-")}</td>
                    <td>${statusPillHtml(u?.status)}</td>
                    <td>${escapeHtml(created)}</td>
                    <td>
                      <div class="row-actions">
                        <button class="btn btn--ghost" type="button" data-action="editUser" data-id="${escapeHtml(u?.id ?? "")}">Sua</button>
                        <button class="btn btn--danger" type="button" data-action="deleteUser" data-id="${escapeHtml(u?.id ?? "")}">Xoa</button>
                      </div>
                    </td>
                  </tr>
                `;
              })
              .join("");

      if (tableSummary) tableSummary.textContent = `${visible.length} ket qua`;
      if (pageInfo) pageInfo.textContent = `Trang ${state.page}/${totalPages}`;
    }

    function openUserModal(mode, user) {
      state.editingId = mode === "edit" ? user?.id ?? null : null;
      if (userModalTitle) userModalTitle.textContent = mode === "edit" ? "Sua nguoi dung" : "Them nguoi dung";

      if (userIdEl) userIdEl.value = mode === "edit" ? String(user?.id ?? "") : "";
      if (usernameEl) usernameEl.value = mode === "edit" ? String(user?.username ?? "") : "";
      if (fullNameEl) fullNameEl.value = mode === "edit" ? String(user?.fullName ?? "") : "";
      if (emailEl) emailEl.value = mode === "edit" ? String(user?.email ?? "") : "";
      if (roleEl) roleEl.value = mode === "edit" ? String(user?.role ?? ROLE_STAFF) : ROLE_STAFF;
      if (statusEl) statusEl.value = mode === "edit" ? String(user?.status ?? STATUS_ACTIVE) : STATUS_ACTIVE;

      if (passwordEl instanceof HTMLInputElement) {
        passwordEl.value = "";
        passwordEl.required = mode === "create";
      }
      if (passwordHint instanceof HTMLElement) {
        passwordHint.textContent =
          mode === "create"
            ? "Bat buoc nhap mat khau khi tao moi."
            : "Khi sua nguoi dung: de trong mat khau neu khong muon doi.";
      }

      document.body.classList.add("modal-open");
      userModal.hidden = false;
    }

    function closeUserModal() {
      userModal.hidden = true;
      document.body.classList.remove("modal-open");
      state.editingId = null;
    }

    function updateUsers(nextUsers) {
      state.users = nextUsers;
      saveUsers(nextUsers);
      syncUserStats();
      renderUsersTable();
    }

    function createUserFromForm() {
      const username = String(usernameEl?.value ?? "").trim();
      const password = String(passwordEl?.value ?? "");
      const fullName = String(fullNameEl?.value ?? "").trim();
      const email = String(emailEl?.value ?? "").trim();
      const role = String(roleEl?.value ?? ROLE_STAFF);
      const status = String(statusEl?.value ?? STATUS_ACTIVE);

      if (!username) return { ok: false, message: "Username khong duoc de trong." };
      if (!password) return { ok: false, message: "Mat khau khong duoc de trong." };

      const exists = findUserByUsername(state.users, username);
      if (exists) return { ok: false, message: "Username da ton tai." };

      return {
        ok: true,
        user: {
          id: uid(),
          username,
          password,
          fullName,
          email,
          role,
          status,
          createdAt: safeNowIso(),
        },
      };
    }

    function updateUserFromForm(existingUser) {
      const username = String(usernameEl?.value ?? "").trim();
      const password = String(passwordEl?.value ?? "");
      const fullName = String(fullNameEl?.value ?? "").trim();
      const email = String(emailEl?.value ?? "").trim();
      const role = String(roleEl?.value ?? existingUser.role);
      const status = String(statusEl?.value ?? existingUser.status);

      if (!username) return { ok: false, message: "Username khong duoc de trong." };

      const other = state.users.find(
        (u) => u?.id !== existingUser.id && normalizeText(u?.username) === normalizeText(username),
      );
      if (other) return { ok: false, message: "Username da ton tai." };

      if (existingUser.role === ROLE_ADMIN && role !== ROLE_ADMIN && countAdmins(state.users) <= 1) {
        return { ok: false, message: "Khong the bo quyen Admin cua tai khoan Admin cuoi cung." };
      }

      return {
        ok: true,
        user: {
          ...existingUser,
          username,
          fullName,
          email,
          role,
          status,
          password: password ? password : existingUser.password,
        },
      };
    }

    function deleteUserById(id) {
      const target = findUserById(state.users, id);
      if (!target) return;

      if (target.role === ROLE_ADMIN && countAdmins(state.users) <= 1) {
        toast("Khong the xoa tai khoan Admin cuoi cung.");
        return;
      }

      const ok = window.confirm(`Xoa nguoi dung "${target.username}"?`);
      if (!ok) return;

      const next = state.users.filter((u) => u?.id !== id);
      updateUsers(next);
      toast("Da xoa nguoi dung.");
    }

    function syncCameraStats() {
      if (cameraStatTotal) cameraStatTotal.textContent = String(state.cameras.length);
      if (cameraStatActive) {
        cameraStatActive.textContent = String(state.cameras.filter((camera) => camera?.status === CAMERA_STATUS_ACTIVE).length);
      }
      if (cameraStatBound) {
        cameraStatBound.textContent = String(state.cameras.filter((camera) => camera?.deviceId).length);
      }
    }

    function populateCameraDeviceSelect(selected = "") {
      if (!(cameraDeviceIdEl instanceof HTMLSelectElement)) return;
      const options = [
        `<option value="">Chua lien ket thiet bi</option>`,
        ...state.devices.map((device, index) => {
          const label = device.label || `Camera ${index + 1}`;
          const isSelected = selected && selected === device.deviceId ? " selected" : "";
          return `<option value="${escapeHtml(device.deviceId)}"${isSelected}>${escapeHtml(label)}</option>`;
        }),
      ];
      cameraDeviceIdEl.innerHTML = options.join("");
      if (selected) cameraDeviceIdEl.value = selected;
    }

    function renderCameraList() {
      syncCameraStats();
      if (state.cameras.length === 0) {
        cameraList.innerHTML = `<div class="empty-state">Chua co camera nao. Hay them camera dau tien.</div>`;
        return;
      }

      cameraList.innerHTML = state.cameras
        .map((camera) => {
          const device = state.devices.find((item) => item.deviceId === camera.deviceId);
          return `
            <article class="entity-card">
              <div class="entity-card__header">
                <div>
                  <h3>${escapeHtml(camera.name || "Camera")}</h3>
                  <p class="muted">${escapeHtml(camera.location || "Chua cap nhat vi tri")}</p>
                </div>
                ${cameraStatusPillHtml(camera.status)}
              </div>

              <dl class="entity-meta">
                <div>
                  <dt>Thiet bi</dt>
                  <dd>${escapeHtml(device?.label || (camera.deviceId ? "Da lien ket webcam" : "Chua lien ket"))}</dd>
                </div>
                <div>
                  <dt>Tao luc</dt>
                  <dd>${escapeHtml(formatDate(camera.createdAt))}</dd>
                </div>
              </dl>

              <p class="entity-notes">${escapeHtml(camera.notes || "Khong co ghi chu.")}</p>

              <div class="row-actions">
                <button class="btn btn--ghost" type="button" data-action="editCamera" data-id="${escapeHtml(camera.id)}">Sua</button>
                <button class="btn btn--danger" type="button" data-action="deleteCamera" data-id="${escapeHtml(camera.id)}">Xoa</button>
              </div>
            </article>
          `;
        })
        .join("");
    }

    function openCameraModal(mode, camera) {
      state.editingCameraId = mode === "edit" ? camera?.id ?? null : null;
      if (cameraModalTitle) cameraModalTitle.textContent = mode === "edit" ? "Sua camera" : "Them camera";

      if (cameraIdEl) cameraIdEl.value = mode === "edit" ? String(camera?.id ?? "") : "";
      if (cameraNameEl) cameraNameEl.value = mode === "edit" ? String(camera?.name ?? "") : "";
      if (cameraLocationEl) cameraLocationEl.value = mode === "edit" ? String(camera?.location ?? "") : "";
      if (cameraStatusEl) cameraStatusEl.value = mode === "edit" ? String(camera?.status ?? CAMERA_STATUS_ACTIVE) : CAMERA_STATUS_ACTIVE;
      if (cameraNotesEl) cameraNotesEl.value = mode === "edit" ? String(camera?.notes ?? "") : "";
      populateCameraDeviceSelect(mode === "edit" ? String(camera?.deviceId ?? "") : "");

      document.body.classList.add("modal-open");
      cameraModal.hidden = false;
    }

    function closeCameraModal() {
      cameraModal.hidden = true;
      document.body.classList.remove("modal-open");
      state.editingCameraId = null;
    }

    function updateCameras(nextCameras) {
      state.cameras = nextCameras;
      saveCameras(nextCameras);
      syncCameraStats();
      renderCameraList();
      populateMonitoringCameraSelect();
      populateVideoCameraSelect();
    }

    function createCameraFromForm() {
      const name = String(cameraNameEl?.value ?? "").trim();
      const location = String(cameraLocationEl?.value ?? "").trim();
      const status = String(cameraStatusEl?.value ?? CAMERA_STATUS_ACTIVE);
      const deviceId = String(cameraDeviceIdEl?.value ?? "").trim();
      const notes = String(cameraNotesEl?.value ?? "").trim();

      if (!name) return { ok: false, message: "Ten camera khong duoc de trong." };

      return {
        ok: true,
        camera: {
          id: uid(),
          name,
          location,
          status,
          deviceId,
          notes,
          createdAt: safeNowIso(),
        },
      };
    }

    function updateCameraFromForm(existingCamera) {
      const name = String(cameraNameEl?.value ?? "").trim();
      const location = String(cameraLocationEl?.value ?? "").trim();
      const status = String(cameraStatusEl?.value ?? existingCamera.status);
      const deviceId = String(cameraDeviceIdEl?.value ?? "").trim();
      const notes = String(cameraNotesEl?.value ?? "").trim();

      if (!name) return { ok: false, message: "Ten camera khong duoc de trong." };

      return {
        ok: true,
        camera: {
          ...existingCamera,
          name,
          location,
          status,
          deviceId,
          notes,
        },
      };
    }

    function deleteCameraById(id) {
      const target = findCameraById(state.cameras, id);
      if (!target) return;

      const ok = window.confirm(`Xoa camera "${target.name}"?`);
      if (!ok) return;

      const next = state.cameras.filter((camera) => camera?.id !== id);
      updateCameras(next);
      if (monitorCameraSelect instanceof HTMLSelectElement && monitorCameraSelect.value === id) {
        monitorCameraSelect.value = "";
      }
      toast("Da xoa camera.");
    }

    function populateMonitoringCameraSelect() {
      if (!(monitorCameraSelect instanceof HTMLSelectElement)) return;
      const options = [
        `<option value="">Chon camera da quan ly</option>`,
        ...state.cameras.map(
          (camera) =>
            `<option value="${escapeHtml(camera.id)}">${escapeHtml(camera.name)}${camera.location ? ` - ${escapeHtml(camera.location)}` : ""}</option>`,
        ),
      ];
      monitorCameraSelect.innerHTML = options.join("");
    }

    function populateVideoCameraSelect() {
      if (!(videoCameraEl instanceof HTMLSelectElement)) return;
      const options = [
        `<option value="">Chon camera lien quan</option>`,
        ...state.cameras.map(
          (camera) =>
            `<option value="${escapeHtml(camera.id)}">${escapeHtml(camera.name)}${camera.location ? ` - ${escapeHtml(camera.location)}` : ""}</option>`,
        ),
      ];
      videoCameraEl.innerHTML = options.join("");
    }

    async function refreshDevices() {
      if (!navigator.mediaDevices?.enumerateDevices) {
        monitoringStatus.textContent = "Trinh duyet khong ho tro enumerateDevices.";
        toast("Trinh duyet hien tai khong ho tro camera.");
        return;
      }

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        state.devices = devices.filter((device) => device.kind === "videoinput");
      } catch (error) {
        state.devices = [];
        monitoringStatus.textContent = "Khong doc duoc danh sach camera.";
      }

      const deviceOptions = [
        `<option value="">Chon webcam tren may</option>`,
        ...state.devices.map((device, index) => {
          const label = device.label || `Camera ${index + 1}`;
          return `<option value="${escapeHtml(device.deviceId)}">${escapeHtml(label)}</option>`;
        }),
      ];
      if (deviceSelect instanceof HTMLSelectElement) {
        deviceSelect.innerHTML = deviceOptions.join("");
      }
      populateCameraDeviceSelect(cameraDeviceIdEl instanceof HTMLSelectElement ? cameraDeviceIdEl.value : "");
      renderCameraList();
    }

    function stopLiveAiLoop() {
      if (state.liveAiTimer) {
        window.clearInterval(state.liveAiTimer);
        state.liveAiTimer = 0;
      }
      state.liveAiBusy = false;
    }

    async function runLiveAiAnalysis() {
      if (state.liveAiBusy || !state.liveStream || !(liveAiEnabled instanceof HTMLInputElement) || !liveAiEnabled.checked) {
        return;
      }

      const frameB64 = captureVideoFrame(liveVideo);
      if (!frameB64) return;

      state.liveAiBusy = true;
      try {
        const result = await apiAnalyseLiveFrame(frameB64);
        if (liveAiPreview instanceof HTMLImageElement) {
          liveAiPreview.src = `data:image/jpeg;base64,${result.frame_b64}`;
          liveAiPreview.hidden = false;
        }
        if (liveAiSummary instanceof HTMLElement) {
          if (Array.isArray(result.violations) && result.violations.length > 0) {
            const first = result.violations[0];
            liveAiSummary.textContent = `Phat hien vi pham: track ${first.track_id}, dung ${first.still_seconds}s trong vung cam.`;
          } else {
            liveAiSummary.textContent = `AI dang theo doi ${Array.isArray(result.detections) ? result.detections.length : 0} phuong tien, chua co vi pham moi.`;
          }
        }
      } catch (error) {
        stopLiveAiLoop();
        if (liveAiSummary instanceof HTMLElement) {
          liveAiSummary.textContent = "Khong ket noi duoc backend AI. Hay chay server no-park-zone.";
        }
      } finally {
        state.liveAiBusy = false;
      }
    }

    async function startLiveAiLoop() {
      stopLiveAiLoop();
      if (!(liveAiEnabled instanceof HTMLInputElement) || !liveAiEnabled.checked || !state.liveStream) {
        return;
      }
      if (liveAiSummary instanceof HTMLElement) {
        liveAiSummary.textContent = "Dang khoi dong AI phat hien do xe sai quy dinh...";
      }
      try {
        await apiResetLiveNoPark();
      } catch (error) {
        if (liveAiSummary instanceof HTMLElement) {
          liveAiSummary.textContent = "Khong reset duoc phien AI live. Kiem tra backend.";
        }
      }
      await runLiveAiAnalysis();
      state.liveAiTimer = window.setInterval(() => {
        runLiveAiAnalysis();
      }, LIVE_AI_INTERVAL_MS);
    }

    function stopMonitoring() {
      stopLiveAiLoop();
      if (state.liveStream) {
        state.liveStream.getTracks().forEach((track) => track.stop());
        state.liveStream = null;
      }
      liveVideo.srcObject = null;
      monitoringStatus.textContent = "Da dung live monitoring.";
      if (liveAiSummary instanceof HTMLElement) {
        liveAiSummary.textContent = "AI chua duoc bat.";
      }
      if (liveAiPreview instanceof HTMLImageElement) {
        liveAiPreview.hidden = true;
        liveAiPreview.removeAttribute("src");
      }
    }

    async function startMonitoring() {
      if (!navigator.mediaDevices?.getUserMedia) {
        toast("Trinh duyet khong ho tro getUserMedia.");
        return;
      }

      const selectedCameraId = monitorCameraSelect instanceof HTMLSelectElement ? monitorCameraSelect.value : "";
      const selectedManagedCamera = findCameraById(state.cameras, selectedCameraId);
      const preferredDeviceId = selectedManagedCamera?.deviceId || (deviceSelect instanceof HTMLSelectElement ? deviceSelect.value : "");

      try {
        stopMonitoring();
        const constraints = preferredDeviceId
          ? { video: { deviceId: { exact: preferredDeviceId } }, audio: false }
          : { video: true, audio: false };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        state.liveStream = stream;
        liveVideo.srcObject = stream;
        await liveVideo.play();
        monitoringStatus.textContent = selectedManagedCamera
          ? `Dang xem truc tiep: ${selectedManagedCamera.name}.`
          : "Dang xem truc tiep camera da chon.";

        await refreshDevices();
        await startLiveAiLoop();
      } catch (error) {
        monitoringStatus.textContent = "Khong the mo camera. Kiem tra quyen truy cap camera.";
        toast("Khong the bat live monitoring.");
      }
    }

    async function renderVideoList() {
      state.videoObjectUrls.forEach((url) => URL.revokeObjectURL(url));
      state.videoObjectUrls.clear();

      let records = [];
      try {
        records = await getAllVideos();
      } catch (error) {
        videoList.innerHTML = `<div class="empty-state">Khong doc duoc video da luu.</div>`;
        videoSummary.textContent = "0 video";
        return;
      }

      state.videoRecords = records;
      videoSummary.textContent = `${records.length} video`;

      if (records.length === 0) {
        videoList.innerHTML = `<div class="empty-state">Chua co video phat nao. Hay tai video len de luu ho so.</div>`;
        return;
      }

      videoList.innerHTML = records
        .map((record) => {
          const url = URL.createObjectURL(record.file);
          state.videoObjectUrls.set(record.id, url);
          const camera = findCameraById(state.cameras, record.cameraId);
          const analysis = record.analysis || null;
          const processedVideoUrl =
            analysis?.processedVideoUrl && String(analysis.processedVideoUrl).startsWith("http")
              ? analysis.processedVideoUrl
              : "";
          return `
            <article class="video-card">
              <video class="video-card__player" controls preload="metadata" src="${escapeHtml(url)}"></video>
              <div class="video-card__body">
                <div class="video-card__header">
                  <h3>${escapeHtml(record.title || "Video phat")}</h3>
                  <span class="muted small">${escapeHtml(formatDateTime(record.createdAt))}</span>
                </div>
                <p class="muted">${escapeHtml(camera?.name || "Chua gan camera")}</p>
                <p>${escapeHtml(record.description || "Khong co mo ta.")}</p>
                <div class="video-meta">
                  <span>${escapeHtml(record.fileName || "video")}</span>
                  <span>${escapeHtml(formatBytes(record.fileSize))}</span>
                  <span>${escapeHtml(formatDateTime(record.occurredAt || record.createdAt))}</span>
                </div>
                ${
                  analysis
                    ? `<div class="analysis-box">
                        <p><strong>AI no-park:</strong> ${escapeHtml(
                          analysis.summary?.violation_count > 0
                            ? `Phat hien ${analysis.summary.violation_count} vi pham`
                            : "Khong phat hien vi pham",
                        )}</p>
                        <p class="muted">Frames da xu ly: ${escapeHtml(String(analysis.summary?.processed_frames ?? 0))}</p>
                        ${
                          processedVideoUrl
                            ? `<a class="btn btn--ghost" href="${escapeHtml(processedVideoUrl)}" target="_blank" rel="noreferrer">Mo video da danh dau</a>`
                            : ""
                        }
                      </div>`
                    : ""
                }
                <div class="row-actions">
                  <button class="btn btn--danger" type="button" data-action="deleteVideo" data-id="${escapeHtml(record.id)}">Xoa video</button>
                </div>
              </div>
            </article>
          `;
        })
        .join("");
    }

    function switchModule(nextModule) {
      if (!MODULE_META[nextModule]) return;
      state.currentModule = nextModule;
      persistUiState();

      modulePanels.forEach((panel) => {
        const isActive = panel.getAttribute("data-module-panel") === nextModule;
        panel.hidden = !isActive;
        panel.classList.toggle("is-active", isActive);
      });

      moduleButtons.forEach((button) => {
        const isActive = button.getAttribute("data-module") === nextModule;
        button.classList.toggle("is-active", isActive);
      });

      const meta = MODULE_META[nextModule];
      if (moduleTitle) moduleTitle.textContent = meta.title;
      if (moduleSubtitle) moduleSubtitle.textContent = meta.subtitle;
      if (topbarPrimaryAction instanceof HTMLButtonElement) {
        topbarPrimaryAction.textContent = meta.actionLabel;
        topbarPrimaryAction.setAttribute("data-action", meta.action);
      }

      if (nextModule === "videos") {
        renderVideoList();
      }
      if (nextModule === "monitoring") {
        refreshDevices();
      }
      document.body.classList.remove("sidebar-open");
    }

    function focusVideoUpload() {
      switchModule("videos");
      if (videoTitleEl instanceof HTMLElement) videoTitleEl.focus();
    }

    if (searchInput instanceof HTMLInputElement) searchInput.value = state.query;
    if (filterRole instanceof HTMLSelectElement) filterRole.value = state.filterRole;
    if (filterStatus instanceof HTMLSelectElement) filterStatus.value = state.filterStatus;
    if (sortBy instanceof HTMLSelectElement) sortBy.value = state.sortBy;

    if (searchInput instanceof HTMLInputElement) {
      searchInput.addEventListener("input", () => {
        state.query = searchInput.value;
        state.page = 1;
        renderUsersTable();
      });
    }
    if (filterRole instanceof HTMLSelectElement) {
      filterRole.addEventListener("change", () => {
        state.filterRole = filterRole.value;
        state.page = 1;
        renderUsersTable();
      });
    }
    if (filterStatus instanceof HTMLSelectElement) {
      filterStatus.addEventListener("change", () => {
        state.filterStatus = filterStatus.value;
        state.page = 1;
        renderUsersTable();
      });
    }
    if (sortBy instanceof HTMLSelectElement) {
      sortBy.addEventListener("change", () => {
        state.sortBy = sortBy.value;
        state.page = 1;
        renderUsersTable();
      });
    }

    if (monitorCameraSelect instanceof HTMLSelectElement && deviceSelect instanceof HTMLSelectElement) {
      monitorCameraSelect.addEventListener("change", () => {
        const target = findCameraById(state.cameras, monitorCameraSelect.value);
        if (target?.deviceId) {
          deviceSelect.value = target.deviceId;
        }
      });
    }

    if (liveAiEnabled instanceof HTMLInputElement) {
      liveAiEnabled.addEventListener("change", () => {
        if (liveAiEnabled.checked) {
          startLiveAiLoop();
          return;
        }
        stopLiveAiLoop();
        if (liveAiSummary instanceof HTMLElement) {
          liveAiSummary.textContent = "AI chua duoc bat.";
        }
        if (liveAiPreview instanceof HTMLImageElement) {
          liveAiPreview.hidden = true;
          liveAiPreview.removeAttribute("src");
        }
      });
    }

    document.addEventListener("click", async (e) => {
      const btn = e.target instanceof Element ? e.target.closest("[data-action]") : null;
      if (!btn) return;
      const action = btn.getAttribute("data-action") || "";

      if (action === "toggleSidebar") {
        document.body.classList.toggle("sidebar-open");
        return;
      }
      if (action === "logout") {
        stopMonitoring();
        clearSession();
        window.location.href = "index.html";
        return;
      }
      if (action === "switchModule") {
        switchModule(btn.getAttribute("data-module") || "users");
        return;
      }
      if (action === "openCreate") {
        openUserModal("create", null);
        return;
      }
      if (action === "closeModal") {
        closeUserModal();
        return;
      }
      if (action === "prevPage") {
        state.page = Math.max(1, state.page - 1);
        renderUsersTable();
        return;
      }
      if (action === "nextPage") {
        const total = computeVisibleUsers().length;
        const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
        state.page = Math.min(totalPages, state.page + 1);
        renderUsersTable();
        return;
      }
      if (action === "editUser") {
        const id = btn.getAttribute("data-id") || "";
        const target = findUserById(state.users, id);
        if (target) openUserModal("edit", target);
        return;
      }
      if (action === "deleteUser") {
        deleteUserById(btn.getAttribute("data-id") || "");
        return;
      }
      if (action === "openCameraCreate") {
        openCameraModal("create", null);
        return;
      }
      if (action === "closeCameraModal") {
        closeCameraModal();
        return;
      }
      if (action === "editCamera") {
        const target = findCameraById(state.cameras, btn.getAttribute("data-id") || "");
        if (target) openCameraModal("edit", target);
        return;
      }
      if (action === "deleteCamera") {
        deleteCameraById(btn.getAttribute("data-id") || "");
        return;
      }
      if (action === "startMonitoring") {
        await startMonitoring();
        return;
      }
      if (action === "stopMonitoring") {
        stopMonitoring();
        return;
      }
      if (action === "refreshDevices") {
        await refreshDevices();
        return;
      }
      if (action === "focusVideoUpload") {
        focusVideoUpload();
        return;
      }
      if (action === "deleteVideo") {
        const id = btn.getAttribute("data-id") || "";
        const ok = window.confirm("Xoa video nay?");
        if (!ok) return;
        try {
          await deleteVideoRecord(id);
          toast("Da xoa video.");
          await renderVideoList();
        } catch {
          toast("Khong xoa duoc video.");
        }
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!userModal.hidden) closeUserModal();
      if (!cameraModal.hidden) closeCameraModal();
    });

    userForm.addEventListener("submit", (e) => {
      e.preventDefault();

      if (state.editingId) {
        const existing = findUserById(state.users, state.editingId);
        if (!existing) {
          toast("Khong tim thay nguoi dung.");
          closeUserModal();
          return;
        }
        const result = updateUserFromForm(existing);
        if (!result.ok) {
          toast(result.message);
          return;
        }
        updateUsers(state.users.map((u) => (u?.id === existing.id ? result.user : u)));
        toast("Da cap nhat nguoi dung.");
        closeUserModal();
        return;
      }

      const result = createUserFromForm();
      if (!result.ok) {
        toast(result.message);
        return;
      }

      updateUsers([result.user, ...state.users]);
      toast("Da them nguoi dung.");
      closeUserModal();
    });

    cameraForm.addEventListener("submit", (e) => {
      e.preventDefault();

      if (state.editingCameraId) {
        const existing = findCameraById(state.cameras, state.editingCameraId);
        if (!existing) {
          toast("Khong tim thay camera.");
          closeCameraModal();
          return;
        }
        const result = updateCameraFromForm(existing);
        if (!result.ok) {
          toast(result.message);
          return;
        }
        updateCameras(state.cameras.map((camera) => (camera?.id === existing.id ? result.camera : camera)));
        toast("Da cap nhat camera.");
        closeCameraModal();
        return;
      }

      const result = createCameraFromForm();
      if (!result.ok) {
        toast(result.message);
        return;
      }

      updateCameras([result.camera, ...state.cameras]);
      toast("Da them camera.");
      closeCameraModal();
    });

    videoUploadForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const file = videoFileEl instanceof HTMLInputElement ? videoFileEl.files?.[0] : null;
      const title = String(videoTitleEl?.value ?? "").trim();
      const description = String(videoDescriptionEl?.value ?? "").trim();
      const cameraId = String(videoCameraEl?.value ?? "").trim();
      const occurredAt = String(videoOccurredAtEl?.value ?? "").trim();
      const shouldAnalyse = videoAiEnabled instanceof HTMLInputElement ? videoAiEnabled.checked : false;

      if (!title) {
        toast("Tieu de video khong duoc de trong.");
        return;
      }
      if (!file) {
        toast("Ban chua chon tep video.");
        return;
      }

      try {
        let analysis = null;
        if (shouldAnalyse) {
          toast("Dang phan tich video bang AI no-park...");
          try {
            const analysed = await apiAnalyseVideo(file);
            analysis = {
              summary: analysed.summary || null,
              processedVideoUrl: analysed.processed_video_url
                ? `${AI_API_BASE}${analysed.processed_video_url}`
                : "",
            };
          } catch (analysisError) {
            toast("Khong phan tich duoc AI, van luu video goc.");
          }
        }

        await saveVideoRecord({
          id: uid(),
          title,
          description,
          cameraId,
          occurredAt: occurredAt ? new Date(occurredAt).toISOString() : "",
          createdAt: safeNowIso(),
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          file,
          analysis,
        });
        videoUploadForm.reset();
        populateVideoCameraSelect();
        toast("Da tai len video phat.");
        await renderVideoList();
      } catch {
        toast("Khong the luu video. Kiem tra dung luong file va trinh duyet.");
      }
    });

    syncUserStats();
    renderUsersTable();
    syncCameraStats();
    renderCameraList();
    populateMonitoringCameraSelect();
    populateVideoCameraSelect();
    refreshDevices();
    switchModule(state.currentModule);

    window.addEventListener("beforeunload", () => {
      stopMonitoring();
      state.videoObjectUrls.forEach((url) => URL.revokeObjectURL(url));
      state.videoObjectUrls.clear();
    });
  }

  function init() {
    if (document.body.classList.contains("page-login")) {
      initLoginPage();
      return;
    }
    if (document.body.classList.contains("page-dashboard")) {
      initDashboardPage();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
  window.addAlprResult = function(plate, status) {
      const tbody = document.getElementById("alprResultsTbody");
      if (!tbody) return;

      // Xóa dòng thông báo trống nếu có
      if (tbody.querySelector("td[colspan]")) {
          tbody.innerHTML = "";
      }

      const now = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const statusClass = status === "Vi phạm" ? "pill--danger" : "pill--success";
      
      // Tạo dòng mới
      const row = document.createElement("tr");
      row.className = "row-new-detection";
      row.innerHTML = `
          <td style="color: #64748b;">${now}</td>
          <td><strong style="font-family: monospace; font-size: 1.1rem; letter-spacing: 1px;">${plate}</strong></td>
          <td><span class="pill ${statusClass}" style="padding: 2px 8px; border-radius: 4px; font-size: 0.8rem;">${status}</span></td>
      `;

      // Chèn lên đầu bảng
      tbody.prepend(row);

      // Giới hạn 10 dòng gần nhất
      if (tbody.children.length > 10) {
          tbody.removeChild(tbody.lastChild);
      }
  };
  
  window.initViolationChart = function() {
      const ctx = document.getElementById('violationChart');
      if (!ctx) return;

      // Xóa biểu đồ cũ nếu có để tránh lỗi render đè
      if (window.myViolationChart) {
          window.myViolationChart.destroy();
      }

      window.myViolationChart = new Chart(ctx, {
          type: 'bar', // Loại biểu đồ cột
          data: {
              labels: ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'CN'],
              datasets: [{
                  label: 'Số ca vi phạm',
                  data: [12, 19, 3, 5, 2, 15, 8], // Dữ liệu mẫu, mày có thể đổi số cho đẹp
                  backgroundColor: 'rgba(59, 130, 246, 0.6)', // Màu xanh dương
                  borderColor: 'rgb(59, 130, 246)',
                  borderWidth: 1,
                  borderRadius: 5
              }]
          },
          options: {
              responsive: true,
              maintainAspectRatio: false,
              scales: {
                  y: { beginAtZero: true }
              },
              plugins: {
                  legend: { display: false } // Ẩn chú thích cho gọn
              }
          }
      });
  };

  // Tự động vẽ biểu đồ khi vừa load trang
  setTimeout(window.initViolationChart, 500);

  // Vẽ lại biểu đồ khi quay lại tab "Người dùng" (Trang chủ)
  document.querySelector('[data-module="users"]').addEventListener('click', () => {
      setTimeout(window.initViolationChart, 200);
  });
  /* ==========================================================================
   CHỨC NĂNG 2: NHẬT KÝ VI PHẠM (VIOLATION LOG)
   ========================================================================== */

// 1. Dữ liệu mẫu để mày show cho thầy cô (Có thể thay ảnh thật sau)
const dataViPham = [
    { id: 1, plate: "30F-123.45", type: "Đỗ xe sai quy định", time: "2026-03-20 08:30:12", location: "Cổng số 1", img: "https://via.placeholder.com/120x70?text=Xe+Vi+Pham+1" },
    { id: 2, plate: "29A-888.88", type: "Vượt đèn đỏ", time: "2026-03-20 09:15:45", location: "Ngã tư A", img: "https://via.placeholder.com/120x70?text=Xe+Vi+Pham+2" },
    { id: 3, plate: "15B-555.55", type: "Đỗ xe sai quy định", time: "2026-03-20 10:05:20", location: "Khu vực B", img: "https://via.placeholder.com/120x70?text=Xe+Vi+Pham+3" }
];

// 2. Hàm đổ dữ liệu vào bảng Violation
window.renderViolationLog = function() {
    const tbody = document.getElementById("violationTbody");
    if (!tbody) return;

    console.log("Đang tải nhật ký vi phạm...");
    
    tbody.innerHTML = dataViPham.map(v => `
        <tr>
            <td><img src="${v.img}" style="width:100px; border-radius:4px; border:1px solid #ddd;" alt="Bằng chứng"></td>
            <td><strong style="font-size: 1rem; color: #1e293b;">${v.plate}</strong></td>
            <td><span style="background: #fee2e2; color: #dc2626; padding: 4px 8px; border-radius: 12px; font-size: 12px; font-weight: bold;">${v.type}</span></td>
            <td style="color: #64748b;">${v.time}</td>
            <td>${v.location}</td>
            <td>
                <button class="btn btn--ghost small" onclick="window.viewViolationDetail(${v.id})">Chi tiết</button>
            </td>
        </tr>
    `).join('');
};


  window.viewViolationDetail = function(id) {
      alert("Đang trích xuất hình ảnh bằng chứng cho vụ việc ID: " + id);
  };

  window.exportViolationExcel = function() {
      alert("Hệ thống đang tạo báo cáo Excel cho danh sách vi phạm này...");
  };

  // 4. QUAN TRỌNG: Lắng nghe sự kiện click menu "Video vi phạm"
  document.addEventListener('click', (e) => {
      // Tìm cái nút nào có data-module="videos"
      const btn = e.target.closest('[data-module="videos"]');
      if (btn) {
          // Đợi module hiện ra (150ms) rồi mới đổ dữ liệu vào bảng
          setTimeout(window.renderViolationLog, 150);
      }
  });
  /* ==========================================================================
   CHỨC NĂNG 6: CẤU HÌNH HỆ THỐNG (SYSTEM SETTINGS)
   ========================================================================== */

  window.saveSettings = function() {
      const settings = {
          threshold: document.getElementById('confThreshold').value,
          station: document.getElementById('stationName').value,
          sound: document.getElementById('enableSound').checked
      };
      
      // Lưu vào bộ nhớ trình duyệt
      localStorage.setItem('cityvision_settings', JSON.stringify(settings));
      
      // Hiển thị thông báo Toast (nếu bài của mày có hàm showToast)
      alert("Đã lưu cấu hình hệ thống thành công!");
      
      // Cập nhật tiêu đề trạm ở Header nếu cần
      const subTitle = document.getElementById('moduleSubtitle');
      if(subTitle) subTitle.innerText = "Hệ thống đang chạy tại: " + settings.station;
  };

  window.resetSettings = function() {
      if(confirm("Bạn có chắc muốn khôi phục cài đặt gốc?")) {
          document.getElementById('confThreshold').value = 75;
          document.getElementById('stationName').value = "CityVision Station";
          document.getElementById('enableSound').checked = true;
          saveSettings();
      }
  };
  // Ép hệ thống nhận diện việc chuyển sang trang Settings
document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-module="settings"]');
    if (btn) {
        // 1. Ẩn tất cả các module đang hiện
        document.querySelectorAll('.module').forEach(m => m.hidden = true);
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('is-active'));

        // 2. Hiện đúng module settings
        const settingsModule = document.querySelector('[data-module-panel="settings"]');
        if (settingsModule) {
            settingsModule.hidden = false;
            btn.classList.add('is-active');
            
            // Cập nhật tiêu đề trên thanh Topbar cho chuyên nghiệp
            document.getElementById('moduleTitle').innerText = "Cấu hình hệ thống";
            document.getElementById('moduleSubtitle').innerText = "Thiết lập các thông số vận hành AI và trạm kiểm soát";
        }
    }
});
})();
