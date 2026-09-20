const API_BASE_URL = window.location.origin;
const TOKEN_STORAGE_KEY = "ifms_access_token";
let accessToken = localStorage.getItem(TOKEN_STORAGE_KEY);
let authMode = "login";
let resources = [];
let resourceToDelete = null;
let viewerObjectUrl = null;
let currentViewedResource = null;
let currentCategoryResource = null;
let availableCategories = [];
let currentFolderId = null;
let folderBeingRenamed = null;
let libraryResources = [];
let currentUserGreeting = "My Library";

const authShell = document.getElementById("authShell");
const dashboard = document.getElementById("dashboard");
const rows = document.getElementById("resourceRows");
const search = document.getElementById("search");
const categoryFilter = document.getElementById("categoryFilter");
const typeFilter = document.getElementById("typeFilter");

const icons = { PDF: "PDF", PPTX: "PPT", DOCX: "DOC", WEBPAGE_LINK: "↗", IMAGE: "IMG", VIDEO: "VID" };
const classes = { PDF: "pdf", PPTX: "pptx", DOCX: "docx", WEBPAGE_LINK: "link", IMAGE: "image", VIDEO: "image" };

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
    renderResources();
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
    loadResources();
    loadCategories();
}

function showAppView(view) {
    const libraryMode = view === "library";
    document.querySelectorAll(".dashboard-view").forEach((section) => section.hidden = libraryMode);
    document.getElementById("libraryView").hidden = !libraryMode;
    document.getElementById("dashboardNav").classList.toggle("active", !libraryMode);
    document.getElementById("libraryNav").classList.toggle("active", libraryMode);
    document.getElementById("pageBreadcrumb").textContent = libraryMode ? "Workspace / My Library" : "Workspace / Overview";
    document.getElementById("welcomeHeading").textContent = libraryMode ? "My Library" : currentUserGreeting;
    if (libraryMode) loadFolder(null);
}

document.getElementById("dashboardNav").onclick = () => showAppView("dashboard");
document.getElementById("libraryNav").onclick = () => showAppView("library");

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
        categoryFilter.innerHTML = '<option value="">All categories</option>' + availableCategories.map(
            (category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`,
        ).join("");
        if (availableCategories.includes(selected)) categoryFilter.value = selected;
    }
    return availableCategories;
}

function renderResources() {
    const query = search.value.toLowerCase();
    const filtered = resources.filter((resource) =>
        (!query || (resource.name + resource.category + resource.type).toLowerCase().includes(query)) &&
        (!categoryFilter.value || resource.category === categoryFilter.value) &&
        (!typeFilter.value || resource.type === typeFilter.value),
    );
    rows.innerHTML = filtered.map(resourceRowMarkup).join("");
    document.getElementById("emptyState").style.display = filtered.length ? "none" : "block";
    document.getElementById("emptyState").textContent = "No resources match these filters.";
    document.getElementById("tableSummary").textContent = `Showing ${filtered.length} of ${resources.length} resources`;
    document.getElementById("totalCount").textContent = resources.length;
}

function resourceRowMarkup(resource) {
    return `<tr>
      <td><div class="resource-main"><span class="file-icon ${classes[resource.type]}">${icons[resource.type]}</span>
        <div><button class="open-resource" data-id="${resource.id}">${escapeHtml(resource.name)}</button>
        <div class="resource-topics">${resource.topics.slice(0, 3).map((topic) => `<span>${escapeHtml(topic.name)}</span>`).join("")}</div></div></div></td>
      <td><button class="tag edit-category" data-id="${resource.id}" title="Review or correct category">
        ${escapeHtml(resource.category)}${resource.category_confidence ? ` · ${Math.round(resource.category_confidence * 100)}%` : ""}
      </button>${resource.category_review_required ? '<small class="review-flag">Review suggested</small>' : ""}</td>
      <td>${escapeHtml(resource.date)}</td><td class="type">${escapeHtml(resource.type.replace("_", " "))}</td>
      <td><button class="delete-resource" data-id="${resource.id}" aria-label="Delete ${escapeHtml(resource.name)}">⌫</button></td>
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
    document.getElementById(id).classList.remove("open");
    if (id === "viewerModal") {
        document.getElementById("pdfViewer").src = "about:blank";
        currentViewedResource = null;
    }
}

document.getElementById("openUpload").onclick = () => openModal("uploadModal");
document.getElementById("openUrl").onclick = () => openModal("urlModal");
document.querySelectorAll("[data-close]").forEach((button) => {
    button.onclick = () => closeModal(button.dataset.close);
});
document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
    backdrop.onclick = (event) => { if (event.target === backdrop) closeModal(backdrop.id); };
});
document.querySelectorAll(".category").forEach((card) => {
    card.onclick = () => {
        categoryFilter.value = card.dataset.category;
        renderResources();
        document.querySelector(".library-card").scrollIntoView({ behavior: "smooth", block: "start" });
    };
});
[search, categoryFilter, typeFilter].forEach((element) => element.addEventListener("input", renderResources));

function handleResourceClick(event) {
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
    if (currentViewedResource?.id === normalized.id) currentViewedResource = normalized;
    renderResources();
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
        if (!document.getElementById("libraryView").hidden) loadFolder(currentFolderId);
    } catch (error) {
        alert(error.message);
    } finally {
        button.disabled = false;
    }
};

async function openResource(resourceId) {
    const resource = resources.find((item) => item.id === resourceId);
    if (!resource) return;
    if (resource.external_url) return window.open(resource.external_url, "_blank", "noopener,noreferrer");
    try {
        const response = await fetch(API_BASE_URL + `/resources/${resourceId}/file`, { headers: authHeaders() });
        if (response.status === 401) return showAuthentication();
        if (!response.ok) throw new Error("The document could not be opened.");
        if (viewerObjectUrl) URL.revokeObjectURL(viewerObjectUrl);
        viewerObjectUrl = URL.createObjectURL(await response.blob());
        if (resource.type !== "PDF") return window.open(viewerObjectUrl, "_blank", "noopener,noreferrer");
        currentViewedResource = resource;
        document.getElementById("viewerTitle").textContent = resource.name;
        document.getElementById("viewerCategory").textContent = resource.category;
        renderViewerTopics();
        document.getElementById("pdfViewer").src = viewerObjectUrl;
        openModal("viewerModal");
    } catch (error) {
        alert(error.message);
    }
}

function renderViewerTopics() {
    const topicList = document.getElementById("viewerTopics");
    if (!currentViewedResource || !currentViewedResource.topics.length) {
        topicList.innerHTML = '<span class="topic-empty">No topics detected. Add one below.</span>';
        return;
    }
    topicList.innerHTML = currentViewedResource.topics.map((topic) => {
        const pageText = topic.pages.length ? ` · p. ${topic.pages.join(", ")}` : "";
        return `<span class="topic-chip">
          <button type="button" class="topic-jump" data-page="${topic.pages[0] || ""}" title="${Math.round(topic.confidence * 100)}% confidence">${escapeHtml(topic.name)}${pageText}</button>
          <button type="button" class="topic-remove" data-id="${topic.id}" aria-label="Remove ${escapeHtml(topic.name)}">×</button>
        </span>`;
    }).join("");
}

document.getElementById("viewerTopics").addEventListener("click", async (event) => {
    const jump = event.target.closest(".topic-jump");
    if (jump && jump.dataset.page) {
        document.getElementById("pdfViewer").src = viewerObjectUrl + "#page=" + jump.dataset.page;
        return;
    }
    const remove = event.target.closest(".topic-remove");
    if (!remove || !currentViewedResource) return;
    const response = await fetch(
        API_BASE_URL + `/resources/${currentViewedResource.id}/topics/${remove.dataset.id}`,
        { method: "DELETE", headers: authHeaders() },
    );
    if (response.ok) {
        currentViewedResource.topics = currentViewedResource.topics.filter(
            (topic) => topic.id !== Number(remove.dataset.id),
        );
        renderViewerTopics();
        renderResources();
    }
});

document.getElementById("topicForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentViewedResource) return;
    const input = document.getElementById("newTopic");
    const response = await fetch(API_BASE_URL + `/resources/${currentViewedResource.id}/topics`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ name: input.value.trim(), pages: [] }),
    });
    const data = await response.json();
    if (!response.ok) return alert(formatApiError(data));
    currentViewedResource.topics.push(data);
    input.value = "";
    renderViewerTopics();
    renderResources();
});

document.getElementById("fileForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const file = document.getElementById("resourceFile").files[0];
    if (!file) return notice("fileNotice", "Choose a file to continue.", "error");
    const button = document.getElementById("fileSubmit");
    button.disabled = true;
    button.textContent = "Analysing...";
    try {
        const body = new FormData();
        body.append("file", file);
        const response = await fetch(API_BASE_URL + "/resources", { method: "POST", headers: authHeaders(), body });
        if (response.status === 401) return showAuthentication();
        const data = await response.json();
        if (!response.ok) throw new Error(formatApiError(data));
        resources.unshift(normalizeResource(data));
        renderResources();
        form.reset();
        notice("fileNotice", `Resource classified as ${data.category}.`, "success");
        setTimeout(() => closeModal("uploadModal"), 900);
    } catch (error) {
        notice("fileNotice", error.message, "error");
    } finally {
        button.disabled = false;
        button.textContent = "Analyse resource";
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
