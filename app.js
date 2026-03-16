"use strict";

(() => {
  const STORAGE_KEYS = {
    users: "userdash_users_v1",
    session: "userdash_session_v1",
    ui: "userdash_ui_v1",
  };

  const DEFAULT_PAGE_SIZE = 8;

  const ROLE_ADMIN = "Admin";
  const ROLE_STAFF = "Nhân viên";
  const STATUS_ACTIVE = "Hoạt động";
  const STATUS_LOCKED = "Tạm khóa";

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
    if (!isoString) return "—";
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("vi-VN", { year: "numeric", month: "2-digit", day: "2-digit" });
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
    if (!Array.isArray(users)) return [];
    return users;
  }

  function saveUsers(users) {
    return storageSet(STORAGE_KEYS.users, users);
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
        fullName: "Nhân viên",
        email: "staff@example.com",
        role: ROLE_STAFF,
        status: STATUS_ACTIVE,
        createdAt: safeNowIso(),
      },
    ];

    saveUsers(seeded);
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

  function countAdmins(users) {
    return users.filter((u) => u?.role === ROLE_ADMIN).length;
  }

  function statusPillHtml(status) {
    const ok = status === STATUS_ACTIVE;
    const cls = ok ? "pill pill--success" : "pill pill--danger";
    return `<span class="${cls}">${escapeHtml(status || "—")}</span>`;
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
      <div class="muted small">${escapeHtml(role || "—")}</div>
    `;
  }

  function initLoginPage() {
    const session = getSession();
    if (session && session.role === ROLE_ADMIN) {
      window.location.href = "dashboard.html";
      return;
    }

    seedUsersIfNeeded();

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
        toast("Sai tài khoản hoặc mật khẩu.");
        return;
      }
      if (user.status !== STATUS_ACTIVE) {
        toast("Tài khoản đang bị khóa.");
        return;
      }
      if (user.role !== ROLE_ADMIN) {
        toast("Tài khoản không có quyền Admin.");
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
        toast("Không thể lưu phiên đăng nhập (localStorage bị chặn).");
        return;
      }
      window.location.href = "dashboard.html";
    });
  }

  function initDashboardPage() {
    seedUsersIfNeeded();

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

    const modal = document.getElementById("userModal");
    const modalTitle = document.getElementById("modalTitle");
    const userForm = document.getElementById("userForm");

    const userIdEl = document.getElementById("userId");
    const usernameEl = document.getElementById("username");
    const fullNameEl = document.getElementById("fullName");
    const emailEl = document.getElementById("email");
    const roleEl = document.getElementById("role");
    const statusEl = document.getElementById("status");
    const passwordEl = document.getElementById("password");
    const passwordHint = document.getElementById("passwordHint");

    if (!(usersTbody instanceof HTMLElement)) return;
    if (!(modal instanceof HTMLElement)) return;
    if (!(userForm instanceof HTMLFormElement)) return;

    const uiState = storageGet(STORAGE_KEYS.ui, {});
    const state = {
      users: loadUsers(),
      query: typeof uiState.query === "string" ? uiState.query : "",
      filterRole: typeof uiState.filterRole === "string" ? uiState.filterRole : "",
      filterStatus: typeof uiState.filterStatus === "string" ? uiState.filterStatus : "",
      sortBy: typeof uiState.sortBy === "string" ? uiState.sortBy : "createdAt_desc",
      page: Number.isFinite(uiState.page) ? Math.max(1, uiState.page) : 1,
      pageSize: DEFAULT_PAGE_SIZE,
      editingId: null,
    };

    function persistUiState() {
      storageSet(STORAGE_KEYS.ui, {
        query: state.query,
        filterRole: state.filterRole,
        filterStatus: state.filterStatus,
        sortBy: state.sortBy,
        page: state.page,
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

      if (state.filterRole) {
        list = list.filter((u) => u?.role === state.filterRole);
      }

      if (state.filterStatus) {
        list = list.filter((u) => u?.status === state.filterStatus);
      }

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

    function syncStats() {
      if (statTotal) statTotal.textContent = String(state.users.length);
      if (statActive)
        statActive.textContent = String(state.users.filter((u) => u?.status === STATUS_ACTIVE).length);
      if (statAdmin) statAdmin.textContent = String(countAdmins(state.users));
    }

    function clampPage(totalItems) {
      const totalPages = Math.max(1, Math.ceil(totalItems / state.pageSize));
      state.page = Math.min(Math.max(1, state.page), totalPages);
      return totalPages;
    }

    function renderTable() {
      const visible = computeVisibleUsers();
      const totalPages = clampPage(visible.length);
      persistUiState();

      const start = (state.page - 1) * state.pageSize;
      const pageItems = visible.slice(start, start + state.pageSize);

      usersTbody.innerHTML =
        pageItems.length === 0
          ? `<tr><td colspan="7" class="muted">Không có dữ liệu phù hợp.</td></tr>`
          : pageItems
              .map((u) => {
                const created = formatDate(u?.createdAt);
                const fullName = u?.fullName ? escapeHtml(u.fullName) : "—";
                const email = u?.email ? escapeHtml(u.email) : "—";
                return `
                  <tr>
                    <td><strong>${escapeHtml(u?.username ?? "")}</strong></td>
                    <td>${fullName}</td>
                    <td>${email}</td>
                    <td>${escapeHtml(u?.role ?? "—")}</td>
                    <td>${statusPillHtml(u?.status)}</td>
                    <td>${escapeHtml(created)}</td>
                    <td>
                      <div class="row-actions">
                        <button class="btn btn--ghost" type="button" data-action="editUser" data-id="${escapeHtml(u?.id ?? "")}">Sửa</button>
                        <button class="btn btn--danger" type="button" data-action="deleteUser" data-id="${escapeHtml(u?.id ?? "")}">Xóa</button>
                      </div>
                    </td>
                  </tr>
                `;
              })
              .join("");

      if (tableSummary) tableSummary.textContent = `${visible.length} kết quả`;
      if (pageInfo) pageInfo.textContent = `Trang ${state.page}/${totalPages}`;
    }

    function openModal(mode, user) {
      state.editingId = mode === "edit" ? user?.id ?? null : null;
      if (modalTitle) modalTitle.textContent = mode === "edit" ? "Sửa người dùng" : "Thêm người dùng";

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
            ? "Bắt buộc nhập mật khẩu khi tạo mới."
            : "Khi sửa người dùng: để trống mật khẩu nếu không muốn đổi.";
      }

      document.body.classList.add("modal-open");
      modal.hidden = false;

      const focusTarget = mode === "edit" ? fullNameEl : usernameEl;
      if (focusTarget && typeof focusTarget.focus === "function") focusTarget.focus();
    }

    function closeModal() {
      modal.hidden = true;
      document.body.classList.remove("modal-open");
      state.editingId = null;
    }

    function updateUsers(nextUsers) {
      state.users = nextUsers;
      saveUsers(nextUsers);
      syncStats();
      renderTable();
    }

    function createUserFromForm() {
      const username = String(usernameEl?.value ?? "").trim();
      const password = String(passwordEl?.value ?? "");
      const fullName = String(fullNameEl?.value ?? "").trim();
      const email = String(emailEl?.value ?? "").trim();
      const role = String(roleEl?.value ?? ROLE_STAFF);
      const status = String(statusEl?.value ?? STATUS_ACTIVE);

      if (!username) return { ok: false, message: "Username không được để trống." };
      if (!password) return { ok: false, message: "Mật khẩu không được để trống." };

      const exists = findUserByUsername(state.users, username);
      if (exists) return { ok: false, message: "Username đã tồn tại." };

      const next = {
        id: uid(),
        username,
        password,
        fullName,
        email,
        role,
        status,
        createdAt: safeNowIso(),
      };
      return { ok: true, user: next };
    }

    function updateUserFromForm(existingUser) {
      const username = String(usernameEl?.value ?? "").trim();
      const password = String(passwordEl?.value ?? "");
      const fullName = String(fullNameEl?.value ?? "").trim();
      const email = String(emailEl?.value ?? "").trim();
      const role = String(roleEl?.value ?? existingUser.role);
      const status = String(statusEl?.value ?? existingUser.status);

      if (!username) return { ok: false, message: "Username không được để trống." };

      const other = state.users.find(
        (u) => u?.id !== existingUser.id && normalizeText(u?.username) === normalizeText(username),
      );
      if (other) return { ok: false, message: "Username đã tồn tại." };

      if (existingUser.role === ROLE_ADMIN && role !== ROLE_ADMIN && countAdmins(state.users) <= 1) {
        return { ok: false, message: "Không thể bỏ quyền Admin của tài khoản Admin cuối cùng." };
      }

      const next = {
        ...existingUser,
        username,
        fullName,
        email,
        role,
        status,
        password: password ? password : existingUser.password,
      };

      return { ok: true, user: next };
    }

    function deleteUserById(id) {
      const target = findUserById(state.users, id);
      if (!target) return;

      if (target.role === ROLE_ADMIN && countAdmins(state.users) <= 1) {
        toast("Không thể xóa tài khoản Admin cuối cùng.");
        return;
      }

      const ok = window.confirm(`Xóa người dùng "${target.username}"?`);
      if (!ok) return;

      const next = state.users.filter((u) => u?.id !== id);
      updateUsers(next);
      toast("Đã xóa người dùng.");
    }

    function openEditById(id) {
      const target = findUserById(state.users, id);
      if (!target) return;
      openModal("edit", target);
    }

    // Init inputs from state
    if (searchInput instanceof HTMLInputElement) searchInput.value = state.query;
    if (filterRole instanceof HTMLSelectElement) filterRole.value = state.filterRole;
    if (filterStatus instanceof HTMLSelectElement) filterStatus.value = state.filterStatus;
    if (sortBy instanceof HTMLSelectElement) sortBy.value = state.sortBy;

    if (searchInput instanceof HTMLInputElement) {
      searchInput.addEventListener("input", () => {
        state.query = searchInput.value;
        state.page = 1;
        renderTable();
      });
    }

    if (filterRole instanceof HTMLSelectElement) {
      filterRole.addEventListener("change", () => {
        state.filterRole = filterRole.value;
        state.page = 1;
        renderTable();
      });
    }

    if (filterStatus instanceof HTMLSelectElement) {
      filterStatus.addEventListener("change", () => {
        state.filterStatus = filterStatus.value;
        state.page = 1;
        renderTable();
      });
    }

    if (sortBy instanceof HTMLSelectElement) {
      sortBy.addEventListener("change", () => {
        state.sortBy = sortBy.value;
        state.page = 1;
        renderTable();
      });
    }

    document.addEventListener("click", (e) => {
      const btn = e.target instanceof Element ? e.target.closest("[data-action]") : null;
      if (!btn) return;
      const action = btn.getAttribute("data-action") || "";

      if (action === "toggleSidebar") {
        document.body.classList.toggle("sidebar-open");
        return;
      }
      if (action === "logout") {
        clearSession();
        window.location.href = "index.html";
        return;
      }
      if (action === "openCreate") {
        openModal("create", null);
        return;
      }
      if (action === "closeModal") {
        closeModal();
        return;
      }
      if (action === "prevPage") {
        state.page = Math.max(1, state.page - 1);
        renderTable();
        return;
      }
      if (action === "nextPage") {
        const total = computeVisibleUsers().length;
        const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
        state.page = Math.min(totalPages, state.page + 1);
        renderTable();
        return;
      }
      if (action === "editUser") {
        const id = btn.getAttribute("data-id") || "";
        openEditById(id);
        return;
      }
      if (action === "deleteUser") {
        const id = btn.getAttribute("data-id") || "";
        deleteUserById(id);
        return;
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.hidden) {
        closeModal();
      }
    });

    userForm.addEventListener("submit", (e) => {
      e.preventDefault();

      if (state.editingId) {
        const existing = findUserById(state.users, state.editingId);
        if (!existing) {
          toast("Không tìm thấy người dùng.");
          closeModal();
          return;
        }
        const result = updateUserFromForm(existing);
        if (!result.ok) {
          toast(result.message);
          return;
        }
        const next = state.users.map((u) => (u?.id === existing.id ? result.user : u));
        updateUsers(next);
        toast("Đã cập nhật người dùng.");
        closeModal();
        return;
      }

      const result = createUserFromForm();
      if (!result.ok) {
        toast(result.message);
        return;
      }

      updateUsers([result.user, ...state.users]);
      toast("Đã thêm người dùng.");
      closeModal();
    });

    syncStats();
    renderTable();
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
})();
