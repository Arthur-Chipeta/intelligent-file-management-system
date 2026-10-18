const API_BASE_URL = window.location.origin;
const TOKEN_STORAGE_KEY = "ifms_access_token";
let accessToken = localStorage.getItem(TOKEN_STORAGE_KEY);
let authMode = "login";
let resources = [];
let resourceToDelete = null;
let resourceBeingRenamed = null;
let currentCategoryResource = null;
let availableCategories = [];
let currentFolderId = null;
let folderBeingRenamed = null;
let libraryResources = [];
let currentUserGreeting = "My Library";
let currentView = "dashboard";
let uploadInProgress = false;

const authShell = document.getElementById("authShell");
const dashboard = document.getElementById("dashboard");
const rows = document.getElementById("resourceRows");
const search = document.getElementById("search");
const categoryFilter = document.getElementById("categoryFilter");
const typeFilter = document.getElementById("typeFilter");

const icons = { PDF: "PDF", PPTX: "PPT", DOCX: "DOC", WEBPAGE_LINK: "↗", IMAGE: "IMG", VIDEO: "VID" };
const classes = { PDF: "pdf", PPTX: "pptx", DOCX: "docx", WEBPAGE_LINK: "link", IMAGE: "image", VIDEO: "image" };
const categoryTints = ["#eaf0ff", "#eeeaff", "#e5f7f1", "#fff1df", "#f1f3f7", "#fdebf3"];
const categorySymbols = ["⌘", "◉", "▱", "⌁", "✦", "◇"];

function authHeaders(extra = {}) {
    return accessToken ? { ...extra, Authorization: "Bearer " + accessToken } : extra;
}

function notice(id, message, type) {
    const node = document.getElementById(id);
    node.textContent = message;
    node.className = "notice " + type;
}

function formatApiError(data) {
    if (Array.isArray(data.detail)) {
        return data.detail.map((item) => item.msg.replace(/^Value error, /, "")).join(" ");
    }
    return data.detail || "Something went wrong. Please try again.";
}

function escapeHtml(value) {
    const node = document.createElement("div");
    node.textContent = value ?? "";
    return node.innerHTML;
}

function normalizeResource(resource) {
    return {
        ...resource,
        topics: resource.topics || [],
        type: resource.resource_type,
        date: new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
            new Date(resource.created_at),
        ),
    };
}

function showAuthentication() {
    accessToken = null;
    resources = [];
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    dashboard.hidden = true;
    authShell.hidden = false;
    closeNotifications();
    renderResources();
    renderDashboard();
}

function showDashboard(user) {
    const firstName = user.name.split(" ")[0];
    const hour = new Date().getHours();
    const greeting = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
    const initials = user.name.split(" ").slice(0, 2).map((part) => part[0].toUpperCase()).join("");
    document.getElementById("sidebarUserName").textContent = user.name;
    document.getElementById("userAvatar").textContent = initials;
    currentUserGreeting = `Good ${greeting}, ${firstName}`;
    document.getElementById("welcomeHeading").textContent = currentUserGreeting;
    authShell.hidden = true;
    dashboard.hidden = false;
    showAppView("dashboard");
    loadResources();
    loadCategories();
}

function showAppView(view) {
    currentView = view;
    const labels = {
        dashboard: ["Workspace / Overview", currentUserGreeting],
        library: ["Workspace / My Library", "My Library"],
        categories: ["Workspace / Categories", "Categories"],
        activity: ["Workspace / Recent activity", "Recent activity"],
    };
    document.querySelectorAll(".dashboard-view").forEach((section) => section.hidden = view !== "dashboard");
    document.getElementById("libraryView").hidden = view !== "library";
    document.getElementById("categoriesView").hidden = view !== "categories";
    document.getElementById("activityView").hidden = view !== "activity";
    ["dashboard", "library", "categories", "activity"].forEach((name) => {
        document.getElementById(`${name}Nav`).classList.toggle("active", view === name);
    });
    document.getElementById("pageBreadcrumb").textContent = labels[view][0];
    document.getElementById("welcomeHeading").textContent = labels[view][1];
    closeNotifications();
    if (view === "library") loadFolder(null);
    if (view === "categories") renderCategoryViews();
    if (view === "activity") renderActivity();
}

document.getElementById("dashboardNav").onclick = () => showAppView("dashboard");
document.getElementById("libraryNav").onclick = () => showAppView("library");
document.getElementById("categoriesNav").onclick = () => showAppView("categories");
document.getElementById("activityNav").onclick = () => showAppView("activity");
document.getElementById("viewAllCategories").onclick = () => showAppView("categories");

async function restoreSession() {
    if (!accessToken) return showAuthentication();
    try {
        const response = await fetch(API_BASE_URL + "/auth/me", { headers: authHeaders() });
        if (!response.ok) throw new Error("Session expired");
        showDashboard(await response.json());
    } catch (_) {
        showAuthentication();
    }
}

function setAuthMode(mode) {
    authMode = mode;
    const registering = mode === "register";
    document.getElementById("loginTab").classList.toggle("active", !registering);
    document.getElementById("registerTab").classList.toggle("active", registering);
    document.getElementById("nameField").hidden = !registering;
    document.getElementById("authName").required = registering;
    document.getElementById("passwordHint").hidden = !registering;
    document.getElementById("authPassword").autocomplete = registering ? "new-password" : "current-password";
    document.getElementById("authTitle").textContent = registering ? "Create your account" : "Welcome back";
    document.getElementById("authSubtitle").textContent = registering
        ? "Start building your intelligent library."
        : "Sign in to continue to your workspace.";
    document.getElementById("authSubmit").textContent = registering ? "Create account" : "Sign in";
    notice("authNotice", "", "");
}

document.getElementById("loginTab").onclick = () => setAuthMode("login");
document.getElementById("registerTab").onclick = () => setAuthMode("register");
document.getElementById("logoutButton").onclick = showAuthentication;

document.getElementById("authForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = document.getElementById("authSubmit");
    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value;
    button.disabled = true;
    button.textContent = authMode === "register" ? "Creating account..." : "Signing in...";
    notice("authNotice", "", "");
    try {
        if (authMode === "register") {
            const response = await fetch(API_BASE_URL + "/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: document.getElementById("authName").value.trim(), email, password }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(formatApiError(data));
        }
        const response = await fetch(API_BASE_URL + "/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(formatApiError(data));
        accessToken = data.access_token;
        localStorage.setItem(TOKEN_STORAGE_KEY, accessToken);
        form.reset();
        showDashboard(data.user);
    } catch (error) {
        notice("authNotice", error.message, "error");
    } finally {
        button.disabled = false;
        button.textContent = authMode === "register" ? "Create account" : "Sign in";
    }
});

async function loadResources() {
    try {
        const response = await fetch(API_BASE_URL + "/resources", { headers: authHeaders() });
        if (response.status === 401) return showAuthentication();
        if (!response.ok) throw new Error("Your library could not be loaded.");
        resources = (await response.json()).map(normalizeResource);
        renderResources();
        renderDashboard();
    } catch (error) {
        document.getElementById("emptyState").textContent = error.message;
        document.getElementById("emptyState").style.display = "block";
    }
}

async function loadCategories() {
    const response = await fetch(API_BASE_URL + "/categories", { headers: authHeaders() });
    if (response.ok) {
        availableCategories = await response.json();
        const selected = categoryFilter.value;
        const filterCategories = [...new Set(["General", ...availableCategories])].sort();
        categoryFilter.innerHTML = '<option value="">All categories</option>' + filterCategories.map(
            (category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`,
        ).join("");
        if (filterCategories.includes(selected)) categoryFilter.value = selected;
    }
    return availableCategories;
}

function renderResources() {
    const query = search.value.toLowerCase();
    const filtered = resources.filter((resource) =>
        (!query || (resource.name + resource.category + resource.type + resource.topics.map((topic) => topic.name).join(" ")).toLowerCase().includes(query)) &&
        (!categoryFilter.value || resource.category === categoryFilter.value) &&
        (!typeFilter.value || resource.type === typeFilter.value),
    );
    rows.innerHTML = filtered.map(resourceRowMarkup).join("");
    document.getElementById("emptyState").style.display = filtered.length ? "none" : "block";
    document.getElementById("emptyState").textContent = "No resources match these filters.";
    document.getElementById("tableSummary").textContent = `Showing ${filtered.length} of ${resources.length} resources`;
    document.getElementById("tableRange").textContent = `${filtered.length} ${filtered.length === 1 ? "result" : "results"}`;
    document.getElementById("totalCount").textContent = resources.length;
}

function renderDashboard() {
    const now = Date.now();
    const recentResources = resources.filter((resource) => {
        const createdAt = new Date(resource.created_at).getTime();
        return Number.isFinite(createdAt) && now - createdAt <= 7 * 24 * 60 * 60 * 1000;
    });
    const documents = resources.filter((resource) => ["PDF", "DOCX", "PPTX"].includes(resource.type));
    const webResources = resources.filter((resource) => resource.type === "WEBPAGE_LINK");
    document.getElementById("totalCount").textContent = resources.length;
    document.getElementById("documentCount").textContent = documents.length;
    document.getElementById("webCount").textContent = webResources.length;
    document.getElementById("recentCount").textContent = recentResources.length;
    document.getElementById("totalDetail").textContent = resources.length
        ? `${categoryCounts().length} ${categoryCounts().length === 1 ? "category" : "categories"}`
        : "Your complete library";
    renderCategoryViews();
    renderActivity();
    renderNotifications();
}

function categoryCounts() {
    const counts = new Map();
    resources.forEach((resource) => counts.set(resource.category, (counts.get(resource.category) || 0) + 1));
    return [...counts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

function categoryCardMarkup(category, index) {
    const noun = category.count === 1 ? "resource" : "resources";
    return `<button class="category" style="--tint: ${categoryTints[index % categoryTints.length]}" data-category="${escapeHtml(category.name)}">
      <span class="category-symbol">${categorySymbols[index % categorySymbols.length]}</span>
      <strong>${escapeHtml(category.name)}</strong><small>${category.count} ${noun}</small>
    </button>`;
}

function renderCategoryViews() {
    const categories = categoryCounts();
    const dashboardGrid = document.getElementById("dashboardCategoryGrid");
    const allGrid = document.getElementById("allCategoryGrid");
    dashboardGrid.innerHTML = categories.slice(0, 5).map(categoryCardMarkup).join("") ||
        '<div class="category-placeholder">Your classified subjects will appear here.</div>';
    allGrid.innerHTML = categories.map(categoryCardMarkup).join("");
    document.getElementById("categoriesEmpty").style.display = categories.length ? "none" : "block";
}

function renderActivity() {
    const recent = [...resources]
        .sort((left, right) => new Date(right.created_at) - new Date(left.created_at))
        .slice(0, 20);
    document.getElementById("activityList").innerHTML = recent.map((resource) => `
      <article class="activity-item">
        <span class="file-icon ${classes[resource.type] || ""}">${icons[resource.type] || "FILE"}</span>
        <div><strong>${escapeHtml(resource.name)}</strong><p>Added to ${escapeHtml(resource.category)}</p></div>
        <time datetime="${escapeHtml(resource.created_at)}">${escapeHtml(resource.date)}</time>
      </article>`).join("");
    document.getElementById("activityEmpty").style.display = recent.length ? "none" : "block";
}

function renderNotifications() {
    const reviewItems = resources.filter((resource) => resource.category_review_required);
    const badge = document.getElementById("notificationBadge");
    badge.textContent = reviewItems.length;
    badge.hidden = !reviewItems.length;
    document.getElementById("notificationSummary").textContent = reviewItems.length
        ? `${reviewItems.length} to review`
        : "All clear";
    document.getElementById("notificationList").innerHTML = reviewItems.length
        ? reviewItems.slice(0, 6).map((resource) => `
          <button class="notification-item" data-resource-id="${resource.id}">
            <span>!</span><div><strong>Review category</strong><small>${escapeHtml(resource.name)}</small></div>
          </button>`).join("")
        : '<div class="notification-empty">No categories need your review.</div>';
}

function resourceRowMarkup(resource) {
    return `<tr>
      <td><div class="resource-main"><span class="file-icon ${classes[resource.type] || ""}">${icons[resource.type] || "FILE"}</span>
        <div><button class="open-resource" data-id="${resource.id}">${escapeHtml(resource.name)}</button>
        <div class="resource-topics">${resource.topics.slice(0, 3).map((topic) => `<span>${escapeHtml(topic.name)}</span>`).join("")}</div></div></div></td>
      <td><button class="tag edit-category" data-id="${resource.id}" title="Review or correct category">
        ${escapeHtml(resource.category)}${resource.category_confidence ? ` · ${Math.round(resource.category_confidence * 100)}%` : ""}
      </button>${resource.category_review_required ? '<small class="review-flag">Review suggested</small>' : ""}</td>
      <td>${escapeHtml(resource.date)}</td><td class="type">${escapeHtml(resource.type.replace("_", " "))}</td>
      <td><div class="resource-actions">
        <button class="rename-resource" data-id="${resource.id}" aria-label="Rename ${escapeHtml(resource.name)}" title="Rename">✎</button>
        <button class="delete-resource" data-id="${resource.id}" aria-label="Delete ${escapeHtml(resource.name)}" title="Delete">⌫</button>
      </div></td>
    </tr>`;
}

async function loadFolder(folderId) {
    currentFolderId = folderId;
    const query = folderId ? `?parent_id=${folderId}` : "";
    const response = await fetch(API_BASE_URL + "/folders/contents" + query, { headers: authHeaders() });
    if (response.status === 401) return showAuthentication();
    if (!response.ok) return;
    const data = await response.json();
    libraryResources = data.resources.map(normalizeResource);
    document.getElementById("folderBreadcrumbs").innerHTML =
        '<button class="folder-crumb" data-id="">My Library</button>' + data.breadcrumbs.map(
            (folder) => `<span>›</span><button class="folder-crumb" data-id="${folder.id}">${escapeHtml(folder.name)}</button>`,
        ).join("");
    document.getElementById("folderGrid").innerHTML = data.folders.map((folder) => `
      <article class="folder-card">
        <button class="open-folder" data-id="${folder.id}">
          <span class="folder-icon">▰</span><strong>${escapeHtml(folder.name)}</strong>
          <small>${folder.child_count} folders · ${folder.resource_count} files</small>
        </button>
        <button class="rename-folder" data-id="${folder.id}" data-name="${encodeURIComponent(folder.name)}" aria-label="Rename folder">✎</button>
      </article>`).join("");
    const fileSection = document.getElementById("folderFiles");
    fileSection.hidden = !libraryResources.length;
    document.getElementById("libraryResourceRows").innerHTML = libraryResources.map(resourceRowMarkup).join("");
    document.getElementById("folderFileCount").textContent = `${libraryResources.length} files`;
    const isEmpty = !data.folders.length && !libraryResources.length;
    document.getElementById("libraryEmpty").style.display = isEmpty ? "block" : "none";
}

document.getElementById("folderBreadcrumbs").addEventListener("click", (event) => {
    const crumb = event.target.closest(".folder-crumb");
    if (crumb) loadFolder(crumb.dataset.id ? Number(crumb.dataset.id) : null);
});

document.getElementById("folderGrid").addEventListener("click", (event) => {
    const open = event.target.closest(".open-folder");
    if (open) return loadFolder(Number(open.dataset.id));
    const rename = event.target.closest(".rename-folder");
    if (!rename) return;
    folderBeingRenamed = Number(rename.dataset.id);
    document.getElementById("folderModalTitle").textContent = "Rename folder";
    document.getElementById("folderName").value = decodeURIComponent(rename.dataset.name);
    notice("folderNotice", "", "");
    openModal("folderModal");
});

document.getElementById("newFolderButton").onclick = () => {
    folderBeingRenamed = null;
    document.getElementById("folderModalTitle").textContent = "New folder";
    document.getElementById("folderName").value = "";
    notice("folderNotice", "", "");
    openModal("folderModal");
};

document.getElementById("folderForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = document.getElementById("folderName").value.trim();
    const url = folderBeingRenamed ? `/folders/${folderBeingRenamed}` : "/folders";
    const response = await fetch(API_BASE_URL + url, {
        method: folderBeingRenamed ? "PATCH" : "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(folderBeingRenamed ? { name } : { name, parent_id: currentFolderId }),
    });
    const data = await response.json();
    if (!response.ok) return notice("folderNotice", formatApiError(data), "error");
    closeModal("folderModal");
    loadFolder(currentFolderId);
});

function openModal(id) { document.getElementById(id).classList.add("open"); }
function closeModal(id) {
    if (id === "uploadModal" && uploadInProgress) return;
    document.getElementById(id).classList.remove("open");
    if (id === "uploadModal") resetFileSelection();
}

document.getElementById("openUpload").onclick = () => openModal("uploadModal");
document.getElementById("openUrl").onclick = () => openModal("urlModal");
document.querySelectorAll("[data-close]").forEach((button) => {
    button.onclick = () => closeModal(button.dataset.close);
});
document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
    backdrop.onclick = (event) => { if (event.target === backdrop) closeModal(backdrop.id); };
});
function filterByCategory(category) {
    showAppView("dashboard");
    if (![...categoryFilter.options].some((option) => option.value === category)) {
        categoryFilter.add(new Option(category, category));
    }
    search.value = "";
    typeFilter.value = "";
    categoryFilter.value = category;
    renderResources();
    document.querySelector(".library-card").scrollIntoView({ behavior: "smooth", block: "start" });
}

["dashboardCategoryGrid", "allCategoryGrid"].forEach((id) => {
    document.getElementById(id).addEventListener("click", (event) => {
        const card = event.target.closest(".category");
        if (card) filterByCategory(card.dataset.category);
    });
});

function closeNotifications() {
    const panel = document.getElementById("notificationPanel");
    panel.hidden = true;
    document.getElementById("notificationButton").setAttribute("aria-expanded", "false");
}

document.getElementById("notificationButton").addEventListener("click", (event) => {
    event.stopPropagation();
    const panel = document.getElementById("notificationPanel");
    panel.hidden = !panel.hidden;
    event.currentTarget.setAttribute("aria-expanded", String(!panel.hidden));
});

document.getElementById("notificationPanel").addEventListener("click", (event) => {
    event.stopPropagation();
    const item = event.target.closest(".notification-item");
    if (item) {
        closeNotifications();
        openCategoryEditor(Number(item.dataset.resourceId));
    }
});

document.addEventListener("click", closeNotifications);
[search, categoryFilter, typeFilter].forEach((element) => element.addEventListener("input", renderResources));

function handleResourceClick(event) {
    const renameButton = event.target.closest(".rename-resource");
    if (renameButton) {
        resourceBeingRenamed = [...resources, ...libraryResources].find(
            (resource) => resource.id === Number(renameButton.dataset.id),
        );
        if (!resourceBeingRenamed) return;
        document.getElementById("resourceName").value = resourceBeingRenamed.name;
        document.getElementById("renameResourceDescription").textContent =
            resourceBeingRenamed.type === "WEBPAGE_LINK"
                ? "Choose the title shown for this saved link."
                : "Choose the name shown in your library.";
        notice("renameResourceNotice", "", "");
        openModal("renameResourceModal");
        return;
    }
    const categoryButton = event.target.closest(".edit-category");
    if (categoryButton) return openCategoryEditor(Number(categoryButton.dataset.id));
    const openButton = event.target.closest(".open-resource");
    if (openButton) return openResource(Number(openButton.dataset.id));
    const deleteButton = event.target.closest(".delete-resource");
    if (!deleteButton) return;
    resourceToDelete = [...resources, ...libraryResources].find((resource) => resource.id === Number(deleteButton.dataset.id));
    document.getElementById("deleteMessage").textContent =
        `“${resourceToDelete.name}” will be removed from your library. This action cannot be undone.`;
    openModal("deleteModal");
}

rows.addEventListener("click", handleResourceClick);
document.getElementById("libraryResourceRows").addEventListener("click", handleResourceClick);

document.getElementById("renameResourceForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!resourceBeingRenamed) return;
    const submit = document.getElementById("renameResourceSubmit");
    submit.disabled = true;
    try {
        const response = await fetch(API_BASE_URL + `/resources/${resourceBeingRenamed.id}/name`, {
            method: "PATCH",
            headers: authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ name: document.getElementById("resourceName").value }),
        });
        if (response.status === 401) return showAuthentication();
        const data = await response.json();
        if (!response.ok) return notice("renameResourceNotice", formatApiError(data), "error");
        replaceResource(data);
        resourceBeingRenamed = null;
        closeModal("renameResourceModal");
    } catch (error) {
        notice("renameResourceNotice", error.message || "The resource could not be renamed.", "error");
    } finally {
        submit.disabled = false;
    }
});

async function openCategoryEditor(resourceId) {
    currentCategoryResource = resources.find((resource) => resource.id === resourceId);
    if (!currentCategoryResource) return;
    if (!availableCategories.length) await loadCategories();
    const select = document.getElementById("categorySelect");
    select.innerHTML = availableCategories.map(
        (category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`,
    ).join("");
    select.value = currentCategoryResource.category;
    document.getElementById("categoryResourceName").textContent = currentCategoryResource.name;
    renderCategoryEvidence();
    notice("categoryNotice", "", "");
    openModal("categoryModal");
}

function renderCategoryEvidence() {
    const resource = currentCategoryResource;
    const confidence = Math.round((resource.category_confidence || 0) * 100);
    const alternatives = (resource.category_rankings || []).map(
        (ranking) => `<li><span>${escapeHtml(ranking.category)}</span><strong>${Math.round(ranking.score * 100)} points</strong></li>`,
    ).join("");
    document.getElementById("categoryEvidence").innerHTML = `
      <p><strong>${resource.category_source === "manual" ? "Manually corrected" : "Automatic prediction"}</strong>
      · ${confidence}% confidence${resource.category_review_required ? " · review suggested" : ""}</p>
      ${alternatives ? `<ol>${alternatives}</ol>` : ""}`;
}

function replaceResource(updated) {
    const normalized = normalizeResource(updated);
    resources = resources.map((resource) => resource.id === normalized.id ? normalized : resource);
    libraryResources = libraryResources.map((resource) => resource.id === normalized.id ? normalized : resource);
    currentCategoryResource = normalized;
    renderResources();
    renderDashboard();
    document.getElementById("libraryResourceRows").innerHTML = libraryResources.map(resourceRowMarkup).join("");
    return normalized;
}

document.getElementById("saveCategoryButton").onclick = async () => {
    if (!currentCategoryResource) return;
    const response = await fetch(API_BASE_URL + `/resources/${currentCategoryResource.id}/category`, {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ category: document.getElementById("categorySelect").value }),
    });
    const data = await response.json();
    if (!response.ok) return notice("categoryNotice", formatApiError(data), "error");
    replaceResource(data);
    notice("categoryNotice", "Category correction saved.", "success");
    renderCategoryEvidence();
};

document.getElementById("reclassifyButton").onclick = async () => {
    if (!currentCategoryResource) return;
    const response = await fetch(API_BASE_URL + `/resources/${currentCategoryResource.id}/reclassify`, {
        method: "POST", headers: authHeaders(),
    });
    const data = await response.json();
    if (!response.ok) return notice("categoryNotice", formatApiError(data), "error");
    const resource = replaceResource(data);
    document.getElementById("categorySelect").value = resource.category;
    notice("categoryNotice", "Classification refreshed.", "success");
    renderCategoryEvidence();
};

document.getElementById("confirmDelete").onclick = async () => {
    if (!resourceToDelete) return;
    const button = document.getElementById("confirmDelete");
    button.disabled = true;
    try {
        const response = await fetch(API_BASE_URL + "/resources/" + resourceToDelete.id, {
            method: "DELETE", headers: authHeaders(),
        });
        if (response.status === 401) return showAuthentication();
        if (!response.ok) throw new Error("The resource could not be deleted.");
        resources = resources.filter((resource) => resource.id !== resourceToDelete.id);
        libraryResources = libraryResources.filter((resource) => resource.id !== resourceToDelete.id);
        resourceToDelete = null;
        closeModal("deleteModal");
        renderResources();
        renderDashboard();
        if (!document.getElementById("libraryView").hidden) loadFolder(currentFolderId);
    } catch (error) {
        alert(error.message);
    } finally {
        button.disabled = false;
    }
};

function openResource(resourceId) {
    const viewerUrl = new URL("viewer.html", window.location.href);
    viewerUrl.searchParams.set("id", resourceId);
    window.open(viewerUrl.toString(), "_blank", "noopener,noreferrer");
}

const fileInput = document.getElementById("resourceFile");
const dropzone = document.querySelector(".dropzone");
const supportedExtensions = ["pdf", "pptx", "docx", "jpg", "jpeg", "png", "mp4"];

function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function selectedFileType(file) {
    return file.name.split(".").pop()?.toUpperCase() || "FILE";
}

function updateSelectedFile() {
    const file = fileInput.files[0];
    const selected = document.getElementById("selectedFile");
    const submit = document.getElementById("fileSubmit");
    document.getElementById("uploadProgress").hidden = true;
    if (!file) {
        selected.hidden = true;
        dropzone.classList.remove("has-file");
        submit.disabled = true;
        return;
    }
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!supportedExtensions.includes(extension)) {
        fileInput.value = "";
        notice("fileNotice", "Choose a PDF, PPTX, DOCX, JPG, PNG or MP4 file.", "error");
        return updateSelectedFile();
    }
    document.getElementById("selectedFileName").textContent = file.name;
    document.getElementById("selectedFileMeta").textContent = `${selectedFileType(file)} · ${formatFileSize(file.size)} · Ready to analyse`;
    document.getElementById("selectedFileIcon").textContent = selectedFileType(file).slice(0, 4);
    selected.hidden = false;
    dropzone.classList.add("has-file");
    submit.disabled = false;
    notice("fileNotice", "Document selected. Click Analyse resource when you are ready.", "success");
}

function resetFileSelection() {
    if (uploadInProgress) return;
    fileInput.value = "";
    fileInput.disabled = false;
    document.getElementById("removeSelectedFile").disabled = false;
    document.getElementById("selectedFile").hidden = true;
    document.getElementById("uploadProgress").hidden = true;
    document.getElementById("uploadProgressBar").style.width = "0%";
    document.getElementById("uploadProgress").classList.remove("analysing");
    document.getElementById("fileSubmit").disabled = true;
    document.getElementById("fileSubmit").textContent = "Analyse resource";
    dropzone.classList.remove("has-file", "dragging", "uploading");
    notice("fileNotice", "", "");
}

function setUploadProgress(percent, label = "Uploading document…") {
    const progress = document.getElementById("uploadProgress");
    progress.hidden = false;
    progress.classList.remove("analysing");
    document.getElementById("uploadProgressLabel").textContent = label;
    document.getElementById("uploadProgressValue").textContent = `${percent}%`;
    document.getElementById("uploadProgressBar").style.width = `${percent}%`;
}

function uploadFileWithProgress(file) {
    return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open("POST", API_BASE_URL + "/resources");
        if (accessToken) request.setRequestHeader("Authorization", "Bearer " + accessToken);
        request.upload.addEventListener("progress", (event) => {
            if (event.lengthComputable) setUploadProgress(Math.round((event.loaded / event.total) * 100));
        });
        request.upload.addEventListener("load", () => {
            const progress = document.getElementById("uploadProgress");
            progress.hidden = false;
            progress.classList.add("analysing");
            document.getElementById("uploadProgressLabel").textContent = "Upload complete — analysing content…";
            document.getElementById("uploadProgressValue").textContent = "Processing";
            document.getElementById("uploadProgressBar").style.width = "100%";
        });
        request.addEventListener("load", () => {
            let data = {};
            try { data = JSON.parse(request.responseText); } catch (_) { data = {}; }
            if (request.status >= 200 && request.status < 300) return resolve(data);
            const error = new Error(formatApiError(data));
            error.status = request.status;
            reject(error);
        });
        request.addEventListener("error", () => reject(new Error("The upload could not be completed. Check your connection and try again.")));
        const body = new FormData();
        body.append("file", file);
        request.send(body);
    });
}

fileInput.addEventListener("change", updateSelectedFile);
document.getElementById("removeSelectedFile").addEventListener("click", resetFileSelection);
["dragenter", "dragover"].forEach((eventName) => dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (!uploadInProgress) dropzone.classList.add("dragging");
}));
["dragleave", "drop"].forEach((eventName) => dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove("dragging");
}));
dropzone.addEventListener("drop", (event) => {
    if (uploadInProgress || !event.dataTransfer.files.length) return;
    const transfer = new DataTransfer();
    transfer.items.add(event.dataTransfer.files[0]);
    fileInput.files = transfer.files;
    updateSelectedFile();
});

document.getElementById("fileForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = fileInput.files[0];
    if (!file) return notice("fileNotice", "Choose a file to continue.", "error");
    const button = document.getElementById("fileSubmit");
    uploadInProgress = true;
    button.disabled = true;
    button.textContent = "Uploading…";
    fileInput.disabled = true;
    dropzone.classList.add("uploading");
    document.getElementById("removeSelectedFile").disabled = true;
    notice("fileNotice", "Keep this window open while your resource is processed.", "");
    setUploadProgress(0);
    let succeeded = false;
    try {
        const data = await uploadFileWithProgress(file);
        succeeded = true;
        resources.unshift(normalizeResource(data));
        renderResources();
        renderDashboard();
        document.getElementById("uploadProgress").classList.remove("analysing");
        document.getElementById("uploadProgressLabel").textContent = "Analysis complete";
        document.getElementById("uploadProgressValue").textContent = "100%";
        button.textContent = "Complete";
        notice("fileNotice", `Resource classified as ${data.category}.`, "success");
        setTimeout(() => {
            uploadInProgress = false;
            closeModal("uploadModal");
        }, 1200);
    } catch (error) {
        if (error.status === 401) return showAuthentication();
        notice("fileNotice", error.message, "error");
    } finally {
        if (!succeeded) {
            uploadInProgress = false;
            button.disabled = false;
            button.textContent = "Try again";
            fileInput.disabled = false;
            dropzone.classList.remove("uploading");
            document.getElementById("removeSelectedFile").disabled = false;
            document.getElementById("uploadProgress").classList.remove("analysing");
        }
    }
});

document.getElementById("urlForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = document.getElementById("urlSubmit");
    button.disabled = true;
    button.textContent = "Analysing...";
    try {
        const response = await fetch(API_BASE_URL + "/resources/webpage", {
            method: "POST", headers: authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ url: document.getElementById("resourceUrl").value.trim() }),
        });
        if (response.status === 401) return showAuthentication();
        const data = await response.json();
        if (!response.ok) throw new Error(formatApiError(data));
        resources.unshift(normalizeResource(data));
        renderResources();
        renderDashboard();
        form.reset();
        notice("urlNotice", `Webpage classified as ${data.category}.`, "success");
        setTimeout(() => closeModal("urlModal"), 900);
    } catch (error) {
        notice("urlNotice", error.message, "error");
    } finally {
        button.disabled = false;
        button.textContent = "Analyse webpage";
    }
});

renderResources();
restoreSession();
